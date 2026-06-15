# 协作群 Manager 路由+监督模式全栈优化方案

## Context

协作群 (Room) 的 Manager Agent 采用**路由+监督**模式：Manager 负责分析用户消息、将任务精准分发给最合适的 Agent，并在 Agent 完成后评估结果、决定是否触发下一 Agent。

本方案针对该模式在实际运行中暴露的问题进行了系统性优化，涵盖后端调度逻辑、前端展示、失败处理和防重复机制。

---

## 一、核心架构

### 1.1 调度模型

```
用户消息 → Manager (intent=route)
    → JSON footer route_to → Agent A (intent=execute)
        → Agent A 完成 → Manager (intent=review)
            → route_to Agent B / notify_user / escalate
```

**两种 Agent 拉起方式**:
1. **Manager 路由分配** — 通过 `workflow_action` JSON footer (`route_to`/`relay_to`)
2. **直接 @ 提及** — 其他 Agent 或人工直接 @ 拉起

### 1.2 关键文件

| 文件 | 职责 |
|------|------|
| `server/internal/service/room_workflow.go` | workflow action 解析、路由执行、Manager review |
| `server/internal/service/room_completion.go` | Agent 完成后调度（finalizeRoomInvocation） |
| `server/internal/service/room_router.go` | 初始消息路由到 Manager |
| `server/internal/service/room_progress.go` | Manager 进度扫描 |
| `server/internal/service/room_invocation_worker.go` | invocation worker、auto-retry |
| `server/internal/service/mention_dispatch.go` | @mention dispatch、drain |
| `server/internal/service/room_mention_parse.go` | @mention 解析 |
| `server/internal/daemon/prompt.go` | Manager prompt 模板 |
| `packages/views/room/room-route-hint.tsx` | 路由卡片 UI |
| `packages/views/room/room-message-list.tsx` | 消息列表、状态解析 |
| `packages/views/room/room-message-visibility.ts` | 消息可见性控制 |

---

## 二、已完成的优化

### 2.1 Manager 路由卡片 UI 优化

**问题**: 路由卡片右对齐、显示泛称"Agent"而非具体角色名。

**修复**:
- `room-route-hint.tsx`: 布局改为左对齐 (`pl-10`)，与系统消息视觉一致
- `room-message-list.tsx`: 目标角色名 fallback 到 `slotInvocations[0]` 通过 `agentNameById` 解析
- 移除 "Agent" 硬编码兜底，确保显示具体角色名（如"需求分析师"）

### 2.2 RoomUserMessageStatus 移除

**问题**: 旧的 Brain 图标状态组件（RoomUserMessageStatus）在新架构下不再适用。

**修复**:
- 删除 `room-message-status.tsx` 整个文件
- `room-message-visibility.ts`: 隐藏 `route_hint` 系统消息（避免与路由卡片重复）

### 2.3 agent_at 卡片状态解析

**问题**: agent_at 系统消息缺少 invocation 状态（无"思考中"/"已完成"指示）。

**修复**:
- `room-message-list.tsx` 新增 `buildAgentAtStatusMap`：按 `to_agent_id` + 时间邻近（120s）匹配 invocation 状态
- `RoomAgentAtCard` 组件接收 `agentAtStatus` prop

### 2.4 JSON footer 解析增强

**问题**: Manager LLM 输出不稳定，JSON footer 经常缺失。

**修复**（三层防御）:
1. **Prompt 强化**: Manager prompt 添加 CRITICAL EXAMPLE，展示完整输入→输出格式
2. **`parseWorkflowActionFromOutput` 增强**:
   - 新增无语言标签 ``` 围栏解析
   - 新增正则匹配 `{"workflow_action":{...}}` 模式
3. **`tryResolveRouteFromText` 文本兜底**:
   - 扫描 Manager 输出中的 "路由给 XXX"、"@XXX"、`**XXX**` 模式
   - 匹配群成员 Agent 名称，自动转换为 `route_to` action
4. **失败时输出可见系统消息**: "⚠️ 群管理未能生成有效的路由指令"

### 2.5 Agent 重复拉起修复（双重 Dispatch）

**问题**: Manager 完成时，`DispatchRoomMentions`（文本 @mention 扫描）和 `ProcessRoomWorkflowOnComplete`（JSON footer 解析）同时为目标 Agent 创建 invocation。

**修复**:
- `room_completion.go`: Manager 分支（`managerRun=true`）移除 `DispatchRoomMentions` 调用
- 路由仅通过 JSON footer，不再扫描文本 @mention

### 2.6 Manager 审查循环防护

**问题**: Manager review 完成后又路由回同一 Agent → Agent 完成 → 又触发 review → 循环。

**修复**（三道防线）:

#### 防线 1: `agentRecentlyHandled` 守卫
```go
// room_workflow.go
func (s *TaskService) agentRecentlyHandled(ctx, room, agentID, messageID) bool {
    // 检查目标 Agent 是否已有同 message 的 active/succeeded invocation
    // failed/cancelled 允许重试路由
}
```
- `workflowRouteTo` 和 `workflowRelayTo` 路由前调用
- 防止 Manager 审查循环中对同一 Agent 的重复路由

#### 防线 2: `managerJustCompleted` 标志
```go
// room_completion.go
if room.ManagerAgentID.Valid && task.AgentID.Bytes == room.ManagerAgentID.Bytes {
    managerJustCompleted = true
}
if status == "succeeded" && !managerJustCompleted {
    s.MaybeTriggerManagerProgressScan(ctx, room)
}
```
- Manager 完成后跳过 `MaybeTriggerManagerProgressScan`
- 避免 Manager 自身的 workflow action 已经创建了下个 invocation，又被 progress scan 重复创建

#### 防线 3: `enqueueManagerReview` 去重
```go
// room_workflow.go
func (s *TaskService) enqueueManagerReview(...) {
    // 检查是否已有同 message + 同 Manager 的 review invocation
    // active/succeeded 则跳过
}
```

### 2.7 失败处理由 Manager 决策

**问题**: Agent 失败后 `MaybeAutoRetryRoomInvocation` 直接自动重试，绕过 Manager 决策。

**修复**:
- `room_invocation_worker.go`: `MaybeAutoRetryRoomInvocation` 对有 Manager 的群直接返回 false
- `room_workflow.go`: 失败处理仅限 `intent == "execute"`：
  - 创建可见系统消息 "⚠️ XXX 回答失败，已通知管理员重新分配"
  - 自动触发 Manager review，由 Manager 决定重试/换路由/升级
- **禁止级联**: Manager 自身失败（review/route intent）不触发 Manager notification，防止无限循环

### 2.8 Manager 决策全可见

**问题**: 部分 Manager 决策（如 `notify_user`）不在聊天区域显示。

**修复**:
- `workflowNotifyUser`: 当 `action.Message` 非空时创建可见系统消息
- 所有 Manager 决策的可见性:
  - `route_to` → "↗️ 路由给 XXX" ✓
  - `relay_to` → "🔄 XXX → YYY" ✓
  - `escalate` → "🚨 升级介入：XXX" ✓
  - `notify_user` → 直接显示 Manager 消息内容 ✓
  - Agent 执行失败 → "⚠️ XXX 回答失败，已通知管理员重新分配" ✓

### 2.9 workflowRouteTo/RelayTo 启动优化

**问题**: `workflowRouteTo` 创建 invocation 后未调用 `drainRoomDispatchAgents`，Agent 启动延迟。

**修复**:
- 捕获 `dispatchRoomWorkflowInvocation` 返回的 invocation
- 立即调用 `drainRoomDispatchAgents` 确保 Agent 被启动

---

## 三、完整流程（修复后）

### 3.1 正常流程
```
用户消息 "开发贪吃蛇小游戏"
  │
  └─ Manager route (intent=route)
       ├─ JSON footer route_to → "↗️ 路由给 前端工程师" (可见)
       └─ workflowRouteTo → 创建 FE invocation + drain → 前端工程师(思考中)
            │
            └─ 前端工程师 完成(succeeded)
                 ├─ 发布回复消息
                 ├─ DispatchRoomMentions (非 Manager，扫描 @mention)
                 ├─ enqueueManagerReview (去重检查) → Manager review
                 └─ DrainQueuedRoomInvocations
                      │
                      └─ Manager review 完成
                           ├─ route_to 后端工程师 → "↗️ 路由给 后端工程师"
                           └─ 或 notify_user → "任务已完成" (可见)
```

### 3.2 失败处理流程
```
前端工程师 执行失败
  │
  ├─ "⚠️ 前端工程师 回答失败，已通知管理员重新分配" (可见系统消息)
  └─ Manager review (intent=review)
       ├─ route_to 前端工程师 → 重试 (agentRecentlyHandled 允许 failed 重试)
       ├─ route_to 其他 Agent → 换路由
       └─ notify_user → 通知用户需要帮助 (可见)
```

### 3.3 级联防护
```
Manager review 失败 (JSON footer 解析失败)
  │
  ├─ "⚠️ 群管理未能生成有效的路由指令" (可见系统消息)
  └─ 不触发另一个 Manager review (intent != "execute"，级联终止)
```

---

## 四、前端消息可见性规则

### 4.1 隐藏的系统消息 (`room-message-visibility.ts`)
- `route_hint` — 由 `RoomRouteHint` 组件单独渲染
- `relay_hint` — 内部流转标记

### 4.2 显示的系统消息
- 路由失败提示: "⚠️ 群管理未能生成有效的路由指令"
- Agent 失败通知: "⚠️ XXX 回答失败，已通知管理员重新分配"
- Manager 直接响应: `notify_user` 的消息内容
- 升级介入: "🚨 升级介入：XXX"

### 4.3 路由卡片 (`RoomRouteHint`)
- 左对齐 (`pl-10`)，与系统消息视觉一致
- 显示具体角色名（通过 `route_hint metadata` 或 `slotInvocations` 解析）
- 可展开查看详情

---

## 五、待观察/后续优化

### 5.1 Manager JSON footer 稳定性
- 当前依赖三层防御（prompt + 解析增强 + 文本兜底）
- 可考虑：结构化输出 (function calling) 替代自由文本 JSON

### 5.2 Agent 任务级失败判定
- `finalizeRoomInvocation` 中，空输出 (`resolveRoomTaskBody` 返回空) 标记为 "failed"
- 可能原因：daemon 连接超时、任务队列竞态
- 建议：增加 retry 计数器和超时配置，区分 "Agent 无输出" 和 "Agent 主动失败"

### 5.3 审查深度限制
- Manager review 链理论上可无限循环（review → route → execute → review → ...）
- 当前通过 `agentRecentlyHandled` 和 `enqueueManagerReview` 去重防护
- 建议：添加全局 review 计数器，超过 N 次后强制终止并通知用户

### 5.4 `MaybeTriggerManagerProgressScan` 竞态
- 在 Agent 完成和 `enqueueManagerReview` 创建 Manager invocation 之间存在时间窗口
- 当前通过 `hasActive`/`hasManagerActive` 检查缓解
- 建议：使用数据库事务或分布式锁确保原子性
