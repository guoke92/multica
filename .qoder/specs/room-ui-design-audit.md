# 协作群 UI/UX 设计规范 v2.1 — 逻辑审查报告

> 审查对象：`.qoder/specs/room-ui-design.canvas.tsx`
> 审查日期：2026-06-15
> 审查范围：设计规范内部逻辑自洽性（不涉及实现对比）

---

## 一、🔴 高优先级（必须修复，否则流程不通）

### 1. 数据模型 `topic_id` 是单数，无法支撑多话题关联

**位置：** 第 939 行 vs 第 945 行

**现状：**
```
数据模型：topic_id?  // 单个字符串
设计意图：同一条消息可出现在不同话题（弱关联场景）
```

**问题：** 单字段无法存多个值。消息 #5 被话题 A 强关联（引用链）又被话题 B 弱关联（Manager 语义）时，`topic_id` 存哪个？

**连锁影响：**
- 流程动态按话题过滤时弱关联消息丢失
- 点击流程动态跳转到消息后无法判断它在当前话题中的角色
- ThreadBlock 视图无法正确聚合跨话题消息

**修复方案：**

将 `topic_id?` 拆分为两个字段：

```typescript
// 修改位置：第 939 行
// 改前：
topic_id?  // Manager 语义归属

// 改后：
topic_ids?: string[]       // Manager 语义归属（一条消息可弱关联多个话题）
primary_topic_id?: string  // 强关联的主话题（引用链归属）
```

同时修改关联方式说明（第 941-945 行）：

```
关联方式
• 强关联：引用/回应 → quote_message_id → 归入 primary_topic_id → ThreadBlock 可聚合
• 弱关联：Manager 按语义将消息编入 topic_ids[] → 流程动态可跨话题引用
• 优先级：primary_topic_id 优先（ThreadBlock 视图以强关联为准）
• 冲突规则：强关联优先于弱关联。如果引用链要求消息归入话题 A，但 Manager 语义判定属于话题 B，
  消息的 primary_topic_id = A（ThreadBlock 以 A 为准），同时 topic_ids[] 包含 A 和 B（流程动态双侧可见）
• 实现约定：Manager 不得拆散引用链。引用链是硬约束，语义归属是软约束。
```

---

### 2. `MessageState` 缺少 `cancelled` 状态

**位置：** 第 81 行 vs 第 1152 行

**现状：**
```typescript
type MessageState = "thinking" | "streaming" | "succeeded" | "failed" | "queued";
```

但 invocation 生命周期（第 1152 行）定义了 `cancelled` 状态：
```
{ status: "cancelled", label: "已取消", actions: "重试" }
```

**问题：** 用户点击"取消排队"或"停止生成"后，消息状态是什么？
- `failed`？语义不对，"取消"≠"失败"
- 新状态 `cancelled`？类型里没定义

**影响：** 前端无法正确渲染取消后的消息状态。

**修复方案：**

在 `MessageState` 枚举中加入 `cancelled`：

```typescript
// 修改位置：第 81 行
// 改前：
type MessageState = "thinking" | "streaming" | "succeeded" | "failed" | "queued";

// 改后：
type MessageState = "sent" | "pending" | "thinking" | "streaming" | "succeeded" | "failed" | "queued" | "cancelled";
```

同步更新 `RoomMessageRow` 中的状态映射（第 331-332 行）：

```typescript
const stateLabel: Record<MessageState, string> = {
  sent: "已发送", pending: "等待中", thinking: "思考中", streaming: "输出中",
  succeeded: "完成", failed: "失败", queued: "排队中", cancelled: "已取消"
};
const stateColor: Record<MessageState, string> = {
  sent: C.textDim, pending: C.textDim, thinking: C.amber, streaming: C.amber,
  succeeded: C.green, failed: C.red, queued: C.textDim, cancelled: C.textDim
};
```

---

### 3. `MessageState` 缺少 `pending` 状态

**位置：** 第 81 行 vs 第 1147 行

**现状：** 消息状态枚举没有 `pending`，但 invocation 生命周期从 `pending` 开始（"Manager 已接收，尚未 dispatch"）。

**问题：** Manager 收到用户消息但还没决定路由给谁时，消息处于什么状态？
- `queued`？但 `queued` 的描述是 "已 dispatch 但 Agent 忙碌"，语义不同
- `thinking`？但消息还没有 Agent 在处理

**影响：** "Manager 正在分析意图" 阶段没有对应状态，UI 无法渲染。

**修复方案：** 已在修复 #2 中一并加入 `pending`。

同时在 `RoomMessageRow` 渲染逻辑中增加 `pending` 分支（第 357 行附近）：

```tsx
) : msg.state === "pending" ? (
  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textDim }}>
    <span style={{ animation: "pulse 1.5s infinite" }}>⠋</span>
    <span>Manager 正在分析意图…</span>
  </div>
) : msg.state === "queued" ? (
  // ... existing queued branch
```

---

### 4. 并行模式无结案流程

**位置：** 第 166-173 行 vs 第 148-163 行

**现状：**

路由模式完整闭环：
```
invocation_succeeded → manager_complete → human_confirm_requested → human_confirm_accepted → topic_closed
```

并行模式：
```
invocation_succeeded×2 → （结束，无后续事件）
```

**问题：** 缺少 `manager_complete`、`human_confirm_requested`、`topic_closed`。设计宪法第 5 条说"三种模式均有完整流程动态"，但并行模式的流程动态缺少结案阶段。

**修复方案：**

修改 `PARALLEL_FLOW_EVENTS`（第 166-173 行），在两个 `invocation_succeeded` 后补充汇聚事件：

```typescript
const PARALLEL_FLOW_EVENTS: FlowEvent[] = [
  { id: "pfe0", type: "topic_create", label: "话题创建 · 登录页方案评估", tone: "manager", time: "16:10" },
  { id: "pfe1", type: "user_intent", label: "用户 @前端工程师 @后端工程师", tone: "default", time: "16:10", messageId: "p0" },
  { id: "pfe2", type: "invocation_running", label: "前端工程师 · 思考中", tone: "active", time: "16:11", messageId: "p1" },
  { id: "pfe3", type: "invocation_running", label: "后端工程师 · 思考中", tone: "active", time: "16:11", messageId: "p2" },
  { id: "pfe4", type: "invocation_succeeded", label: "前端工程师 · 完成", tone: "success", time: "16:18", messageId: "p1" },
  { id: "pfe5", type: "invocation_succeeded", label: "后端工程师 · 完成", tone: "success", time: "16:20", messageId: "p2" },
  // ↓ 并行模式汇聚：所有子 invocation 完成后自动触发
  { id: "pfe6", type: "manager_complete", label: "群管 → 所有 Agent 已完成，判定任务完成", tone: "manager", time: "16:20" },
  { id: "pfe7", type: "human_confirm_requested", label: "待 dev 确认结案", tone: "human", time: "16:20", messageId: "p0" },
  { id: "pfe8", type: "human_confirm_accepted", label: "dev 已确认结案", tone: "success", time: "16:22" },
  { id: "pfe9", type: "topic_closed", label: "话题已结束", tone: "success", time: "16:22" },
];
```

同步修改对照表（第 884 行）：

```typescript
// 改前：
["Manager review", "✅ 评估接力", "⚠️ 仅异常升级", "❌ 不 review"],

// 改后：
["Manager review", "✅ 评估接力", "⚠️ 仅异常升级", "⚠️ 不评估接力，仅汇聚完成"],
```

同步修改话题生命周期（第 1259 行）：

```typescript
// 改前：
• 结束：须人工确认 或 授权高级 Agent 确认（可配置默认通过）→ manager_complete + human_confirm

// 改后：
• 结束：路由模式须 Manager review 后人工确认；并行/直连模式所有子 invocation 完成后自动触发汇聚，
  无需 Manager review → 自动 manager_complete → human_confirm → topic_closed
```

---

### 5. 拒绝确认后流程死锁

**位置：** 第 1525-1531 行

**现状：** 结案时序只定义了接受路径：
```
1. manager_complete
2. human_confirm_requested → 轻卡 pending + 待处理 +1
3. 用户点「接受」→ human_confirm_accepted
4. topic_closed → 轻卡终态 + 待处理 -1
```

**问题：** 拒绝后：
- `pending` 计数是否 -1？→ 未定义
- 话题状态变为什么？→ 未定义
- Manager 收到拒绝后做什么？→ 未定义
- 如果 Manager 不响应，用户永远卡在"待确认" → 死锁

**修复方案：**

修改结案时序（第 1525-1531 行），补充拒绝路径：

```markdown
结案时序

接受路径：
1. manager_complete
2. human_confirm_requested → 轻卡 pending + 待处理 +1
3. 用户点「接受」→ human_confirm_accepted
4. topic_closed → 轻卡终态 + 待处理 -1

拒绝路径：
1. manager_complete
2. human_confirm_requested → 轻卡 pending + 待处理 +1
3. 用户点「拒绝」→ human_confirm_rejected（须填原因）→ 轻卡终态 + 待处理 -1
4. Manager 收到拒绝原因后：
   a. 重新修改方案 → 新 manager_complete → 重新 human_confirm_requested
   b. 升级到更高级 Agent → 新 invocation
   c. 放弃话题 → topic_closed（标记为"用户拒绝结案"）
```

在流程动态示例中增加拒绝场景（第 162-163 行附近）：

```typescript
// 拒绝场景示例：
// { id: "e13r", type: "human_confirm_rejected", label: "dev 已拒绝 · 需求尚未验收", tone: "error", time: "14:15" },
// { id: "e14r", type: "manager_retry", label: "群管 → 重新发起确认", tone: "manager", time: "14:16" },
// { id: "e15r", type: "human_confirm_requested", label: "待 dev 确认结案（修改后）", tone: "human", time: "14:16", messageId: "2" },
```

---

### 6. 话题结束定义与并行模式矛盾

**位置：** 第 1259 行 vs 第 884 行

**现状：**
```
话题生命周期：结束 → 须人工确认 → manager_complete + human_confirm
并行模式：Manager review: ❌ 不 review
```

**问题：** 话题结束需要 `manager_complete`，但并行模式 Manager 不 review，`manager_complete` 无法触发。而对照表（第 888 行）又说并行模式"人工确认"同左（须确认）。

**修复方案：** 已在修复 #4 中一并解决——并行模式所有子 invocation 完成后自动触发 `manager_complete`。

---

## 二、🟡 中优先级（定义不清，实现时会返工）

### 7. 用户消息 `state: "succeeded"` 语义错误

**位置：** 第 105 行

**现状：**
```typescript
{ id: "1", sender: "dev", senderType: "user", content: "开发贪吃蛇", state: "succeeded" }
```

**问题：** 用户消息是"已发送"，不是"succeeded"。`succeeded` 语义是 "Agent 成功完成任务"。用户消息发送失败时该显示什么？`failed`？但用户消息没有 invocation。

**修复方案：**

加入 `sent` 状态（已在修复 #2 中定义），用户消息统一使用 `state: "sent"`：

```typescript
// 修改位置：第 105 行
// 改前：
{ id: "1", sender: "dev", senderType: "user", content: "开发贪吃蛇", time: "14:02", state: "succeeded" },

// 改后：
{ id: "1", sender: "dev", senderType: "user", content: "开发贪吃蛇", time: "14:02", state: "sent" },
```

用户消息渲染时忽略 `state` 字段（不显示状态 badge）。

---

### 8. `senderType` 缺少 `squad`

**位置：** 第 86 行 vs 第 67-77 行

**现状：**
```typescript
senderType: "user" | "agent";
```

但成员列表（第 67-77 行）和 @mention 规则（第 1113 行）都提到支持 Squad。Squad 发消息时 `senderType` 是什么？

**修复方案：**

```typescript
// 修改位置：第 86 行
// 改前：
senderType: "user" | "agent";

// 改后：
senderType: "user" | "agent" | "squad";
```

Squad 消息的渲染规则：使用 Squad 的 cyan 色 Avatar，attribution 格式为 "由 @SquadName 指定"。

---

### 9. 强关联 vs 弱关联优先级未定义

**位置：** 第 942-945 行

**现状：**
```
• 强关联：引用/回应 → quote_message_id → 必同话题
• 弱关联：Manager 按语义将消息编入同一 Topic
• 同一条消息可出现在不同话题（弱关联场景）
```

**问题：** 消息 #5 引用消息 #1（强关联→话题 A），但 Manager 判定内容属于话题 B（弱关联→话题 B）。两个规则同时适用，谁优先？

**修复方案：** 已在修复 #1 中定义优先级规则——强关联优先于弱关联，引用链是硬约束，语义归属是软约束。

---

### 10. 话题续接/拆分判定标准模糊

**位置：** 第 1257-1258 行

**现状：**
```
续接：引用链强关联 或 Manager 语义相关 → 并入活跃话题
拆分：Manager 检测换题 → topic_split
```

**问题：** 如果消息 #5 引用了消息 #1（强关联→话题 A），但 Manager 认为 #5 是新话题：
- "续接"规则说应并入话题 A
- "拆分"规则说应拆为话题 B

两个规则冲突时谁优先？

**修复方案：**

明确判定优先级：

```markdown
话题归属判定规则（按优先级从高到低）：

1. 强关联优先：如果消息有 quote_message_id，必须归入被引用消息的 primary_topic_id
2. Manager 语义判定：如果消息没有 quote_message_id，Manager 按语义判定归入哪个话题
3. 拆分条件：仅当消息没有 quote_message_id 且 Manager 判定与当前活跃话题语义不同时，才触发 topic_split
4. 禁止拆分引用链：即使 Manager 认为内容属于新话题，只要消息引用了旧话题的消息，就不得拆分
```

---

### 11. `agent_at` 的 `messageId` 指向不明确

**位置：** 第 205 行 vs 第 157 行

**现状：**
```
事件定义：agent_at — "仅流程动态审计；非聊天区消息类型"
数据示例：{ type: "agent_at", messageId: "3" }
```

消息 #3 是一条真实 RoomMessage（有 content、quoteMessageId）。`agent_at` 的 `messageId` 指向这条真实消息。

**问题：** 标签是"需求分析师 → @前端工程师"（描述动作），但 `messageId` 指向动作的结果（新消息 #3）。用户点击后看到的是结果消息，不是动作本身。

**修复方案：**

明确 `messageId` 指向语义：

```typescript
// 修改位置：第 205 行
// 改前：
{ type: "agent_at", trigger: "Agent @另一 Agent 并创建新消息",
  labelTemplate: "{from} → @{to}", note: "仅流程动态审计；非聊天区消息类型" }

// 改后：
{ type: "agent_at", trigger: "Agent @另一 Agent 并创建新消息",
  labelTemplate: "{from} → @{to}", note: "messageId=新创建的消息（被 @Agent 的回复）；点击跳转到该消息" }
```

在数据示例中加注释（第 157 行）：

```typescript
// agent_at 的 messageId 指向新创建的消息（前端工程师的回复 #3），不是触发 @ 的源消息（需求分析师 #2）
{ id: "e8", type: "agent_at", label: "需求分析师 → @前端工程师", tone: "default", time: "14:06", messageId: "3" },
```

---

### 12. "停止生成"作用域定义模糊

**位置：** 第 866 行 vs 第 475 行

**现状：**
```
宪法第 9 条：仅当「当前用户最近发起引用链」内有 running 时显示
实现提示：仅取消你最近发起引用链内的 running
```

**问题：** "当前用户最近发起引用链"的定义不精确：
- 是按 `sender === currentUser` 过滤？
- 还是按 `attribution` 包含"用户 @指定"过滤？
- 用户发了两条消息，各有一个 running invocation，停止哪个？

**修复方案：**

明确作用域定义：

```markdown
停止生成作用域定义：

• 作用域 = 当前用户最后一条消息的直接子 invocation 中 state=running 的那一条
• 判定规则：找到 messages 中 senderType="user" 且 sender=currentUser 的最后一条消息 M，
  找到 quoteMessageId=M.id 且 state="running" 的消息，就是停止目标
• 如果用户最后一条消息有多个 running 子 invocation（并行模式），全部取消
• 他人消息的 invocation 不受影响
• 群级停止（取消所有 running）仅 admin 可用，需要二次确认
```

---

### 13. `FlowEvent.type` 是 `string` 不是枚举

**位置：** 第 130 行

**现状：**
```typescript
type FlowEvent = {
  type: string;  // 不是枚举
  ...
};
```

**问题：** `FLOW_EVENT_TYPE_SPEC`（第 189-208 行）定义了 18 种事件类型，但 `FlowEvent.type` 是任意字符串。前端无法做类型检查，容易拼写错误。

**修复方案：**

```typescript
// 修改位置：第 130 行
// 改前：
type: string;

// 改后：
type: FlowEventType;

// 新增枚举定义（第 127 行附近）：
type FlowEventType =
  | "topic_create" | "topic_split" | "topic_link" | "topic_closed"
  | "user_intent" | "manager_route" | "manager_retry" | "manager_relay" | "manager_complete"
  | "human_confirm_requested" | "human_confirm_accepted" | "human_confirm_rejected"
  | "invocation_running" | "invocation_succeeded" | "invocation_failed"
  | "agent_at" | "notification_sent" | "todo_created";
```

---

### 14. `RoomTopic.active` 未约束唯一

**位置：** 第 139 行

**现状：**
```typescript
type RoomTopic = {
  active: boolean;  // 没有约束只能一个为 true
  ...
};
```

**问题：** `FlowTimelinePanel`（第 239 行）用 `ROOM_TOPICS.find((t) => t.active)` 取第一个 active。如果多个话题 `active: true`，行为未定义。

**修复方案：**

在 `RoomTopic` 类型定义处加注释约束：

```typescript
type RoomTopic = {
  id: string;
  title: string;
  /** 同一房间内最多一个话题 active=true；切换时旧的自动置 false */
  active: boolean;
  totalEvents: number;
  events: FlowEvent[];
};
```

---

## 三、🟡 中优先级（交互/边界缺失）

### 15. ThreadBlockView 递归无深度限制

**位置：** 第 389-392 行

**现状：**
```typescript
const chain = (function collect(parentId, depth) {
  const children = messages.filter((m) => m.quoteMessageId === parentId);
  return children.flatMap((c) => [{ msg: c, depth }, ...collect(c.id, depth + 1)]);
})(rootId, 1);
```

**问题：** 设计规范说"深度上限 5 层"（第 972 行），但代码实现没有深度限制。循环引用会导致无限递归。

**修复方案：**

```typescript
// 修改位置：第 389-392 行
const MAX_THREAD_DEPTH = 5;

const chain = (function collect(parentId: string, depth: number): { msg: RoomMessage; depth: number }[] {
  if (depth > MAX_THREAD_DEPTH) return [];
  const children = messages.filter((m) => m.quoteMessageId === parentId);
  return children.flatMap((c) => [{ msg: c, depth }, ...collect(c.id, depth + 1)]);
})(rootId, 1);
```

超过深度上限时，消息显示 "⚠️ 引用链深度已达上限" 提示。

---

### 16. Avatar 缺少 `position: relative`

**位置：** 第 44-48 行

**现状：**
```tsx
<div style={{ width: size, height: size, borderRadius: 6, ... }}>
  {name.charAt(0).toUpperCase()}
  {type === "agent" && <span style={{ position: "absolute", ... }} />}
</div>
```

**问题：** Agent 在线状态指示器用 `position: "absolute"`，但父容器没有 `position: "relative"`。状态点会相对于最近的 relative 祖先定位，可能错位。

**修复方案：**

```tsx
// 修改位置：第 45 行
// 改前：
<div style={{ width: size, height: size, borderRadius: 6, background: colors[type] || colors.user, ... }}>

// 改后：
<div style={{ width: size, height: size, borderRadius: 6, position: "relative", background: colors[type] || colors.user, ... }}>
```

---

### 17. 非活跃话题折叠交互未定义

**位置：** 第 245-248 行

**现状：**
```tsx
{ROOM_TOPICS.filter((t) => !t.active).map((t) => (
  <div key={t.id} style={{ ... cursor: "pointer" }}>
    ▶ {t.title} ({t.totalEvents})
  </div>
))}
```

**问题：** 非活跃话题显示为折叠状态（▶），但点击后的行为未定义。

**修复方案：**

```markdown
非活跃话题折叠/展开交互：

• 默认折叠：显示 ▶ + 标题 + 事件计数
• 点击展开：显示该话题的完整流程动态时间轴（与活跃话题相同的 FlowTimelinePanel）
• 展开后变为 ▼，再次点击折叠
• 展开状态不持久化（每次进入房间默认折叠）
• 展开非活跃话题不切换活跃话题（活跃话题保持不变）
• 展开状态下如果该话题有新事件，不自动滚动（用户可能在阅读历史）
```

---

### 18. PendingAttentionBanner 点击行为未定义

**位置：** 第 408-414 行

**现状：**
```tsx
const PendingAttentionBanner = () => (
  <div style={{ ... cursor: "pointer" }}>
    ⚠️ 有 1 条待你确认的事项
    <span style={{ marginLeft: "auto" }}>查看 →</span>
  </div>
);
```

**问题：** 如果有 2 个 pending 事项，点击后跳转到哪个？处理完一个后自动跳下一个？

**修复方案：**

```markdown
PendingAttentionBanner 交互规则：

• 多个 pending 事项时，点击跳转到最早的那个（按时间排序）
• 处理完一个后，如果还有 pending，横幅保持显示，计数 -1
• 处理完最后一个后，横幅消失
• 点击"查看 →"跳转到对应消息并展开轻卡
• 横幅不自动滚动，用户手动定位
```

---

### 19. 消息编辑后 @mention 重处理未定义

**位置：** 第 1119-1122 行

**现状：**
```
编辑消息
• 仅可编辑自己的消息
• 乐观消息（发送中）不可编辑
• 保存后重新触发 @mention
```

**问题：** "保存后重新触发 @mention" 的具体行为未定义。

**修复方案：**

```markdown
消息编辑后 @mention 处理规则：

• 编辑不改变 @mention 列表：编辑内容不影响已有的 invocation
• 如果编辑新增了 @mention：为新增的 @mention 创建新的 invocation
• 如果编辑删除了 @mention：不取消已有的 invocation（已执行的不可撤回）
• 如果编辑修改了 @mention 目标（@A 改为 @B）：为 @B 创建新 invocation，@A 的 invocation 不受影响
• 编辑后的消息在聊天区显示 "已编辑" 标记
• 编辑不产生新的 flow_event（编辑是用户行为，不是 Agent 行为）
```

---

### 20. Manager Agent 被移除出房间

**位置：** 第 1468 行

**现状：**
```
无 Manager Agent → 有 @ 则直连；无 @ 则提示配置群管理
```

**问题：** 如果房间曾经有 Manager，正在处理路由模式的消息，此时 Manager 被移除，正在 pending/running 的消息和话题如何处理？

**修复方案：**

```markdown
Manager 被移除的处理规则：

• 正在 pending 的消息：状态变为 failed，显示 "群管理已移除，无法路由"
• 正在 running 的 invocation：继续执行直到完成（不中断）
• 正在进行中的话题：继续当前流程，不自动结案
• 新消息（Manager 移除后发送）：
  - 有 @ → 直连模式（正常）
  - 无 @ → 提示 "请配置群管理或直接 @Agent"
• 话题的 manager_complete 由系统自动触发（不需要 Manager 在线）
```

---

### 21. 房间内 0 人类成员

**位置：** 未定义

**问题：** 设计规范没有定义只有 Agent 没有人类的房间。

**修复方案：**

```markdown
全 Agent 房间规则：

• 允许创建全 Agent 房间（用于自动化流水线）
• 人工确认流程：如果话题需要人工确认，但房间内无人类成员：
  - 跳过 human_confirm，直接 topic_closed
  - 或者：发送通知到房间创建者的私信
• 归档/设置操作：需要至少一个人类成员才能执行管理操作
• @mention 规则：Agent 可以 @其他 Agent（正常工作）
```

---

### 22. 用户快速连续发消息

**位置：** 未定义

**问题：** 用户连发 3 条消息，Manager 是逐条路由还是合并处理？

**修复方案：**

```markdown
用户快速连续发消息处理规则：

• 每条消息独立处理：每条用户消息创建独立的话题和 invocation
• 不合并：即使 3 条消息语义相同，也作为 3 个独立话题处理
• 路由模式下：Manager 逐条分析意图，可能路由给不同 Agent
• 用户可以在发送后 5 秒内撤回（乐观更新，WS 确认后生效）
• 撤回的消息从聊天区移除，对应的 invocation 取消
```

---

### 23. 同一 Agent 多次 @

**位置：** 第 2147-2148 行

**现状：**
```
并发 @mention 同一 Agent
第一个 @ 进入 running；后续 @ 进入 queued 并显示等待计时
```

**问题：** 3 条消息 @同一 Agent 是 3 个独立 invocation 还是合并？

**修复方案：**

```markdown
同一 Agent 多次 @ 处理规则：

• 每条 @mention 创建独立的 invocation（不合并）
• 排队规则：同一 Agent 同时只能 running 一个 invocation，其余 queued
• 排队顺序：按消息发送时间排序（FIFO）
• 前一个完成后自动 dequeue 下一个
• 用户可以取消排队中的 invocation
• 如果用户取消了排队中的 invocation，后续排队的自动前移
```

---

### 24. 流程动态跳转的视图切换问题

**位置：** 第 1251 行

**现状：**
```
点击事件 → 滚动并高亮对应 message_id
```

**问题：** 从话题 B 的流程动态点击 `messageId` 定位到消息 #5，但消息 #5 在 ThreadBlock 视图中属于话题 A 的块。

**修复方案：**

```markdown
流程动态跳转规则：

• 点击事件 → 滚动并高亮对应 message_id
• 如果消息在当前视图中不可见（ThreadBlock 视图中属于另一个块）：
  - 自动切换到时间线视图
  - 在时间线视图中定位并高亮消息
  - 高亮动画：背景色闪变 primaryBg 一次，持续 2s
• 如果消息在当前视图中可见：直接滚动到消息位置并高亮
• 高亮完成后恢复消息原始样式
```

---

### 25. 流程动态 `messageId` 可能不在当前视图

**位置：** 第 229 行

**现状：**
```tsx
title={event.messageId ? `定位消息 #${event.messageId}` : undefined}
```

**问题：** 弱关联消息的 `primary_topic_id` 与当前话题不一致时，点击后消息不在当前 ThreadBlock 块里。

**修复方案：** 已在修复 #24 中一并解决——不可见时自动切换到时间线视图。

---

## 四、修复优先级汇总

| 批次 | 问题编号 | 类型 | 说明 |
|---|---|---|---|
| **第一批** | #1, #2, #3, #4, #5, #6 | 数据模型 + 流程闭环 | 阻塞性，不修复则流程不通 |
| **第二批** | #7, #8, #9, #10, #11, #12, #13, #14 | 规则明确化 | 定义补全，避免实现返工 |
| **第三批** | #15-25 | 交互/边界 | 体验完善，可分批实施 |

---

## 五、修改文件清单

所有修改都在 `.qoder/specs/room-ui-design.canvas.tsx` 内完成：

| 修改位置 | 行号 | 改动内容 |
|---|---|---|
| `MessageState` 枚举 | 81 | 加入 `sent`, `pending`, `cancelled` |
| `RoomMessage` 类型 | 83-97 | `senderType` 加 `squad` |
| `FlowEvent` 类型 | 128-136 | `type` 改为 `FlowEventType` 枚举 |
| `RoomTopic` 类型 | 137-144 | 加 `active` 唯一性注释 |
| 用户消息数据 | 105, 114, 122 | `state: "succeeded"` → `"sent"` |
| 流程动态数据 | 166-173 | 并行模式补充结案事件 |
| `RoomMessageRow` 状态映射 | 331-332 | 加新状态映射 |
| `RoomMessageRow` 渲染逻辑 | 357 | 加 `pending` 渲染分支 |
| `ThreadBlockView` 递归 | 389-392 | 加深度限制 |
| `Avatar` 组件 | 45 | 加 `position: "relative"` |
| `FlowTimelinePanel` 折叠 | 245-248 | 定义展开交互 |
| `PendingAttentionBanner` | 408-414 | 定义点击行为 |
| `agent_at` 事件定义 | 205 | 明确 `messageId` 语义 |
| 对照表 | 884 | 修改并行模式 review 描述 |
| 话题生命周期 | 1259 | 修改结束定义 |
| 关联方式说明 | 941-945 | 加优先级规则 |
| 结案时序 | 1525-1531 | 补拒绝路径 |
| 消息编辑规则 | 1119-1122 | 补 @mention 处理 |
| 停止生成定义 | 866, 475 | 明确作用域 |
