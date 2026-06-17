/**
 * 协作群 Room 域 — 唯一设计规范（Single Source of Truth）
 * 禁止另写平行实施方案；工程验收见 Tab「✅ 验收清单」。
 */
import { useState } from "react";

// ─── Design Tokens ───
const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceHover: "#22263a",
  border: "#2a2e3e",
  borderLight: "#363b50",
  text: "#e4e6ed",
  textMuted: "#8b90a0",
  textDim: "#5c6070",
  primary: "#6366f1",
  primaryLight: "#818cf8",
  primaryBg: "rgba(99,102,241,0.12)",
  green: "#22c55e",
  greenBg: "rgba(34,197,94,0.12)",
  red: "#ef4444",
  redBg: "rgba(239,68,68,0.12)",
  amber: "#f59e0b",
  amberBg: "rgba(245,158,11,0.12)",
  blue: "#3b82f6",
  blueBg: "rgba(59,130,246,0.12)",
};

// ─── Reusable UI atoms ───
const Badge = ({ children, color = C.primary, bg = C.primaryBg }: { children: React.ReactNode; color?: string; bg?: string }) => (
  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: bg, color, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>
);

const Btn = ({ children, variant = "default", onClick, disabled, small }: any) => {
  const base: React.CSSProperties = { padding: small ? "4px 10px" : "6px 14px", borderRadius: 6, fontSize: small ? 11 : 12, fontWeight: 500, cursor: disabled ? "default" : "pointer", border: "none", transition: "all 0.15s", opacity: disabled ? 0.5 : 1 };
  const styles: any = {
    default: { ...base, background: C.primary, color: "#fff" },
    ghost: { ...base, background: "transparent", color: C.textMuted },
    outline: { ...base, background: "transparent", color: C.text, border: `1px solid ${C.border}` },
    destructive: { ...base, background: C.red, color: "#fff" },
  };
  return <button style={styles[variant]} onClick={onClick} disabled={disabled}>{children}</button>;
};

const Avatar = ({ name, type = "user", size = 28 }: { name: string; type?: string; size?: number }) => {
  const colors: any = { user: "#6366f1", agent: "#8b5cf6", squad: "#06b6d4", system: "#6b7280" };
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: colors[type] || colors.user, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
};

const Divider = ({ label }: { label?: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0" }}>
    <div style={{ flex: 1, height: 1, background: C.border }} />
    {label && <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>}
    <div style={{ flex: 1, height: 1, background: C.border }} />
  </div>
);

// ─── Mock Data ───
const ROOMS = [
  { id: "1", name: "开发", desc: "贪吃蛇游戏开发", active: 0, unread: false },
  { id: "2", name: "产品讨论", desc: "需求评审与讨论", active: 2, unread: true },
  { id: "3", name: "运维告警", desc: "线上问题自动通知", active: 0, unread: false },
];

const MEMBERS = {
  users: [{ id: "u1", name: "dev（你）", role: "群主" }],
  agents: [
    { id: "a1", name: "需求分析师" },
    { id: "a2", name: "系统架构师" },
    { id: "a3", name: "前端工程师" },
    { id: "a4", name: "后端工程师" },
    { id: "a5", name: "SQA 团队长" },
    { id: "a6", name: "UI/UX 设计师" },
  ],
};

// ─── 消息模型（设计规范核心）───
/** 一条 Room 消息 = 一个 message_id；思考中→完成是同一消息的状态变迁，不是两条消息 */
type MessageState = "pending" | "queued" | "thinking" | "streaming" | "succeeded" | "failed" | "cancelled" | "timed_out" | "paused";
type ChatViewMode = "thread" | "timeline";
type RoomMessage = {
  id: string;
  sender: string;
  senderType: "user" | "agent";
  content: string;
  time: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** 强关联：引用/回应的父消息 id；ThreadBlock 由引用链聚合 */
  quoteMessageId?: string | null;
  quotePreview?: string;
  state: MessageState;
  /** 附带信息 pill，如「由群管理分配指定」— 非独立系统消息 */
  attribution?: string;
  humanAction?: { type: "confirm"; title: string; status: "pending" | "accepted" | "rejected" };
};

/**
 * Room 是一张消息事件图：
 * - MessageNode：RoomMessage，是聊天事实与 Agent 产出正文。
 * - ControlStepNode：route / relay / retry / confirm 等流程控制步骤，过程与结果共享 step_id，展示为一个原子节点。
 * - FlowEvent：append-only 审计事实；按 category 投影到消息节点、控制节点、确认节点或阶段压缩。
 * - Topic：阶段完成后对一段已闭合子图的压缩视图；可展开还原为原始消息节点 + 控制节点 + 事件。
 */
const SNAKE_MESSAGES: RoomMessage[] = [
  { id: "1", sender: "dev", senderType: "user", content: "开发一个贪吃蛇游戏啊", time: "14:02", state: "succeeded" },
  { id: "2", sender: "需求分析师", senderType: "agent", quoteMessageId: "1", quotePreview: "开发一个贪吃蛇游戏啊", time: "14:03", startedAt: "14:03", completedAt: "14:06", durationMs: 180000, state: "succeeded", attribution: "由群管理分配指定", content: "需求分析完成。方向键控制、得分、碰撞检测。@前端工程师 我有个问题，你回答一下" },
  { id: "3", sender: "前端工程师", senderType: "agent", quoteMessageId: "2", quotePreview: "需求分析完成…", time: "14:08", startedAt: "14:08", completedAt: "14:12", durationMs: 240000, state: "succeeded", attribution: "由 @需求分析师 指定", content: "这是我的回答。@需求分析师 请确认" },
  { id: "4", sender: "需求分析师", senderType: "agent", quoteMessageId: "3", quotePreview: "这是我的回答…", time: "14:13", startedAt: "14:13", completedAt: "14:15", durationMs: 120000, state: "succeeded", attribution: "由 @前端工程师 指定", content: "好的收到，问题已确认，需求分析完成。", humanAction: { type: "confirm", title: "群管判定贪吃蛇任务完成，请确认是否结案", status: "pending" } },
];

const SNAKE_MSG2_THINKING: RoomMessage = { ...SNAKE_MESSAGES[1], state: "thinking", content: "" };

const PARALLEL_MESSAGES: RoomMessage[] = [
  { id: "p0", sender: "dev", senderType: "user", content: "@前端工程师 @后端工程师 评估登录方案", time: "16:10", state: "succeeded" },
  { id: "p1", sender: "前端工程师", senderType: "agent", quoteMessageId: "p0", quotePreview: "@前端工程师 @后端工程师…", time: "16:11", state: "thinking", attribution: "用户 @指定", content: "" },
  { id: "p2", sender: "后端工程师", senderType: "agent", quoteMessageId: "p0", quotePreview: "@前端工程师 @后端工程师…", time: "16:11", state: "thinking", attribution: "用户 @指定", content: "" },
];

/** 房间内多任务：聊天区 ThreadBlock 按「用户根消息」分块并列展示 */
const MULTI_ROOM_MESSAGES: RoomMessage[] = [
  ...SNAKE_MESSAGES,
  { id: "5", sender: "dev", senderType: "user", content: "顺便评估一下登录页方案 @前端工程师 @后端工程师", time: "16:10", state: "succeeded" },
  ...PARALLEL_MESSAGES.slice(1).map((m) => ({ ...m, id: m.id === "p1" ? "6" : "7", quoteMessageId: "5" })),
];

// ─── 流程动态：消息事件图（append-only，模板文案）───
type FlowEventTone = "default" | "active" | "success" | "error" | "manager" | "human";
type FlowEventCategory = "message" | "control" | "confirm" | "phase" | "meta";
type ControlStepState = "pending" | "running" | "succeeded" | "failed" | "cancelled";
type FlowEvent = {
  id: string;
  type: string;
  category?: FlowEventCategory;
  /** 同一控制步骤的 running / succeeded / failed 共享 step_id，UI 合并成一个 ControlStepNode */
  stepId?: string;
  stepType?: "route" | "relay" | "retry" | "escalate" | "human_confirm" | "approval";
  stepState?: ControlStepState;
  label: string;
  tone?: FlowEventTone;
  time?: string;
  /** 双向定位：点击事件滚动并高亮对应消息 */
  messageId?: string;
  fromMessageId?: string;
  toMessageId?: string;
  topicId?: string;
};
type RoomTopic = {
  id: string;
  title: string;
  /** Topic 是阶段压缩视图，不是事件写入前提；压缩后默认折叠，可展开为原始事件子图 */
  status?: "compressed" | "expanded" | "archived";
  active: boolean;
  totalEvents: number;
  eventRange?: [string, string];
  summary?: string;
  /** 完整时间轴；UI 默认只渲染末尾 PAGE_SIZE 条 */
  events: FlowEvent[];
};

const FLOW_PAGE_SIZE = 20;

const SNAKE_FLOW_EVENTS: FlowEvent[] = [
  { id: "e1", type: "user_intent", category: "message", label: "用户发起任务", tone: "default", time: "14:02", messageId: "1" },
  { id: "e2a", type: "manager_route_running", category: "control", stepId: "route-1", stepType: "route", stepState: "running", label: "群管路由 · 决策中", tone: "manager", time: "14:02", fromMessageId: "1" },
  { id: "e2b", type: "manager_route_succeeded", category: "control", stepId: "route-1", stepType: "route", stepState: "succeeded", label: "群管路由 · 分配给 需求分析师", tone: "manager", time: "14:02", fromMessageId: "1", toMessageId: "2", messageId: "2" },
  { id: "e3", type: "invocation_running", category: "message", label: "需求分析师 · 思考中", tone: "active", time: "14:03", messageId: "2" },
  { id: "e4", type: "invocation_failed", category: "message", label: "需求分析师 · 失败", tone: "error", time: "14:04", messageId: "2" },
  { id: "e5", type: "manager_retry_succeeded", category: "control", stepId: "retry-1", stepType: "retry", stepState: "succeeded", label: "群管重试 · 需求分析师", tone: "manager", time: "14:04", fromMessageId: "1", toMessageId: "2" },
  { id: "e6", type: "invocation_running", category: "message", label: "需求分析师 · 思考中", tone: "active", time: "14:05", messageId: "2" },
  { id: "e7", type: "invocation_succeeded", category: "message", label: "需求分析师 · 完成", tone: "success", time: "14:06", messageId: "2" },
  { id: "e8", type: "agent_at_succeeded", category: "control", stepId: "relay-a2a-1", stepType: "relay", stepState: "succeeded", label: "需求分析师 → @前端工程师", tone: "default", time: "14:06", fromMessageId: "2", toMessageId: "3", messageId: "3" },
  { id: "e9", type: "invocation_running", category: "message", label: "前端工程师 · 思考中", tone: "active", time: "14:07", messageId: "3" },
  { id: "e10", type: "invocation_succeeded", category: "message", label: "前端工程师 · 完成", tone: "success", time: "14:12", messageId: "3" },
  { id: "e11", type: "agent_at_succeeded", category: "control", stepId: "relay-a2a-2", stepType: "relay", stepState: "succeeded", label: "前端工程师 → @需求分析师", tone: "default", time: "14:12", fromMessageId: "3", toMessageId: "4", messageId: "4" },
  { id: "e12", type: "invocation_running", category: "message", label: "需求分析师 · 思考中", tone: "active", time: "14:13", messageId: "4" },
  { id: "e13", type: "invocation_succeeded", category: "message", label: "需求分析师 · 完成", tone: "success", time: "14:15", messageId: "4" },
  { id: "e14", type: "manager_complete_succeeded", category: "control", stepId: "complete-1", stepType: "human_confirm", stepState: "succeeded", label: "群管判定阶段可结案", tone: "manager", time: "14:15", fromMessageId: "4" },
  { id: "e15", type: "human_confirm_requested", category: "confirm", stepId: "confirm-1", stepType: "human_confirm", stepState: "running", label: "待 dev 确认结案", tone: "human", time: "14:15", messageId: "4" },
  { id: "e16", type: "todo_created", category: "meta", label: "已添加待办 · 确认贪吃蛇任务结案", tone: "human", time: "14:15" },
  { id: "e17", type: "notification_sent", category: "meta", label: "已通知 dev", tone: "human", time: "14:15" },
  { id: "e18", type: "human_confirm_accepted", category: "confirm", stepId: "confirm-1", stepType: "human_confirm", stepState: "succeeded", label: "dev 已确认结案", tone: "success", time: "14:18" },
  { id: "e19", type: "topic_compressed", category: "phase", topicId: "topic1", label: "阶段已压缩 · 贪吃蛇游戏开发", tone: "success", time: "14:18" },
];

const REJECT_FLOW_EVENTS: FlowEvent[] = [
  { id: "r1", type: "human_confirm_requested", label: "待 dev 确认结案", tone: "human", time: "14:15", messageId: "4" },
  { id: "r2", type: "human_confirm_rejected", label: "dev 已拒绝 · 需要先验收手机操作", tone: "error", time: "14:18", messageId: "4" },
  { id: "r3", type: "manager_relay", label: "群管 → 接力给 前端工程师补充", tone: "manager", time: "14:18", messageId: "3" },
];

const SNAKE_CURRENT_FLOW_EVENTS = SNAKE_FLOW_EVENTS.filter((ev) => ev.type !== "human_confirm_accepted" && ev.type !== "topic_compressed");

const PARALLEL_FLOW_EVENTS: FlowEvent[] = [
  { id: "pfe1", type: "user_intent", category: "message", label: "用户 @前端工程师 @后端工程师", tone: "default", time: "16:10", messageId: "p0" },
  { id: "pfe2", type: "invocation_running", category: "message", label: "前端工程师 · 思考中", tone: "active", time: "16:11", messageId: "p1" },
  { id: "pfe3", type: "invocation_running", category: "message", label: "后端工程师 · 思考中", tone: "active", time: "16:11", messageId: "p2" },
  { id: "pfe4", type: "invocation_succeeded", category: "message", label: "前端工程师 · 完成", tone: "success", time: "16:18", messageId: "p1" },
  { id: "pfe5", type: "invocation_succeeded", category: "message", label: "后端工程师 · 完成", tone: "success", time: "16:20", messageId: "p2" },
  { id: "pfe6", type: "topic_compressed", category: "phase", topicId: "topic2", label: "阶段已压缩 · 登录页方案评估", tone: "success", time: "16:22" },
];

const ROOM_TOPICS: RoomTopic[] = [
  { id: "topic1", title: "贪吃蛇游戏开发", status: "expanded", active: true, totalEvents: SNAKE_CURRENT_FLOW_EVENTS.length, events: SNAKE_CURRENT_FLOW_EVENTS, eventRange: ["e1", "e18"], summary: "需求、前端实现与结案确认已串联完成" },
  { id: "topic2", title: "登录页方案评估", status: "compressed", active: false, totalEvents: PARALLEL_FLOW_EVENTS.length, events: PARALLEL_FLOW_EVENTS, eventRange: ["pfe1", "pfe6"], summary: "前后端并行评估完成，等待后续决策" },
];

const WORKBOARD_SNAPSHOT = {
  /** 待处理 = 需人工确认/授权/冲突处理的事项数 */
  pending: 1,
  running: 2,
  activeStageId: "topic1",
  topics: ROOM_TOPICS,
  /** 阶段摘要：对已闭合消息事件子图的压缩展示 */
  compressedTopics: [
    { id: "topic1", title: "贪吃蛇游戏开发", status: "展开中" as const },
    { id: "topic2", title: "登录页方案评估", status: "已压缩" as const },
  ],
};

const FLOW_EVENT_TYPE_SPEC: { category: FlowEventCategory; type: string; trigger: string; projection: string; note?: string }[] = [
  { category: "message", type: "invocation_running/succeeded/failed", trigger: "Agent 消息状态变迁", projection: "折叠进同一 AgentMessage 节点", note: "message_id 必填；不单独占行" },
  { category: "control", type: "manager_route_*", trigger: "无 @ 消息需要群管路由", projection: "同 step_id 合并为 RouteStep 原子节点", note: "running 与结果不拆两行" },
  { category: "control", type: "manager_relay_* / agent_at_*", trigger: "接力或 Agent 互@", projection: "同 step_id 合并为 RelayStep，成功后连到新 AgentMessage", note: "聊天区无 relay_hint/agent_at 卡" },
  { category: "control", type: "manager_retry_* / manager_escalate_*", trigger: "失败、超时、僵局", projection: "RetryStep / EscalateStep 原子节点", note: "失败时挂 RouteFailurePicker 或升级横幅" },
  { category: "confirm", type: "human_confirm_* / approval_*", trigger: "结案、审批、冲突处理", projection: "ConfirmStep 原子节点 + 消息轻卡 / Composer 横幅", note: "pending_count 只统计此类待处理" },
  { category: "phase", type: "topic_compressed", trigger: "人工确认通过或授权结案", projection: "压缩一段已闭合子图为 TopicCard", note: "可展开还原原始事件" },
  { category: "meta", type: "notification_sent / todo_created", trigger: "通知、待办等副作用", projection: "挂在相关 ConfirmStep 下，默认折叠", note: "不污染主流程图" },
];

// ─── 流程动态 UI ───

const flowToneColor = (tone?: FlowEventTone) => {
  if (tone === "active") return C.amber;
  if (tone === "success") return C.green;
  if (tone === "error") return C.red;
  if (tone === "manager") return C.primaryLight;
  if (tone === "human") return C.blue;
  return C.textMuted;
};

const FlowEventRow = ({ event, isLatest }: { event: FlowEvent; isLatest?: boolean }) => (
  <div
    style={{
      display: "flex", gap: 6, padding: "3px 0", fontSize: 10, lineHeight: 1.5,
      color: flowToneColor(event.tone),
      fontWeight: isLatest ? 500 : 400,
      cursor: event.messageId ? "pointer" : "default",
    }}
    title={event.messageId ? `定位消息 #${event.messageId}` : undefined}
  >
    <span style={{ color: C.textDim, flexShrink: 0, width: 32, fontSize: 9 }}>{event.time || ""}</span>
    <span style={{ width: 4, height: 4, borderRadius: "50%", background: flowToneColor(event.tone), marginTop: 5, flexShrink: 0 }} />
    <span style={{ flex: 1 }}>{event.label}{event.messageId ? <span style={{ color: C.textDim }}> · #{event.messageId}</span> : null}</span>
  </div>
);

/** 流程动态：默认折叠已压缩阶段，展开当前消息事件子图；向上滚动加载更早事件 */
const FlowTimelinePanel = ({ compact = false, showLoadMoreHint = false }: { compact?: boolean; showLoadMoreHint?: boolean }) => {
  const active = ROOM_TOPICS.find((t) => t.active) || ROOM_TOPICS[0];
  const visible = active.events.slice(-FLOW_PAGE_SIZE);
  const hiddenCount = active.totalEvents - visible.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {ROOM_TOPICS.filter((t) => !t.active).map((t) => (
        <div key={t.id} style={{ fontSize: 10, color: C.textDim, padding: "4px 0", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
          ▶ {t.title} <span style={{ color: C.textDim }}>({t.totalEvents} events · Topic 压缩)</span>
        </div>
      ))}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text, padding: "6px 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
        当前阶段 · {active.title}
      </div>
      <div style={{
        maxHeight: compact ? 140 : 220,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        paddingRight: 2,
      }}>
        {(showLoadMoreHint || hiddenCount > 0) && (
          <div style={{ textAlign: "center", fontSize: 9, color: C.textDim, padding: "6px 0", borderBottom: `1px dashed ${C.border}`, marginBottom: 4 }}>
            ↑ 向上滚动加载更早 {hiddenCount > 0 ? `${hiddenCount} 条` : "记录"}
          </div>
        )}
        {visible.map((ev, i) => (
          <FlowEventRow key={ev.id} event={ev} isLatest={i === visible.length - 1} />
        ))}
      </div>
      {!compact && (
        <div style={{ fontSize: 9, color: C.textDim, marginTop: 4, textAlign: "right" }}>
          新事件自动滚至最新 ↓
        </div>
      )}
    </div>
  );
};

// ─── ThreadBlock UI primitives ───

const RouteFailurePicker = () => (
  <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", background: C.redBg, borderRadius: 8, border: `1px solid ${C.red}30` }}>
    <span style={{ fontSize: 11, color: C.red }}>群管理未能确定负责人</span>
    <Btn small variant="outline">选择 Agent ▾</Btn>
    <Btn small variant="ghost">重试路由</Btn>
  </div>
);

const QuotePreview = ({ preview }: { preview: string }) => (
  <div style={{ fontSize: 10, color: C.textDim, borderLeft: `2px solid ${C.border}`, paddingLeft: 8, marginBottom: 6, lineHeight: 1.4 }}>
    {preview}
  </div>
);

const AttributionPill = ({ text }: { text: string }) => (
  <span style={{ fontSize: 9, color: C.textDim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "2px 6px" }}>{text}</span>
);

const HumanConfirmLightCard = ({ title, status = "pending" }: { title: string; status?: string }) => (
  <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.amber}40`, background: C.amberBg, fontSize: 11 }}>
    <div style={{ fontWeight: 600, color: C.amber, marginBottom: 6 }}>待你确认</div>
    <div style={{ color: C.text, marginBottom: 8 }}>{title}</div>
    {status === "pending" && (
      <div style={{ display: "flex", gap: 6 }}>
        <Btn small>接受</Btn>
        <Btn small variant="outline">拒绝</Btn>
      </div>
    )}
    {status === "accepted" && <div style={{ color: C.green, fontSize: 10 }}>✓ 已确认</div>}
    {status === "rejected" && <div style={{ color: C.red, fontSize: 10 }}>✗ 已拒绝：需补充需求后再结案</div>}
  </div>
);

const HumanConfirmRejectDialog = () => (
  <div style={{ maxWidth: 360, background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16 }}>
    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8 }}>拒绝确认</div>
    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>请说明拒绝原因（必填），将通知群管与其他相关成员。</div>
    <textarea
      style={{ width: "100%", minHeight: 72, padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
      placeholder="例如：需求尚未验收，不能结案"
    />
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
      <Btn small variant="ghost">取消</Btn>
      <Btn small variant="destructive">提交拒绝</Btn>
    </div>
  </div>
);

const RoomMessageRow = ({ msg, indent = 0, showQuote = true }: { msg: RoomMessage; indent?: number; showQuote?: boolean }) => {
  const isUser = msg.senderType === "user";
  const stateLabel: Record<MessageState, string> = { pending: "等待", queued: "排队中", thinking: "思考中", streaming: "输出中", succeeded: "完成", failed: "失败", cancelled: "已取消", timed_out: "超时", paused: "已暂停" };
  const stateColor: Record<MessageState, string> = { pending: C.textDim, queued: C.textDim, thinking: C.amber, streaming: C.amber, succeeded: C.green, failed: C.red, cancelled: C.textDim, timed_out: C.red, paused: C.amber };
  return (
    <div style={{ marginBottom: 10, paddingLeft: indent * 14, marginLeft: indent > 0 ? 4 : 0, borderLeft: indent > 0 ? `2px solid ${C.border}` : undefined }}>
      <div style={{ display: "flex", gap: 8, flexDirection: isUser ? "row-reverse" : "row" }}>
        {!isUser && <Avatar name={msg.sender} type="agent" size={24} />}
        <div style={{ flex: 1, minWidth: 0, maxWidth: "85%" }}>
          {!isUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: C.textMuted }}>{msg.sender}</span>
              <Badge color={stateColor[msg.state]} bg={`${stateColor[msg.state]}20`}>{stateLabel[msg.state]}</Badge>
              <span style={{ fontSize: 9, color: C.textDim }}>#{msg.id}</span>
              {msg.attribution && <AttributionPill text={msg.attribution} />}
            </div>
          )}
          {showQuote && msg.quotePreview && !isUser && <QuotePreview preview={msg.quotePreview} />}
          {isUser ? (
            <div style={{ background: C.surface, padding: "8px 14px", borderRadius: 16, fontSize: 13, color: C.text, borderLeft: `3px solid ${C.primary}30`, textAlign: "right" }}>
              {msg.content}
            </div>
          ) : msg.state === "queued" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textDim }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>⠋</span>
              <span>排队中 · 等待前序任务</span>
              <Btn small variant="ghost">取消排队</Btn>
            </div>
          ) : msg.state === "pending" || msg.state === "paused" || msg.state === "cancelled" || msg.state === "timed_out" ? (
            <div style={{ fontSize: 12, color: stateColor[msg.state], lineHeight: 1.6 }}>
              {msg.state === "pending" && "等待群管分配"}
              {msg.state === "paused" && "已暂停，需要管理员恢复"}
              {msg.state === "cancelled" && "已取消"}
              {msg.state === "timed_out" && "执行超时，可重试"}
            </div>
          ) : msg.state === "thinking" || msg.state === "streaming" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>⠋</span>
              <span>{msg.state === "streaming" ? msg.content || "输出中…" : "思考中"}</span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{msg.content}</div>
          )}
          {msg.humanAction?.status === "pending" && <HumanConfirmLightCard title={msg.humanAction.title} />}
        </div>
      </div>
    </div>
  );
};

/** ThreadBlock 房间视图：多个用户根消息 → 多个块并列；时间线视图 → 全量平铺 */
const ChatMessageList = ({ messages, viewMode }: { messages: RoomMessage[]; viewMode: ChatViewMode }) => {
  if (viewMode === "timeline") return <TimelineView messages={messages} />;
  const roots = messages.filter((m) => m.senderType === "user" && !m.quoteMessageId);
  return (
    <div>
      {roots.map((root) => <ThreadBlockView key={root.id} rootId={root.id} messages={messages} />)}
    </div>
  );
};

/** ThreadBlock 视图：按 quote_message_id 强关联链聚合 */
const ThreadBlockView = ({ rootId, messages }: { rootId: string; messages: RoomMessage[] }) => {
  const root = messages.find((m) => m.id === rootId)!;
  const chain = (function collect(parentId: string, depth: number): { msg: RoomMessage; depth: number }[] {
    const children = messages.filter((m) => m.quoteMessageId === parentId);
    return children.flatMap((c) => [{ msg: c, depth }, ...collect(c.id, depth + 1)]);
  })(rootId, 1);
  return (
    <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
      <RoomMessageRow msg={root} indent={0} showQuote={false} />
      {chain.map(({ msg, depth }) => <RoomMessageRow key={msg.id} msg={msg} indent={depth} />)}
    </div>
  );
};

/** 时间线视图：按消息时间排序，每条显式引用预览（企微风格） */
const TimelineView = ({ messages }: { messages: RoomMessage[] }) => (
  <div>
    {messages.map((msg) => <RoomMessageRow key={msg.id} msg={msg} indent={0} showQuote={!!msg.quotePreview} />)}
  </div>
);

const PendingAttentionBanner = () => (
  <div style={{ padding: "8px 16px", background: `${C.amber}12`, borderBottom: `1px solid ${C.amber}30`, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.amber, cursor: "pointer" }}>
    <span>⚠️</span>
    <span>有 1 条待你确认的事项</span>
    <span style={{ marginLeft: "auto", fontSize: 11 }}>查看 →</span>
  </div>
);

const ChatHeaderBar = ({ viewMode, onToggleView }: { viewMode: ChatViewMode; onToggleView?: () => void }) => (
  <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.bg }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>开发</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>房间全量消息 · 看板话题不影响此处过滤</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, color: C.amber }}>
          <span style={{ animation: "pulse 1.5s infinite" }}>⠋</span>
          <span>需求分析师 正在思考</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <Btn small variant={viewMode === "timeline" ? "default" : "outline"} onClick={onToggleView}>
          {viewMode === "thread" ? "时间线" : "线程块"}
        </Btn>
        <Btn small variant="ghost">⚙️</Btn>
      </div>
    </div>
  </div>
);

// ─── Screen Components ───

// Screen 1: Room List Sidebar
const RoomListScreen = ({ onSelect }: { onSelect: (s: string) => void }) => (
  <div style={{ width: 260, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
    <div style={{ padding: "12px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>💬 协作群</span>
      </div>
      <Btn small variant="ghost" onClick={() => onSelect("create_dialog")}>＋</Btn>
    </div>
    <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
      {ROOMS.map((r, i) => (
        <div key={r.id} onClick={() => onSelect("room_view")} style={{
          padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
          background: i === 0 ? C.surfaceHover : "transparent",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{r.name}</span>
            {r.unread && <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.primary }} />}
            {r.active > 0 && <Badge color={C.green} bg={C.greenBg}>{r.active} 进行中</Badge>}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{r.desc}</div>
        </div>
      ))}
    </div>
  </div>
);

// Screen 2: Main Chat Area
const ChatAreaScreen = ({ onNavigate, viewMode = "thread", onToggleView }: { onNavigate: (s: string) => void; viewMode?: ChatViewMode; onToggleView?: () => void }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.bg }}>
    <ChatHeaderBar viewMode={viewMode} onToggleView={onToggleView} />
    {WORKBOARD_SNAPSHOT.pending > 0 && <PendingAttentionBanner />}
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
      <ChatMessageList messages={MULTI_ROOM_MESSAGES} viewMode={viewMode} />
    </div>
    <div style={{ padding: "8px 16px 0", textAlign: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted, cursor: "pointer" }} title="仅取消你最近发起引用链内的 running">
        <span style={{ color: C.red }}>■</span> 停止生成
      </div>
      <div style={{ fontSize: 9, color: C.textDim, marginTop: 4 }}>仅当前用户引用链 · 不误伤他人并行任务</div>
    </div>
    <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "12px 14px" }}>
        <div style={{ fontSize: 13, color: C.textDim, minHeight: 20 }}>输入消息，@ 提及本群成员或 Agent…</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#fff" }}>↑</div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 10, color: C.textDim, marginTop: 6 }}>Enter 发送 · Shift+Enter 换行</div>
    </div>
  </div>
);

// Screen 3: Members Panel
const MembersPanelScreen = () => (
  <div style={{ width: 220, background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13 }}>👥</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>群成员</span>
        <span style={{ fontSize: 11, color: C.textMuted }}>7</span>
      </div>
      <Btn small variant="ghost">＋</Btn>
    </div>
    <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", padding: "4px 8px", marginBottom: 4 }}>成员</div>
      {MEMBERS.users.map((u) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}>
          <Avatar name={u.name} type="user" size={26} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{u.name}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{u.role}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", padding: "8px 8px 4px", marginTop: 8 }}>Agent</div>
      {MEMBERS.agents.map((a) => {
        const isRunning = a.name === "需求分析师" || a.name === "前端工程师";
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}>
            <div style={{ position: "relative" }}>
              <Avatar name={a.name} type="agent" size={26} />
              {isRunning && <div style={{ position: "absolute", bottom: -1, right: -1, width: 7, height: 7, borderRadius: "50%", background: C.green, border: `1.5px solid ${C.surface}`, animation: "pulse 1.5s infinite" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{a.name}</div>
              <div style={{ fontSize: 10, color: C.primaryLight }}>智能体</div>
            </div>
          </div>
        );
      })}
    </div>
    {/* Workboard: 阶段压缩 + 流程动态 */}
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>工作看板</span>
        <div style={{ fontSize: 10, color: C.textDim }} title="待处理=人工确认事项">待处理 {WORKBOARD_SNAPSHOT.pending} · 运行中 {WORKBOARD_SNAPSHOT.running}</div>
      </div>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>阶段摘要</div>
      {WORKBOARD_SNAPSHOT.compressedTopics.map((t) => (
        <div key={t.id} style={{ fontSize: 11, color: t.id === WORKBOARD_SNAPSHOT.activeStageId ? C.text : C.textMuted, padding: "2px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 6 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
          <span style={{ fontSize: 9, color: t.status === "展开中" ? C.amber : C.green, flexShrink: 0 }}>{t.status}</span>
        </div>
      ))}
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", margin: "8px 0 4px" }}>流程动态</div>
      <FlowTimelinePanel compact showLoadMoreHint={false} />
    </div>
  </div>
);

// Screen: Create Room Dialog
const CreateRoomDialogScreen = () => (
  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
    <div style={{ width: 440, maxHeight: "85vh", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>新建协作群</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>配置群管理 Agent 与工作成员</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "block", marginBottom: 6 }}>群名称</label>
          <input style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} placeholder="例如：需求开发" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>✓</div>
          <span style={{ fontSize: 12, color: C.text }}>启用群管理（推荐）</span>
        </div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Btn small>新建群管理</Btn>
            <Btn small variant="outline">已有 Agent</Btn>
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>群管理名称：<span style={{ color: C.text }}>「群名」管理</span></div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>Runtime</label>
            <div style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, color: C.text }}>Local Daemon</div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>模型</label>
            <div style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, color: C.text }}>claude-sonnet-4</div>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "block", marginBottom: 6 }}>Agent 成员</label>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 100, overflow: "auto", padding: 6 }}>
            {MEMBERS.agents.slice(0, 3).map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 4 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${C.border}` }} />
                <Avatar name={a.name} type="agent" size={20} />
                <span style={{ fontSize: 12, color: C.text }}>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "block", marginBottom: 6 }}>工作区成员</label>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 80, overflow: "auto", padding: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 4 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${C.primary}`, background: C.primaryBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: C.primary }}>✓</div>
              <Avatar name="dev" type="user" size={20} />
              <span style={{ fontSize: 12, color: C.text }}>dev（你）</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost">取消</Btn>
        <Btn>创建</Btn>
      </div>
    </div>
  </div>
);

// Screen: Settings Sheet
const SettingsSheetScreen = () => (
  <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 380, background: C.surface, borderLeft: `1px solid ${C.border}`, zIndex: 10, display: "flex", flexDirection: "column" }}>
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>群设置</div>
      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>修改群信息、群管理 Agent，或归档/退出群聊</div>
    </div>
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "block", marginBottom: 6 }}>群名称</label>
        <input style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} defaultValue="开发" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "block", marginBottom: 6 }}>群描述</label>
        <textarea style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, outline: "none", resize: "vertical", minHeight: 60, boxSizing: "border-box" }} defaultValue="贪吃蛇游戏开发项目" />
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>群管理 Agent</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>开发管理</div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>Runtime</label>
          <div style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, color: C.text }}>Local Daemon</div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>模型</label>
          <div style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12, color: C.text }}>claude-sonnet-4</div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>管理 Prompt</label>
          <div style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, fontSize: 11, color: C.textMuted, lineHeight: 1.5, minHeight: 60 }}>
            你是协作群的管理 Agent。你的职责是分析意图、路由到合适 Agent、评估是否接力…
          </div>
        </div>
      </div>
      <Btn>保存修改</Btn>
      <Divider label="危险操作" />
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>归档此群</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>归档后群聊将从列表移除，进行中的 @ 任务会被取消</div>
        <Btn variant="destructive">归档此群</Btn>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>退出群聊</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>退出后不再收到此群消息</div>
        <Btn variant="outline">退出群聊</Btn>
      </div>
    </div>
  </div>
);

// Screen: Mention Suggestion
const MentionSuggestionScreen = () => (
  <div style={{ position: "absolute", bottom: 100, left: 200, width: 260, background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden", zIndex: 20 }}>
    <div style={{ padding: "6px 10px", fontSize: 10, color: C.textDim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>提及成员</div>
    {MEMBERS.agents.slice(0, 4).map((a, i) => (
      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", background: i === 0 ? C.surfaceHover : "transparent" }}>
        <Avatar name={a.name} type="agent" size={22} />
        <span style={{ fontSize: 12, color: C.text }}>{a.name}</span>
        <span style={{ fontSize: 10, color: C.primaryLight, marginLeft: "auto" }}>智能体</span>
      </div>
    ))}
  </div>
);

// Screen: Message Actions (Hover)
const MessageActionsScreen = () => (
  <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 4, display: "flex", gap: 2 }}>
    {["💬 引用回复", "✏️ 编辑", "📋 复制", "🔄 重新生成"].map((a) => (
      <div key={a} style={{ padding: "4px 8px", borderRadius: 4, fontSize: 11, color: C.textMuted, cursor: "pointer", whiteSpace: "nowrap" }}>{a}</div>
    ))}
  </div>
);

// Screen: Approval Card
const ApprovalCardScreen = () => (
  <div style={{ border: `1px solid ${C.amberBg}`, borderRadius: 10, padding: 12, background: C.amberBg, maxWidth: 340 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      <span style={{ fontSize: 14 }}>⚠️</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.amber }}>需要审批</span>
    </div>
    <div style={{ fontSize: 12, color: C.text, marginBottom: 8, lineHeight: 1.5 }}>
      前端工程师请求执行：<strong>删除旧版 static 目录并重新构建</strong>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <Btn small>✓ 批准</Btn>
      <Btn small variant="outline">✗ 拒绝</Btn>
    </div>
  </div>
);

// Screen: 看板流程动态（完整线框）
const WorkboardFlowScreen = () => (
  <div style={{ maxWidth: 280, background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>工作看板</span>
      <span style={{ fontSize: 10, color: C.textDim }}>待处理 {WORKBOARD_SNAPSHOT.pending} · 运行中 {WORKBOARD_SNAPSHOT.running}</span>
    </div>
      <div style={{ fontSize: 9, color: C.textDim, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>阶段摘要</div>
    {WORKBOARD_SNAPSHOT.compressedTopics.map((t) => (
      <div key={t.id} style={{ fontSize: 10, color: t.id === WORKBOARD_SNAPSHOT.activeStageId ? C.text : C.textMuted, padding: "2px 0", display: "flex", justifyContent: "space-between" }}>
        <span>{t.title}</span>
        <span style={{ color: t.status === "展开中" ? C.amber : C.green }}>{t.status}</span>
      </div>
    ))}
    <div style={{ fontSize: 9, color: C.textDim, fontWeight: 600, textTransform: "uppercase", margin: "6px 0 4px" }}>流程动态</div>
    <FlowTimelinePanel showLoadMoreHint />
  </div>
);

// ─── Flow Diagram Component ───
const FlowDiagram = () => {
  const flows = [
    {
      title: "路由模式（无 @）",
      steps: [
        { label: "用户输入消息（无 @）", color: C.primary },
        { label: "RouteStep 原子节点", color: C.primaryLight },
        { label: "成功后创建 Agent 消息", color: C.amber },
        { label: "Agent 执行任务", color: C.blue },
        { label: "Review/RelayStep 原子节点", color: C.primaryLight },
        { label: "接力 / 确认 / 压缩阶段", color: C.green },
      ],
    },
    {
      title: "直连模式（有 @）",
      steps: [
        { label: "用户 @具体 Agent", color: C.primary },
        { label: "Manager 不 route", color: C.textDim },
        { label: "被 @Agent 直接执行", color: C.blue },
        { label: "Agent 完成回复", color: C.green },
        { label: "默认结束（仅异常升级）", color: C.green },
        { label: "异常时可建议升级", color: C.red },
      ],
    },
    {
      title: "并行指派（多 @）",
      steps: [
        { label: "用户 @多个 Agent", color: C.primary },
        { label: "Manager 不 route/review", color: C.textDim },
        { label: "并列创建 N 个 invocation", color: C.amber },
        { label: "N 条消息并列 quote 用户消息", color: C.blue },
        { label: "各自独立完成", color: C.green },
      ],
    },
    {
      title: "Agent 互@协作",
      steps: [
        { label: "Agent A 完成回复", color: C.blue },
        { label: "A 回复中 @Agent B", color: C.blue },
        { label: "创建 B 新消息 quote A", color: C.amber },
        { label: "attribution=由 @A 指定", color: C.blue },
        { label: "Manager 观察不介入", color: C.textDim },
        { label: "异常 → 升级横幅", color: C.red },
      ],
    },
    {
      title: "Invocation 生命周期",
      steps: [
        { label: "pending → queued", color: C.textDim },
        { label: "queued → running", color: C.amber },
        { label: "running → succeeded", color: C.green },
        { label: "running → failed", color: C.red },
        { label: "* → cancelled", color: C.textDim },
        { label: "failed → running (retry)", color: C.blue },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      {flows.map((f) => (
        <div key={f.title} style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>{f.title}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {f.steps.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                {i < f.steps.length - 1 && <div style={{ position: "absolute", width: 2, height: 16, background: C.border, marginLeft: 9, marginTop: 24 }} />}
                <span style={{ fontSize: 12, color: C.text }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Backend Design Component ───
const BackendDesignScreen = () => (
  <div>
    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>前后端架构与契约方案</h2>
    <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 760 }}>
      UI 规范依赖后端提供稳定的消息事件图、控制步骤、阶段压缩、人工确认与实时事件契约。后端不应把这些逻辑散落在 completion/worker/handler 中，
      应以「RoomMessage 为内容节点、ControlStep 为流程原子、FlowEvent 为审计源、Topic 为事后压缩视图、Snapshot 为看板派生状态」组织。
    </p>

    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, marginBottom: 28 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>核心数据表/对象</h3>
        <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.85 }}>
          {[
            ["room_messages", "内容节点事实源；quote_message_id、content、metadata、created_at；message_state 由 invocation 派生"],
            ["room_control_steps", "控制步骤原子；step_type、state、from_message_id、to_message_id、payload；route running/result 合并到同一 step"],
            ["room_topics", "阶段压缩视图；title、summary、event_range_start/end、compressed_at、expanded 状态；不作为事件写入前提"],
            ["room_flow_events", "append-only 审计流；category、step_id?、message_id?、from/to_message_id?、topic_id?、type、payload、created_at"],
            ["room_invocations", "执行状态机；message_id 唯一绑定，task_id、retry_of/root_message_id、chain_depth、timeout_at"],
            ["room_human_actions", "人工事项；confirm/approval/conflict，status=pending/accepted/rejected/expired、assignee_id、reason"],
            ["room_snapshots", "看板派生快照；pending_count、running_count、active_graph_id、compressed_topics、latest_event_id"],
          ].map(([name, desc]) => (
            <div key={name} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: "monospace", color: C.primaryLight }}>{name}</div>
              <div style={{ color: C.textMuted }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>事务边界</h3>
        <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
          <div>• 发送用户消息：room_message + user_intent flow_event 同事务；不要求先创建 Topic</div>
          <div>• 路由步骤：manager_route_running 创建/更新 control_step；成功后补 to_message_id 并创建 Agent room_message + invocation</div>
          <div>• Agent 完成：message.content + invocation.status + message 类 flow_event 同事务；广播 room:message_updated</div>
          <div>• 人工确认：human_action.status + confirm 类 flow_event + snapshot.pending_count 同事务；接受后可触发 topic_compressed</div>
          <div>• 所有写接口带 idempotency_key，避免 WS 重连/重试导致重复消息；服务端按 room_id+key 去重</div>
        </div>
      </div>
    </div>

    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>API 与实时事件契约</h3>
    <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, marginBottom: 28, overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "210px 1.2fr 1fr 1fr", gap: "6px 12px", fontSize: 11, minWidth: 850 }}>
        <div style={{ fontWeight: 700 }}>接口/事件</div>
        <div style={{ fontWeight: 700 }}>用途</div>
        <div style={{ fontWeight: 700 }}>前端更新</div>
        <div style={{ fontWeight: 700 }}>约束</div>
        {[
          ["GET /rooms/:id/messages?limit&before", "房间全量消息分页", "prepend/append messages", "返回 items + next_before；不按 topic 过滤；quote 预览由 message.quote 填充"],
          ["POST /rooms/:id/messages", "发送用户消息/引用回复", "optimistic → server message", "body.content、quote_message_id、idempotency_key"],
          ["GET /rooms/:id/workboard", "右侧看板快照", "patch snapshot + compressed topics", "pending/running/compressed_topics/current_graph 派生"],
          ["GET /rooms/:id/flow-events?graph_id&topic_id&limit&before", "消息事件图时间轴分页", "更新流程动态面板", "默认当前图尾部；topic_id 表示展开已压缩阶段"],
          ["POST /rooms/:id/human-actions/:actionId/decide", "接受/拒绝确认或审批", "轻卡终态 + pending -1", "decision=accepted|rejected；拒绝 reason 必填；权限 owner/admin/assignee"],
          ["POST /rooms/:id/invocations/:id/cancel", "取消当前用户引用链或管理员群级停止", "message state=cancelled", "scope=chain|room；默认 chain；admin 可 room"],
          ["room:message_created", "新增消息", "append/replace optimistic", "payload.message 完整可解析"],
          ["room:message_updated", "消息状态/内容变迁", "patch by message.id", "同 id 状态更新，不追加新行"],
          ["room:flow_event_created", "追加流程动态", "append current graph/topic timeline", "包含 category + optional step_id/message_id/topic_id"],
          ["room:control_step_updated", "控制步骤状态变化", "patch ControlStepNode", "同 step_id 状态更新，不追加新节点"],
          ["room:snapshot_updated", "看板计数/阶段摘要", "patch workboard snapshot", "pending/running/compressed_topics 为派生值"],
          ["room:human_action_updated", "人工事项变化", "横幅/轻卡/通知同步", "accepted/rejected/expired 均广播"],
        ].map(([api, use, update, rule]) => (
          <div key={api} style={{ display: "contents" }}>
            <div style={{ fontFamily: "monospace", color: C.primaryLight }}>{api}</div>
            <div style={{ color: C.textMuted }}>{use}</div>
            <div style={{ color: C.textMuted }}>{update}</div>
            <div style={{ color: C.textDim }}>{rule}</div>
          </div>
        ))}
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Worker / Sweeper 职责</h3>
        <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
          <div>• dispatch worker：只把 queued → running，不直接生成聊天系统消息；running 只更新预创建 Agent message</div>
          <div>• control-step worker：route/relay/retry/confirm 的过程与结果写同一 step_id，UI 只显示一个原子节点</div>
          <div>• completion worker：先落 message.content + invocation.status，再落 message 类 flow_event，最后广播 WS</div>
          <div>• invocation sweeper：超时 → timed_out + flow_event，必要时 manager_escalate_human</div>
          <div>• human-action sweeper：expires_at 到期 → expired + notification_sent</div>
          <div>• topic compressor：仅在人工确认通过或授权结案后压缩已闭合子图；不阻塞新事件写入</div>
          <div>• snapshot builder：从 invocations/human_actions/control_steps/flow_events 派生，不由前端轮询猜测</div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>后端防错规则</h3>
        <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
          <div>• membership check 贯穿所有 room/message/topic/action 查询</div>
          <div>• quote_message_id 必须属于同 room；强关联用于计算消息事件图根，不强制预分配 Topic</div>
          <div>• Agent 互@深度用 root_message_id + quote 链计算，超过上限写 paused</div>
          <div>• Manager route 输出必须结构化校验，失败走 RouteFailurePicker，不写散文系统消息</div>
          <div>• API 响应提供 zod 可解析的稳定 shape，新增 enum 默认降级为 unknown；前端不得裸 cast response</div>
          <div>• <strong style={{ color: C.red }}>禁止 Delivery 概念</strong>：阶段压缩仅使用 Topic；room_delivery 不得进入 UI 或公有 API</div>
        </div>
      </div>
    </div>

    <Divider label="前端模块划分（web/desktop 共用）" />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>
      {[
        ["packages/core/room", "API client、zod schema、query/mutation hooks、query keys；无 UI、无 DOM", "所有 room query key 必须包含 wsId + roomId，防止 workspace 切换缓存串味"],
        ["packages/core/types/room", "唯一 TS 契约源：RoomMessage、ControlStep、RoomTopic、FlowEvent、HumanAction、RoomSnapshot", "字段使用后端 snake_case；组件内再映射为展示文案"],
        ["packages/views/room", "RoomView、MessageList、Composer、Workboard、成员/设置面板", "禁止 next/*、react-router-dom；业务逻辑走 core/room"],
        ["apps/web/app/.../rooms", "仅 Next route shell，传 roomId/workspaceSlug 到 shared view", "不放业务逻辑"],
        ["apps/desktop/routes", "仅桌面路由接入；使用 shared RoomView", "桌面预工作区规则不影响 Room session route"],
        ["realtime/use-realtime-sync", "订阅 room:* WS 事件并 invalidate/patch query", "优先 patch by id；失败再 invalidate"],
      ].map(([mod, role, rule]) => (
        <div key={mod} style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.75 }}>
          <div style={{ fontFamily: "monospace", color: C.primaryLight, marginBottom: 6 }}>{mod}</div>
          <div style={{ color: C.text }}>{role}</div>
          <div style={{ color: C.textDim, marginTop: 6 }}>约束：{rule}</div>
        </div>
      ))}
    </div>

    <Divider label="统一响应字段（API 契约）" />
    <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, marginBottom: 28, overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1.6fr 1fr", gap: "6px 12px", fontSize: 11, minWidth: 820 }}>
        <div style={{ fontWeight: 700 }}>对象</div>
        <div style={{ fontWeight: 700 }}>字段</div>
        <div style={{ fontWeight: 700 }}>说明</div>
        {[
          ["RoomMessage", "id, room_id, sender_type, sender_id, content, quote_message_id, quote?, state, attribution?, human_action?, created_at, edited_at?", "state 是 API 展示态，后端可由 invocation 派生"],
          ["ControlStep", "id, room_id, step_type, state, from_message_id?, to_message_id?, actor_type, actor_id?, payload, started_at?, completed_at?", "route/relay/retry/confirm 的过程与结果以 step_id 合并展示"],
          ["MentionInvocation", "id, room_id, message_id, target_type, target_id, intent, status, task_id?, retry_count, max_retries, failure_reason?, started_at?, completed_at?", "cancel/retry/resume 均以 invocation_id 为主键"],
          ["RoomTopic", "id, room_id, title, summary, status, event_range_start_id, event_range_end_id, compressed_at?, expanded?", "Topic 是阶段压缩视图；不要求 delivery_id；不阻塞事件写入"],
          ["RoomFlowEvent", "id, room_id, category, type, step_id?, message_id?, from_message_id?, to_message_id?, topic_id?, actor_type, actor_id?, payload, created_at", "append-only；payload 只放模板变量，不放整段散文"],
          ["RoomHumanAction", "id, room_id, step_id?, message_id, invocation_id?, type, status, assignee_id?, title, reason?, expires_at?, decided_at?", "confirm/approval/conflict 统一入口"],
          ["RoomSnapshot", "pending_count, queued_count, running_count, failed_count, timed_out_count, active_graph_id, compressed_topics[], latest_event_id", "由服务端派生；前端不轮询拼装"],
        ].map(([name, fields, note]) => (
          <div key={name} style={{ display: "contents" }}>
            <div style={{ fontFamily: "monospace", color: C.primaryLight }}>{name}</div>
            <div style={{ color: C.textMuted }}>{fields}</div>
            <div style={{ color: C.textDim }}>{note}</div>
          </div>
        ))}
      </div>
    </div>

    <Divider label="域边界：Room 自闭环" />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
      <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
        <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>协作群自有闭环</div>
        <div>• <strong>RoomMessage</strong>：对话事实与 Agent 产出正文</div>
        <div>• <strong>Invocation + Task</strong>：执行原子；与 RoomMessage 一对一或一对多绑定</div>
        <div>• <strong>ControlStep</strong>：流程控制原子；route running/result 合并展示</div>
        <div>• <strong>FlowEvent</strong>：append-only 审计；按 category 投影到消息/控制/确认/阶段</div>
        <div>• <strong>Topic</strong>：已闭合子图的阶段压缩视图；可展开还原事件</div>
        <div>• <strong>HumanAction</strong>：确认/审批闸门；接受 → topic_compressed</div>
        <div>• <strong>Snapshot</strong>：待处理/运行中/阶段摘要派生</div>
      </div>
      <div style={{ background: C.primaryBg, borderRadius: 10, padding: 16, border: `1px solid ${C.primary}30`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
        <div style={{ fontWeight: 600, color: C.primaryLight, marginBottom: 8 }}>图投影防错规则</div>
        <div>• event 永远 append-only；看板折叠不删除、不改写原始事件</div>
        <div>• ControlStep 必须有 step_id；running / succeeded / failed 共享同一节点</div>
        <div>• message 类事件只能更新消息节点状态，不得单独占流程行</div>
        <div>• phase 类事件只能压缩已闭合范围，不能阻塞后续消息写入</div>
        <div>• 无法定位 from/to_message_id 的元事件进入 meta 区，不污染主图</div>
      </div>
    </div>
  </div>
);

// ─── Main App ───
const TABS = [
  { id: "principles", label: "📜 设计宪法" },
  { id: "overview", label: "📐 布局总览" },
  { id: "thread", label: "🧵 消息与视图" },
  { id: "create", label: "✨ 创建群" },
  { id: "chat", label: "💬 聊天交互" },
  { id: "invocation", label: "⚡ Agent 调用" },
  { id: "flow_timeline", label: "📋 流程动态" },
  { id: "manager", label: "🧠 路由与监督" },
  { id: "approval", label: "⚠️ 审批与确认" },
  { id: "settings", label: "⚙️ 设置" },
  { id: "backend", label: "🧩 后台方案" },
  { id: "benchmark", label: "🏆 对标优化" },
  { id: "exceptions", label: "🚨 异常场景" },
  { id: "acceptance", label: "✅ 验收清单" },
];

export default function RoomDesignSpec() {
  const [tab, setTab] = useState("principles");
  const [showMention, setShowMention] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chatViewMode, setChatViewMode] = useState<ChatViewMode>("thread");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 24px 0", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>💬</span>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>协作群 UI/UX 设计规范 <Badge color={C.primaryLight} bg={C.primaryBg}>唯一蓝本</Badge></h1>
            <p style={{ fontSize: 12, color: C.textMuted, margin: "4px 0 0" }}>Room 域自闭环 · Invocation+Task · Topic 交付跟踪 · API/WS 同名契约</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, overflowX: "auto", paddingBottom: 0 }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: "none", borderRadius: "8px 8px 0 0", transition: "all 0.15s",
              background: tab === t.id ? C.bg : "transparent",
              color: tab === t.id ? C.text : C.textMuted,
              borderBottom: tab === t.id ? `2px solid ${C.primary}` : "2px solid transparent",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 24 }}>
        {/* Tab: Design Constitution */}
        {tab === "principles" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>设计宪法</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 720 }}>
              以下规则优先级高于任何单页线框。实现与后续迭代不得违反；若有冲突，以本页为准。
              协作群以<strong style={{ color: C.text }}>消息事件图</strong>为事实源：消息是节点，流程控制是原子步骤，Topic 是阶段完成后的压缩视图；前后端使用同名字段契约。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {[
                { title: "1. 聊天优先", body: "协作群是消息对话，不是编排控制台。内容语义附着在 RoomMessage 上；流程语义进入看板的消息事件图。" },
                { title: "2. 一条消息一 ID", body: "思考中→完成是同一 message_id 的状态变迁。Agent 互@ = 新消息 + quote_message_id，禁止消息子树嵌套。" },
                { title: "3. 双视图可切换", body: "ThreadBlock（多用户根块并列）与时间线（全量平铺）可切换；默认 ThreadBlock；偏好 per-room 存 localStorage。" },
                { title: "4. 聊天区 vs 看板", body: "聊天区=房间全量消息，不按 Topic 过滤。看板=消息事件图投影，可折叠已压缩阶段并展开当前流程。" },
                { title: "5. 三种协作模式", body: "路由（无@）· 直连（单@）· 并行（多@）。三种模式均有完整消息事件图；并行模式 Manager 不 route、不 review。" },
                { title: "6. 流程动态", body: "FlowEvent 是 append-only 审计源；message 类折叠进消息节点，control/confirm 类按 step_id 合并为原子节点，phase 类压缩为 Topic。" },
                { title: "7. 人工确认", body: "消息行内轻卡 + Composer 横幅。接受→human_confirm_accepted→topic_compressed；拒绝须填原因并写 confirm 类 flow_event。" },
                { title: "8. 元素预算", body: "禁止任务横幅/居中编排消息。允许：attribution pill、异常横幅、消息内轻卡、看板 ControlStep。agent_at 仅作控制步骤。" },
                { title: "9. 停止生成", body: "仅当「当前用户最近发起引用链」内有 running 时显示 Composer 居中按钮；他人并行任务不误伤。" },
                { title: "10. 阶段压缩", body: "Topic 不是事前分类器，也不是事件写入前提；它只在阶段完成后压缩一段已闭合子图，且必须可展开还原。" },
                { title: "11. 契约优先", body: "API Response 使用 snake_case，同名进入 packages/core/types/room；前端组件只做展示映射，不发明本地状态字段。" },
              ].map((r) => (
                <div key={r.title} style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 600, color: C.primaryLight, marginBottom: 6 }}>{r.title}</div>
                  <div style={{ color: C.textMuted }}>{r.body}</div>
                </div>
              ))}
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>三种协作模式对照</h3>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, overflowX: "auto", marginBottom: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 1fr", gap: "8px 12px", fontSize: 11, minWidth: 700 }}>
                <div style={{ fontWeight: 700 }}>维度</div>
                <div style={{ fontWeight: 700, color: C.primary }}>路由模式</div>
                <div style={{ fontWeight: 700, color: C.green }}>直连模式</div>
                <div style={{ fontWeight: 700, color: C.blue }}>并行指派</div>
                {[
                  ["触发", "用户消息无 @", "用户 @单个 Agent", "用户 @多个 Agent"],
                  ["Manager 路由", "✅ route", "❌", "❌"],
                  ["Manager review", "✅ 评估接力", "⚠️ 仅异常升级", "❌ 不 review"],
                  ["看板消息事件图", "✅ 完整（含 RouteStep）", "✅ 完整（无 RouteStep）", "✅ 完整（多 Agent 并列）"],
                  ["attribution", "由群管理分配指定", "用户 @指定", "用户 @指定"],
                  ["消息布局", "引用链串联", "quote 父消息", "多消息并列 quote 同一用户消息"],
                  ["人工确认", "阶段压缩前确认", "同左", "同左"],
                ].map(([dim, a, b, c]) => (
                  <div key={dim as string} style={{ display: "contents" }}>
                    <div style={{ color: C.textDim, fontWeight: 500 }}>{dim as string}</div>
                    <div style={{ color: C.textMuted }}>{a as string}</div>
                    <div style={{ color: C.textMuted }}>{b as string}</div>
                    <div style={{ color: C.textMuted }}>{c as string}</div>
                  </div>
                ))}
              </div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>禁止的 UI / 交互模式</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11 }}>
              {["消息子树嵌套", "聊天区任务横幅", "模式提示行 / route_hint", "居中编排系统消息", "agent_at 聊天消息类型", "思考中/完成拆成两条消息", "控制步骤拆成多行", "路由决策中与结果分裂展示", "Delivery 作为产品概念", "成员栏长文案状态", "聊天区按 Topic 过滤", "聊天区 relay_hint / agent_at 卡片"].map((x) => (
                <span key={x} style={{ padding: "4px 10px", borderRadius: 6, background: C.redBg, color: C.red, border: `1px solid ${C.red}30` }}>❌ {x}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Messages & Views */}
        {tab === "thread" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>消息模型与双视图</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 720 }}>
              底层是 <strong style={{ color: C.text }}>RoomMessage</strong>（message_id + quote_message_id + 状态）。
              UI 可在 <strong style={{ color: C.text }}>ThreadBlock</strong>（引用链聚合）与<strong style={{ color: C.text }}>时间线</strong>（企微式平铺）间切换。
              Agent 互@ = 新消息引用父消息，<strong style={{ color: C.red }}>禁止</strong> 消息子树嵌套。
            </p>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted, marginBottom: 24, maxWidth: 720 }}>
              <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>MessageNode · ControlStep · Topic 三者关系</div>
              <div>• <strong style={{ color: C.primaryLight }}>MessageNode</strong>：RoomMessage 内容节点；Agent 思考中/失败/重试/完成折叠为同一消息节点的状态与详情</div>
              <div>• <strong style={{ color: C.blue }}>ControlStep</strong>：route/relay/retry/confirm 等流程原子；同 step_id 的过程与结果只显示一个节点</div>
              <div>• <strong style={{ color: C.green }}>Topic</strong>：阶段完成后的<strong>子图压缩视图</strong>；展开后还原消息节点、控制节点与原始 flow_events</div>
            </div>
            <div style={{ background: C.primaryBg, borderRadius: 10, padding: 14, border: `1px solid ${C.primary}30`, fontSize: 12, lineHeight: 1.8, color: C.textMuted, marginBottom: 24, maxWidth: 720 }}>
              <div style={{ fontWeight: 600, color: C.primaryLight, marginBottom: 6 }}>聊天区 vs 看板（硬规则）</div>
              <div>• 聊天区始终加载<strong style={{ color: C.text }}>房间全量</strong> RoomMessage，按时间序或引用链展示</div>
              <div>• 看板只投影<strong style={{ color: C.text }}>消息事件图</strong>、阶段摘要与待处理计数，不做聊天区过滤</div>
              <div>• ThreadBlock 多任务：多个用户根消息 → 多个块自上而下并列；时间线则全量平铺</div>
              <div>• 视图偏好：<code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3 }}>room:{`{roomId}`}:chatView</code> 存 localStorage，默认 thread</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>RoomMessage 字段</h3>
                <div style={{ background: C.bg, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontFamily: "monospace", fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
                  <div>id, sender, sender_type</div>
                  <div>quote_message_id?  // 强关联父消息</div>
                  <div>state: thinking | streaming | succeeded | failed | queued</div>
                  <div>attribution?  // 「由群管理分配指定」</div>
                  <div>started_at, completed_at, duration</div>
                  <div style={{ color: C.red, marginTop: 6 }}>// 聊天消息只表达内容事实；流程控制进入 ControlStep</div>
                </div>
                <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8, color: C.textMuted }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>关联方式</div>
                  <div>• <strong>强关联</strong>：引用/回应 → quote_message_id → ThreadBlock 可聚合，也用于计算消息事件图边界</div>
                  <div>• <strong>弱关联</strong>：Manager 可追加 control/meta 事件关联另一条消息，但不改写原消息归属</div>
                  <div>• Topic 只压缩一段已闭合子图；同一消息可被多个压缩视图引用，但 message_id 唯一</div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>同一消息的状态变迁</h3>
                <div style={{ background: C.bg, borderRadius: 12, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12 }}>
                  <RoomMessageRow msg={SNAKE_MSG2_THINKING} />
                  <div style={{ textAlign: "center", fontSize: 10, color: C.textDim, margin: "4px 0" }}>↓ 同一 #2 消息完成</div>
                  <RoomMessageRow msg={SNAKE_MESSAGES[1]} />
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.7 }}>
                  思考中与完成是<strong>同一条消息</strong>的 UI 态变化，流程动态仅在状态变迁时追加事件，不刷心跳。
                </div>
              </div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>ThreadBlock 视图（引用链聚合）</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, marginBottom: 24, maxWidth: 560 }}>
              <ThreadBlockView rootId="1" messages={SNAKE_MESSAGES} />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>时间线视图（企微风格）</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, marginBottom: 24, maxWidth: 560 }}>
              <TimelineView messages={SNAKE_MESSAGES} />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Agent 互@ = 新消息 + 引用（非嵌套子树）</h3>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8, color: C.textMuted, marginBottom: 16 }}>
              <div>需求分析师 #2 完成并 @前端工程师 → 创建 <strong>新消息 #3</strong>，quote_message_id=#2，attribution=「由 @需求分析师 指定」</div>
              <div>前端工程师 #3 完成并 @需求分析师 → 创建 <strong>新消息 #4</strong>，quote_message_id=#3</div>
              <div>深度上限 5 层引用链；超限 → 消息 paused + 管理员恢复</div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>并行指派</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, maxWidth: 560, marginBottom: 24 }}>
              <TimelineView messages={PARALLEL_MESSAGES} />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>多 ThreadBlock 并列（同房多任务）</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, maxWidth: 560, marginBottom: 24 }}>
              <ChatMessageList messages={MULTI_ROOM_MESSAGES} viewMode="thread" />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>弱关联示例（跨消息控制边）</h3>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted, maxWidth: 560 }}>
              <div>用户 #1「开发贪吃蛇」与用户 #5「评估登录方案」在聊天区仍是两条独立消息</div>
              <div>若 Manager 判断两者相关，可追加 <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3 }}>manager_link_succeeded</code> ControlStep，from_message_id=#1，to_message_id=#5</div>
              <div>压缩阶段时 TopicCard 可引用这条边；展开后还原原始消息与控制边</div>
            </div>
          </div>
        )}

        {/* Tab: Overview */}
        {tab === "overview" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>三栏布局结构</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              协作群采用经典三栏布局：左侧群列表、中间消息聊天区（双视图）、右侧成员+消息事件图看板。
              中间区域自适应；窄屏时右侧收为抽屉。整体高度 100vh，无页面级滚动。
            </p>
            <div style={{ display: "flex", height: 520, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <RoomListScreen onSelect={() => {}} />
              <ChatAreaScreen
                viewMode={chatViewMode}
                onToggleView={() => setChatViewMode((m) => (m === "thread" ? "timeline" : "thread"))}
                onNavigate={(s) => { if (s === "settings") setShowSettings(!showSettings); }}
              />
              <MembersPanelScreen />
              {showSettings && <SettingsSheetScreen />}
            </div>
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                { title: "左侧导航栏", w: "w-72 (288px)", items: ["群列表（按活跃度排序）", "活跃度标签（N 个进行中）", "新建群按钮", "空态引导"] },
                { title: "中间聊天区", w: "flex-1", items: ["Header（动态指示器 + 视图切换）", "待处理横幅 + 消息列表（双视图）", "停止生成 + Composer + 回到底部 FAB"] },
                { title: "右侧面板", w: "w-56 (224px)", items: ["成员列表 + 实时状态点", "工作看板：阶段摘要 + 当前流程", "已压缩 Topic 默认折叠；当前子图展示最新 20 条事件", "成员管理（添加/移除/角色）", "窄屏：抽屉唤起"] },
              ].map((col) => (
                <div key={col.title} style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{col.title}</div>
                  <div style={{ fontSize: 10, color: C.primaryLight, marginBottom: 8 }}>{col.w}</div>
                  {col.items.map((item) => (
                    <div key={item} style={{ fontSize: 12, color: C.textMuted, padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: C.textDim }}>•</span> {item}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <Divider label="端到端使用流程" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { title: "路由模式主路径", steps: ["用户发送无 @ 消息", "RouteStep 从 running → succeeded", "成功后创建 Agent 消息并写 attribution", "Agent 同 message_id 从 thinking → succeeded", "流程动态追加执行/接力事件", "人工确认接受 → topic_compressed"] },
                { title: "直连/并行路径", steps: ["用户 @单个或多个 Agent", "前端创建 N 条 quote 用户消息的 Agent 消息", "Manager 不 route；并行模式不 review", "各 Agent 独立运行/完成", "异常才升级为待处理"] },
                { title: "人工介入路径", steps: ["后台创建 human_action", "消息轻卡 + Composer 横幅 + 待处理计数", "接受直接完成；拒绝必填原因", "结果进入 flow_event、通知与待办同步"] },
                { title: "阶段压缩闭环", steps: ["用户意图 → 写入消息事件图", "ControlStep 记录路由/接力/确认", "Invocation+Task 执行，产出写入 RoomMessage", "Manager 判定阶段可结案 → human_confirm", "用户接受 → 压缩已闭合子图为 Topic；拒绝 → relay/retry 继续"] },
                { title: "恢复路径", steps: ["发送失败保留乐观消息可重试/删除", "路由失败显示 Picker", "超时/深度暂停写入 message state", "管理员恢复或接力给更高级 Agent"] },
              ].map((flow) => (
                <div key={flow.title} style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.85 }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>{flow.title}</div>
                  {flow.steps.map((s, i) => (
                    <div key={s} style={{ color: C.textMuted }}>
                      <span style={{ color: C.primaryLight, fontWeight: 600 }}>{i + 1}.</span> {s}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Create Room */}
        {tab === "create" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>创建协作群</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 1.6, maxWidth: 700 }}>
              通过 Dialog 创建新群。配置群名称、群管理 Agent（路由+监督，非编排器）、Agent 成员和工作区成员。
              群管理 Agent 在后台工作，不出现在成员列表与 @ 列表中。创建者自动成为群主。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>创建表单字段</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  {[
                    { field: "群名称", type: "Input", required: true, desc: "必填，最长 80 字符" },
                    { field: "启用群管理", type: "Checkbox", required: false, desc: "默认开启（推荐）" },
                    { field: "群管理配置", type: "Tabs", required: false, desc: "新建/已有 Agent 切换" },
                    { field: "Runtime", type: "Picker", required: true, desc: "群管理运行时（新建时）" },
                    { field: "模型", type: "Select", required: false, desc: "群管理模型选择" },
                    { field: "管理 Prompt", type: "Textarea", required: false, desc: "自定义路由/监督指令（非编排计划）" },
                    { field: "Agent 成员", type: "CheckboxList", required: false, desc: "可被 @ 的 Agent" },
                    { field: "工作区成员", type: "CheckboxList", required: false, desc: "当前用户默认选中且不可取消" },
                  ].map((f) => (
                    <div key={f.field} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.text, minWidth: 100 }}>{f.field}</span>
                      <Badge>{f.type}</Badge>
                      {f.required && <Badge color={C.red} bg={C.redBg}>必填</Badge>}
                      <span style={{ fontSize: 11, color: C.textMuted, marginLeft: "auto" }}>{f.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>预览</h3>
                <div style={{ position: "relative", height: 480, background: "rgba(0,0,0,0.3)", borderRadius: 10, overflow: "hidden" }}>
                  <CreateRoomDialogScreen />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Chat Interaction */}
        {tab === "chat" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>聊天交互设计</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 1.6, maxWidth: 700 }}>
              聊天区支持 <strong style={{ color: C.text }}>ThreadBlock</strong> 与 <strong style={{ color: C.text }}>时间线</strong> 双视图切换。
              底层均为 RoomMessage + quote_message_id。Agent 产出仅以消息正文呈现；流程状态进入看板的消息事件图。详见「🧵 消息与视图」Tab。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>消息类型与渲染规则</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12 }}>
                  {[
                    { type: "用户消息", rule: "右对齐气泡；Hover：引用/编辑/复制", icon: "👤" },
                    { type: "Agent 消息", rule: "同一 message_id：思考中→完成；attribution pill 附带路由/@信息", icon: "🤖" },
                    { type: "引用预览", rule: "时间线视图每条显式 quote；ThreadBlock 按链缩进", icon: "💬" },
                    { type: "Agent 互@", rule: "新消息 + quote 父消息；非子树嵌套", icon: "🤝" },
                    { type: "流程动态", rule: "仅看板；三种模式均有完整群管事件流", icon: "📋" },
                    { type: "人工确认轻卡", rule: "消息行内 + Composer 横幅；拒绝必填原因", icon: "✋" },
                    { type: "审批", rule: "消息 footer；非居中系统卡", icon: "⚠️" },
                    { type: "异常横幅", rule: "路由失败 Picker / 深度暂停（非居中长文）", icon: "🚨" },
                    { type: "视图切换", rule: "Header：ThreadBlock ↔ 时间线", icon: "🔀" },
                  ].map((m) => (
                    <div key={m.type} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.border}`, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 14 }}>{m.icon}</span>
                      <div>
                        <div style={{ fontWeight: 500, color: C.text }}>{m.type}</div>
                        <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>{m.rule}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>输入框交互</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>快捷键</div>
                  <div style={{ color: C.textMuted }}>• Enter → 发送消息</div>
                  <div style={{ color: C.textMuted }}>• Shift+Enter → 换行</div>
                  <div style={{ color: C.textMuted }}>• @ → 触发成员选择弹窗</div>
                  <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>@mention 规则</div>
                  <div style={{ color: C.textMuted }}>• 仅显示 Room 成员（非全员）</div>
                  <div style={{ color: C.textMuted }}>• Manager Agent 不出现在 @ 列表中</div>
                  <div style={{ color: C.textMuted }}>• 支持 Agent / Squad / User 三类</div>
                  <div style={{ color: C.textMuted }}>• 选中后插入 @Name 并继续输入</div>
                  <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>引用回复</div>
                  <div style={{ color: C.textMuted }}>• 点击消息操作栏的"引用回复"</div>
                  <div style={{ color: C.textMuted }}>• 输入框上方显示引用预览卡片</div>
                  <div style={{ color: C.textMuted }}>• 自动在内容前插入 @mention prefix</div>
                  <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>编辑消息</div>
                  <div style={{ color: C.textMuted }}>• 仅可编辑自己的消息</div>
                  <div style={{ color: C.textMuted }}>• 乐观消息（发送中）不可编辑</div>
                  <div style={{ color: C.textMuted }}>• 保存后重新触发 @mention</div>
                </div>
                <div style={{ position: "relative", marginTop: 16 }}>
                  <div style={{ position: "relative", height: 200, background: "rgba(0,0,0,0.3)", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
                      <MentionSuggestionScreen />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, textAlign: "center" }}>@mention 弹出菜单（仅显示 Room 成员）</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Invocation */}
        {tab === "invocation" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Agent Invocation（调用）状态机</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              每个 @mention 创建一个 MentionInvocation。它经历从 pending → queued → running → succeeded/failed 的完整生命周期。
              每个 invocation 对应一条 RoomMessage（同 id 状态变迁）。UI 通过消息行组件渲染，停止操作在 Composer 上方全局按钮。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
              {[
                { status: "pending", color: C.textDim, label: "等待处理", desc: "Manager 已接收，尚未 dispatch", actions: "取消" },
                { status: "queued", color: C.textDim, label: "排队中", desc: "已 dispatch 但 Agent 忙碌", actions: "取消排队 + 等待计时" },
                { status: "running", color: C.amber, label: "运行中", desc: "Agent 正在执行任务", actions: "Composer 停止按钮 + 流式输出" },
                { status: "succeeded", color: C.green, label: "完成", desc: "成功生成回复", actions: "回复 / 复制 / 重新生成" },
                { status: "failed", color: C.red, label: "失败", desc: "Agent 未能完成回答", actions: "重试" },
                { status: "cancelled", color: C.textDim, label: "已取消", desc: "用户主动取消", actions: "重试" },
                { status: "timed_out", color: C.red, label: "超时", desc: "等待时间过长", actions: "重试" },
                { status: "paused", color: C.amber, label: "已暂停", desc: "链式调用深度达上限", actions: "恢复（需管理员）" },
              ].map((s) => (
                <div key={s.status} style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Badge color={s.color} bg={`${s.color}20`}>{s.status}</Badge>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{s.desc}</div>
                  <div style={{ fontSize: 11, color: C.primaryLight }}>操作：{s.actions}</div>
                </div>
              ))}
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>消息行渲染示例（Hover 操作，无行内停止）</h3>
            <div style={{ background: C.surface, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, maxWidth: 600 }}>
              <RoomMessageRow msg={{ id: "2", sender: "需求分析师", senderType: "agent", quoteMessageId: "1", quotePreview: "开发贪吃蛇…", time: "14:03", state: "succeeded", attribution: "由群管理分配指定", content: "需求分析完成。" }} />
              <RoomMessageRow msg={{ id: "3", sender: "前端工程师", senderType: "agent", quoteMessageId: "2", quotePreview: "需求分析完成…", time: "14:08", state: "thinking", attribution: "由群管理分配指定", content: "" }} />
              <RoomMessageRow msg={{ id: "4", sender: "后端工程师", senderType: "agent", quoteMessageId: "1", quotePreview: "开发贪吃蛇…", time: "14:09", state: "queued", attribution: "用户 @指定", content: "" }} />
              <RoomMessageRow msg={{ id: "5", sender: "SQA 团队长", senderType: "agent", quoteMessageId: "1", quotePreview: "开发贪吃蛇…", time: "14:09", state: "failed", attribution: "由群管理分配指定", content: "Agent 未能完成回答。" }} />
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>queued：取消排队；失败态 Hover：重试 · 复制；running 停止见 Composer 按钮</div>
            </div>
          </div>
        )}

        {/* Tab: Flow Timeline */}
        {tab === "flow_timeline" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>流程动态 — Manager 处理节点时间轴</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 720 }}>
              流程动态是<strong style={{ color: C.text }}>消息事件图的看板投影</strong>：消息类事件折叠进消息节点，控制/确认类事件按 step_id 合并为原子节点，
              阶段完成后压缩为 TopicCard。文案由<strong style={{ color: C.text }}>事件类型 + 模板</strong>生成，Manager 只做决策、不写摘要散文。
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>设计原则</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
                  <div>• <strong style={{ color: C.text }}>审计全量保留</strong>：每个离散状态变迁追加 FlowEvent，不刷流式心跳</div>
                  <div>• <strong style={{ color: C.text }}>展示按类投影</strong>：message 类进消息节点；control/confirm 类按 step_id 合并；phase 类压缩为 Topic</div>
                  <div>• <strong style={{ color: C.text }}>默认末尾 20 条</strong>：当前子图只拉最新一页，已压缩阶段默认折叠</div>
                  <div>• <strong style={{ color: C.text }}>向上滚动加载</strong>：scrollTop≈0 时 prepend 更早事件（cursor 分页）</div>
                  <div>• <strong style={{ color: C.text }}>新事件</strong>：用户在底部附近时自动滚到底；上翻阅读时不打断</div>
                  <div>• 与聊天区互补：聊天区只放内容消息；看板展示控制节点与阶段摘要；点击节点 ↔ 高亮 message_id</div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>看板线框</h3>
                <WorkboardFlowScreen />
              </div>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>事件分类与投影规则</h3>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, marginBottom: 28, overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "90px 150px 1fr 1.2fr 110px", gap: "6px 12px", fontSize: 11, minWidth: 840 }}>
                <div style={{ fontWeight: 700 }}>category</div>
                <div style={{ fontWeight: 700 }}>type</div>
                <div style={{ fontWeight: 700 }}>触发时机</div>
                <div style={{ fontWeight: 700 }}>看板投影</div>
                <div style={{ fontWeight: 700 }}>约束</div>
                {FLOW_EVENT_TYPE_SPEC.map((row) => (
                  <div key={row.type} style={{ display: "contents" }}>
                    <div style={{ fontFamily: "monospace", color: C.textDim }}>{row.category}</div>
                    <div style={{ fontFamily: "monospace", color: C.primaryLight }}>{row.type}</div>
                    <div style={{ color: C.textMuted }}>{row.trigger}</div>
                    <div style={{ color: C.text }}>{row.projection}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>{row.note || "—"}</div>
                  </div>
                ))}
              </div>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>示例：贪吃蛇完整链路（含失败重试 + 人工结案）</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, maxWidth: 420 }}>
              {SNAKE_FLOW_EVENTS.map((ev, i) => (
                <FlowEventRow key={ev.id} event={ev} isLatest={i === SNAKE_FLOW_EVENTS.length - 1} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, marginBottom: 24, maxWidth: 420, lineHeight: 1.7 }}>
              结案闭环：manager_complete_succeeded → human_confirm_requested → 用户接受 → human_confirm_accepted → topic_compressed；待处理 -1，横幅消失，阶段折叠为 TopicCard
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>示例：并行指派流程动态（无 Manager review）</h3>
            <div style={{ background: C.bg, borderRadius: 12, padding: 20, border: `1px solid ${C.border}`, maxWidth: 420, marginBottom: 24 }}>
              {PARALLEL_FLOW_EVENTS.map((ev, i) => (
                <FlowEventRow key={ev.id} event={ev} isLatest={i === PARALLEL_FLOW_EVENTS.length - 1} />
              ))}
            </div>

            <Divider label="分页与滚动" />
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
              <div style={{ fontFamily: "monospace", fontSize: 11, background: C.bg, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                GET /api/rooms/:id/flow-events?graph_id=current&limit=20{"\n"}
                GET …/flow-events?topic_id={"{topic_id}"}&limit=20&before={"{event_id}"}  // 展开压缩阶段
              </div>
              <div>• 首次进入：取当前子图最新 20 条 → scrollIntoView(最后一条)</div>
              <div>• scrollTop ≤ 阈值：请求 before=最早可见 id → prepend → 保持滚动位置</div>
              <div>• WS room:flow_event / snapshot_updated：若在底部则 append + 自动滚底</div>
              <div>• running 状态：同一 invocation 折叠进消息节点；queued→running 不重复占行</div>
              <div>• 非当前阶段：折叠为 TopicCard，点击展开原始事件子图（不跳转聊天区）</div>
              <div>• 点击消息节点/控制节点 → 滚动并高亮对应 message_id（双向定位）</div>
            </div>

            <Divider label="Topic 压缩规则" />
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted, marginBottom: 24 }}>
              <div>• <strong style={{ color: C.text }}>事实优先</strong>：消息节点、ControlStep、FlowEvent 先完整写入；没有 Topic 也必须能记录流程</div>
              <div>• <strong style={{ color: C.text }}>压缩触发</strong>：仅人工确认接受、授权高级 Agent 结案、或用户手动归档阶段；禁止仅因事件过多自动压缩</div>
              <div>• <strong style={{ color: C.text }}>压缩范围</strong>：覆盖一段已闭合子图的 event_range_start/end；默认不跨无关根消息</div>
              <div>• <strong style={{ color: C.text }}>可展开</strong>：TopicCard 展开后按原始时间顺序恢复消息节点、ControlStep 与确认节点</div>
              <div>• <strong style={{ color: C.text }}>不改聊天区</strong>：Topic 只影响看板展示密度，不隐藏、不移动、不过滤聊天消息</div>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>核心流程图</h3>
            <div style={{ background: C.surface, borderRadius: 10, padding: 20, border: `1px solid ${C.border}`, marginBottom: 24 }}>
              <FlowDiagram />
            </div>

            <Divider label="WebSocket 事件（契约）" />
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 12 }}>
                {[
                  { event: "room:message", action: "invalidate messages；同 id 状态更新" },
                  { event: "room:flow_event", action: "append 流程动态；按 category 投影" },
                  { event: "room:control_step_updated", action: "同 step_id patch ControlStepNode" },
                  { event: "room:invocation_updated", action: "更新 message state" },
                  { event: "room:approval_requested", action: "消息轻卡 + 待处理 +1" },
                  { event: "room:human_action_updated", action: "human_confirm_* 事件 + 待处理计数" },
                  { event: "room:snapshot_updated", action: "看板 pending/running/compressed_topics" },
                ].map((e) => (
                  <div key={e.event} style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }}>
                    <div style={{ fontWeight: 600, color: C.text, fontSize: 11, fontFamily: "monospace" }}>{e.event}</div>
                    <div style={{ color: C.textMuted, marginTop: 4, fontSize: 11 }}>{e.action}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Manager Router & Supervisor */}
        {tab === "manager" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>🧠 群管理 — 路由与监督模式</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              群管理 Agent 承担轻量「路由 + 监督」角色：该出手时才出手。
              用户可直接 @具体 Agent；Manager 仅在需要路由、接力、升级时介入。
            </p>

            {/* Three Roles */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Manager 的三种职责</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                {[
                  { icon: "📨", title: "路由", desc: "把消息送到对的人手上", detail: "分析用户消息意图，判断最合适的 Agent 角色。决策中与决策结果属于同一个 RouteStep，不拆成两行", when: "路由模式（用户消息无 @）", ui: "RouteStep 原子节点 + Agent 消息 attribution；失败挂 RouteFailurePicker", color: C.primary },
                  { icon: "🔄", title: "接力", desc: "完成后决定是否交给下一个", detail: "当前 Agent 完成后，评估结果并结合群提示词判断是否需要触发下一个 Agent。running/result 共享 step_id", when: "路由模式 · 消息 succeeded 后", ui: "RelayStep 原子节点 + 新 Agent 消息 quote 父消息", color: C.blue },
                  { icon: "🚨", title: "升级", desc: "异常时引入更高角色或人工", detail: "Agent 失败、多轮无结论、超时等异常时，评估是否引入更高级 Agent 或通知人类裁决", when: "异常/僵局/超时", ui: "EscalateStep + 异常横幅 + 待处理/通知", color: C.red },
                ].map((r) => (
                  <div key={r.title} style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${r.color}30` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 22 }}>{r.icon}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: r.color }}>{r.title}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>{r.desc}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.7, marginBottom: 8 }}>{r.detail}</div>
                    <div style={{ fontSize: 11, color: C.textDim, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                      <div><strong style={{ color: C.text }}>触发时机：</strong>{r.when}</div>
                      <div style={{ marginTop: 4 }}><strong style={{ color: C.text }}>UI 体现：</strong>{r.ui}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Decision Flow */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>决策流程图</h3>
              <div style={{ background: C.surface, borderRadius: 10, padding: 20, border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 600 }}>
                  {/* Step 1 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.primary, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>用户发送消息</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>检查是否包含明确 @mention</div>
                    </div>
                  </div>
                  {/* Branch */}
                  <div style={{ marginLeft: 16, paddingLeft: 20, borderLeft: `2px solid ${C.border}` }}>
                    <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
                      {/* Branch A: Direct @ */}
                      <div style={{ flex: 1, background: C.greenBg, borderRadius: 8, padding: 12, border: `1px solid ${C.green}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.green, marginBottom: 4 }}>有明确 @ → 直连模式</div>
                        <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
                          Manager 不 route<br />
                          被 @Agent 直接执行<br />
                          <span style={{ color: C.textDim }}>用户看到：Agent 消息 + attribution=用户 @指定</span>
                        </div>
                      </div>
                      {/* Branch B: No @ */}
                      <div style={{ flex: 1, background: C.primaryBg, borderRadius: 8, padding: 12, border: `1px solid ${C.primary}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, marginBottom: 4 }}>无 @ → 路由模式</div>
                        <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
                          RouteStep: running → succeeded<br />
                          成功后创建 Agent 消息<br />
                          <span style={{ color: C.textDim }}>用户看到：一个路由节点 + Agent attribution</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.blue, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Agent 执行完成</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>Manager 评估结果，决定是否接力或进入确认</div>
                    </div>
                  </div>
                  {/* Branch */}
                  <div style={{ marginLeft: 16, paddingLeft: 20, borderLeft: `2px solid ${C.border}` }}>
                    <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
                      <div style={{ flex: 1, background: C.greenBg, borderRadius: 8, padding: 12, border: `1px solid ${C.green}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.green, marginBottom: 4 }}>结果充分 → 结束</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>任务已完成，无需接力</div>
                      </div>
                      <div style={{ flex: 1, background: C.blueBg, borderRadius: 8, padding: 12, border: `1px solid ${C.blue}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.blue, marginBottom: 4 }}>需要下一步 → 接力</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>RelayStep 原子节点（仅看板）</div>
                      </div>
                      <div style={{ flex: 1, background: C.redBg, borderRadius: 8, padding: 12, border: `1px solid ${C.red}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.red, marginBottom: 4 }}>异常 → 升级</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>🚨 引入高级角色 / 通知人类</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* UI Components */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🎨 UI 组件设计</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                {/* Attribution on message */}
                <div style={{ background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>消息 attribution pill</div>
                  <AttributionPill text="由群管理分配指定" />
                  <div style={{ marginTop: 6 }}><AttributionPill text="由 @需求分析师 指定" /></div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 8, lineHeight: 1.6 }}>
                    • 挂在 Agent 消息行，非独立模式提示行<br />
                    • Agent 消息上只表达最终来源；过程见 RouteStep<br />
                    • 路由失败：异常横幅 + RouteFailurePicker
                  </div>
                </div>
                {/* Relay → Workboard only */}
                <div style={{ background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>ControlStep 链路（仅看板）</div>
                  <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
                    需求分析师 ✓ → <span style={{ color: C.amber }}>前端工程师 ●</span> → SQA 团队长 ○
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 8, lineHeight: 1.6 }}>
                    • 聊天区不出现接力 hint / 任务横幅<br />
                    • 用户通过消息序列感知执行；通过看板感知控制步骤与阶段进度
                  </div>
                </div>
                {/* Escalation */}
                <div style={{ background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>升级提示（escalation）</div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: `${C.red}08`, borderRadius: 10, padding: "8px 12px", border: `1px solid ${C.red}20` }}>
                    <span style={{ fontSize: 14 }}>🚨</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: C.red }}>前端工程师 多轮讨论未达成共识</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>已引入 系统架构师 协助裁决</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 8, lineHeight: 1.6 }}>
                    • 引用链根部的异常横幅（非居中系统墙）<br />
                    • 显示升级原因 + 可选「接受/忽略」<br />
                    • 成员面板仅绿点变化；详情见流程动态
                  </div>
                </div>
              </div>
            </div>

            {/* Design Rules */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>设计规则</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: C.green }}>✅ Manager 应该做的</div>
                  <div style={{ color: C.textMuted }}>• 快速分析意图，精准路由到目标 Agent，并以单个 ControlStep 呈现过程与结果</div>
                  <div style={{ color: C.textMuted }}>• Agent 完成后评估结果，决定是否接力</div>
                  <div style={{ color: C.textMuted }}>• 异常时升级并通知用户</div>
                  <div style={{ color: C.textMuted }}>• 观察 Agent 间的 @互动，仅在需要时介入</div>
                  <div style={{ color: C.textMuted }}>• 成员面板只显示运行绿点，完整状态进入流程动态</div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: C.red }}>❌ Manager 不应该做的</div>
                  <div style={{ color: C.textMuted }}>• 不创建编排计划卡 / 居中系统长文</div>
                  <div style={{ color: C.textMuted }}>• 不把路由决策中、决策结果、创建消息拆成多条聊天系统行</div>
                  <div style={{ color: C.textMuted }}>• 不在用户直接 @时抢先介入</div>
                  <div style={{ color: C.textMuted }}>• 路由模式下串行接力（一次一个 Agent）</div>
                  <div style={{ color: C.textMuted }}>• 用户多 @ 时并行，Manager 不 route、不 review</div>
                  <div style={{ color: C.textMuted }}>• 不阻塞聊天流（attribution pill 轻量附带）</div>
                  <div style={{ color: C.textMuted }}>• 不在成员列表外显示独立状态栏</div>
                </div>
              </div>
            </div>

            {/* Edge Cases */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⚠️ 边界场景</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { case: "用户 @多个 Agent", solution: "并行指派：N 条消息并列 quote 用户消息，各独立 invocation", condition: "Manager 不 route；看板仍有完整流程动态" },
                  { case: "用户 @单个 Agent", solution: "直连模式：attribution=用户 @指定，默认无 review", condition: "仅失败/超时可建议升级" },
                  { case: "无 Manager Agent", solution: "有 @ 则直连；无 @ 则提示配置群管理", condition: "room.manager_agent_id 为空" },
                  { case: "Manager 路由失败", solution: "RouteStep=failed；节点内挂 RouteFailurePicker：选 Agent / 重试", condition: "同 step_id，不新增系统消息" },
                  { case: "A2A 链深度超限", solution: "线程根横幅暂停 + 管理员恢复", condition: "parent_invocation 链深度默认 5" },
                  { case: "Manager 接力循环", solution: "路由模式接力深度上限，超过暂停", condition: "与 A2A 深度分开计数" },
                  { case: "Agent 直接 @另一个", solution: "新消息 quote 父 Agent 消息，attribution=「由 @X 指定」", condition: "禁止消息子树；Manager 通常不介入" },
                  { case: "所有 Agent 失败", solution: "线程根升级横幅：建议引入角色或人工裁决", condition: "重试耗尽后触发" },
                ].map((e) => (
                  <div key={e.case} style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: C.amber }}>{e.case}</div>
                    <div style={{ color: C.text, marginBottom: 4 }}>✅ {e.solution}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>{e.condition}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Approval */}
        {tab === "approval" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>审批与人工确认</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              高风险审批、阶段压缩确认、冲突处理等「待人工」事项：交互在<strong style={{ color: C.text }}>消息行内轻卡</strong>完成；
              Composer 上方显示<strong style={{ color: C.text }}>待处理横幅</strong>（参考企微 @/未读提示）。流程动态与通知/待办同步记录。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>高风险审批（消息 footer）</h3>
                <ApprovalCardScreen />
                <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>审批规则</div>
                  <div style={{ color: C.textMuted }}>• 二次确认对话框；仅 admin/owner</div>
                  <div style={{ color: C.textMuted }}>• 终态：已批准/已拒绝/已过期（4h）</div>
                  <div style={{ color: C.textMuted }}>• 追加 flow_event + 待处理计数 -1</div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>阶段人工确认（消息轻卡）</h3>
                <HumanConfirmLightCard title="群管判定贪吃蛇任务完成，请确认是否结案" />
                <div style={{ marginTop: 12, background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>确认规则</div>
                  <div style={{ color: C.textMuted }}>• <strong>接受</strong>：自动完成确认事项，并压缩已闭合消息事件子图</div>
                  <div style={{ color: C.textMuted }}>• <strong>拒绝</strong>：必须填写拒绝原因（必填）</div>
                  <div style={{ color: C.textMuted }}>• 可同时推送通知/待办；看板「待处理」+1</div>
                </div>
              </div>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Composer 上方待处理横幅</h3>
            <div style={{ maxWidth: 480, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 24 }}>
              <PendingAttentionBanner />
              <div style={{ padding: 12, fontSize: 11, color: C.textDim, background: C.bg }}>点击跳转至对应消息并展开轻卡；处理完成后横幅消失</div>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>拒绝确认（必填原因 Dialog）</h3>
            <HumanConfirmRejectDialog />

            <Divider label="结案时序（接受路径）" />
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 2, color: C.textMuted, maxWidth: 560 }}>
              <div>1. manager_complete_succeeded（ControlStep）</div>
              <div>2. human_confirm_requested → 消息轻卡 pending + 待处理 +1 + 横幅</div>
              <div>3. 用户点「接受」→ human_confirm_accepted</div>
              <div>4. topic_compressed → 轻卡终态 + 待处理 -1 + 横幅消失 + 阶段折叠</div>
            </div>
            <div style={{ marginTop: 12, background: C.bg, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, maxWidth: 420 }}>
              {REJECT_FLOW_EVENTS.map((ev, i) => (
                <FlowEventRow key={ev.id} event={ev} isLatest={i === REJECT_FLOW_EVENTS.length - 1} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, maxWidth: 560 }}>拒绝路径：保留原轻卡终态与原因，自动生成后续接力事件，不让人工重复解释。</div>
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 560 }}>
              <HumanConfirmLightCard title="群管判定贪吃蛇任务完成，请确认是否结案" status="accepted" />
              <HumanConfirmLightCard title="群管判定贪吃蛇任务完成，请确认是否结案" status="rejected" />
            </div>

            <Divider label="人工友好规则" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 760 }}>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
                <div style={{ fontWeight: 600, color: C.text, marginBottom: 6 }}>打扰分级</div>
                <div>• 普通路由/接力：只进流程动态，不打扰人</div>
                <div>• 需要动作：Composer 横幅 + 消息轻卡 + 待处理计数</div>
                <div>• 离线/超时：通知 + 待办；重新进入房间后横幅恢复</div>
                <div>• 多个待处理：横幅聚合为「N 条待处理」，点击打开待处理抽屉</div>
              </div>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.9, color: C.textMuted }}>
                <div style={{ fontWeight: 600, color: C.text, marginBottom: 6 }}>处理体验</div>
                <div>• 接受：不弹二次确认，直接完成并给轻量 toast</div>
                <div>• 拒绝：必须填写原因，提交后自动引用原消息生成后续任务</div>
                <div>• 稍后处理：不关闭轻卡，只收起横幅到右侧待处理列表</div>
                <div>• 权限不足：按钮禁用 + tooltip，不让用户点完才报错</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Settings */}
        {tab === "settings" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>设置与管理</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              群设置通过右侧 Sheet 滑出展示。权限分为三级：Owner（全部操作）、Admin（编辑信息/管理成员）、Guest（只读）。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>权限矩阵</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 12px", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>操作</div>
                    <div style={{ fontWeight: 600, textAlign: "center" }}>Owner</div>
                    <div style={{ fontWeight: 600, textAlign: "center" }}>Admin</div>
                    <div style={{ fontWeight: 600, textAlign: "center" }}>Guest</div>
                    {[
                      ["编辑名称/描述", true, true, false],
                      ["管理成员", true, true, false],
                      ["配置 Manager Agent", true, true, false],
                      ["归档群", true, false, false],
                      ["转让群主", true, false, false],
                      ["退出群聊", "—", true, true],
                      ["审批操作", true, true, false],
                      ["人工确认（轻卡）", true, true, false],
                      ["切换聊天视图", true, true, true],
                      ["取消他人 Invocation", true, true, false],
                    ].map(([op, o, a, g]) => (
                      <div key={op as string} style={{ display: "contents" }}>
                        <div style={{ color: C.textMuted }}>{op as string}</div>
                        <div style={{ textAlign: "center" }}>{o === true ? "✅" : o === false ? "❌" : o}</div>
                        <div style={{ textAlign: "center" }}>{a === true ? "✅" : a === false ? "❌" : a}</div>
                        <div style={{ textAlign: "center" }}>{g === true ? "✅" : g === false ? "❌" : g}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>成员管理</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>添加成员</div>
                  <div style={{ color: C.textMuted }}>• Dialog 弹窗，支持搜索过滤</div>
                  <div style={{ color: C.textMuted }}>• 可添加 User / Agent / Squad 三类</div>
                  <div style={{ color: C.textMuted }}>• 并行添加（Promise.all）</div>
                  <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>移除成员</div>
                  <div style={{ color: C.textMuted }}>• AlertDialog 二次确认</div>
                  <div style={{ color: C.textMuted }}>• 自己退出 vs 管理员移除</div>
                  <div style={{ color: C.textMuted }}>• Owner 不可被移除</div>
                  <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>角色变更</div>
                  <div style={{ color: C.textMuted }}>• Dropdown 菜单操作</div>
                  <div style={{ color: C.textMuted }}>• 设为管理员 / 取消管理员</div>
                  <div style={{ color: C.textMuted }}>• 转让群主（仅 Owner）</div>
                </div>
              </div>
            </div>

            <Divider label="群管理提示词" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>创建群时的提示词配置</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>RoomManagerPromptTabs 组件</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已实现</span> “定制提示词” Tab（可编辑 Textarea）</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已实现</span> “系统提示词” Tab（只读显示 ROOM_MANAGER_SYSTEM_PROMPT）</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已优化</span> Textarea 高度从 max-h-36 增大到 max-h-56</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已添加</span> “重置默认” 按钮（修改后才显示）</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已添加</span> 字数统计显示</div>
                  <div style={{ color: C.textMuted }}>• <span style={{ color: C.green }}>✅ 已优化</span> 系统提示词 Tab 可滚动（移除 resize-none）</div>
                  <div style={{ fontWeight: 600, color: C.text, marginTop: 12 }}>数据流</div>
                  <div style={{ color: C.textMuted }}>• 创建群：定制提示词 → payload.manager_agent.instructions</div>
                  <div style={{ color: C.textMuted }}>• 设置页：定制提示词 → payload.manager_custom_prompt</div>
                  <div style={{ color: C.textMuted }}>• 后端合并：mergeManagerAgentInstructions(system + custom)</div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>提示词内容结构</h3>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>系统提示词（ROOM_MANAGER_SYSTEM_PROMPT）</div>
                  <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "monospace", background: C.bg, padding: 8, borderRadius: 6, marginBottom: 8, maxHeight: 120, overflow: "auto" }}>
                    你是 Multica 协作群的群管理系统 Agent...<br />
                    ## 定位<br />
                    - 在后台理解群聊上下文...<br />
                    ## 通用能力<br />
                    - 理解用户意图，拆解为群内话题与路由目标...<br />
                    ## 结构化输出（可选）<br />
                    可在回复末尾附加 workflow_action JSON
                  </div>
                  <div style={{ fontWeight: 600, color: C.text, marginTop: 8, marginBottom: 4 }}>默认定制提示词</div>
                  <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "monospace", background: C.bg, padding: 8, borderRadius: 6 }}>
                    根据本群目标路由与监督 Agent 成员完成交付。过程写入消息事件图；阶段完成后压缩为 TopicCard；你负责路由、接力评估与异常升级。
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Backend Design */}
        {tab === "backend" && <BackendDesignScreen />}

        {/* Tab: Benchmark - 对标业内先进产品 */}
        {tab === "benchmark" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>🏆 对标业内先进产品 — UX 优化建议</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
              结合钉钉/企微/ChatGPT/DeepSeek/Cursor 等产品的对话式交互经验，对我们的协作群 UI 进行查漏补缺。
              以下按优先级排列，每项均有对标来源和具体设计建议。
            </p>

            {/* Comparison Matrix */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>对标矩阵：我们 vs 业内最佳实践</h3>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr 1fr 1fr 1fr", gap: "4px 8px", fontSize: 11, minWidth: 800 }}>
                  <div style={{ fontWeight: 700, padding: 6 }}>UX 模式</div>
                  <div style={{ fontWeight: 700, padding: 6, textAlign: "center" }}>Multica 当前</div>
                  <div style={{ fontWeight: 700, padding: 6, textAlign: "center" }}>钉钉/企微</div>
                  <div style={{ fontWeight: 700, padding: 6, textAlign: "center" }}>ChatGPT</div>
                  <div style={{ fontWeight: 700, padding: 6, textAlign: "center" }}>DeepSeek</div>
                  <div style={{ fontWeight: 700, padding: 6, textAlign: "center" }}>Cursor</div>
                  {[
                    ["消息 Hover 工具栏", "❌ 无", "✅ 复制/转发/回应", "✅ 复制/重新生成", "✅ 复制", "✅ 复制/插入"],
                    ["停止生成按钮", "✅ Composer 居中", "—", "✅ 底部居中 ■", "✅ 底部居中 ■", "✅ 顶部停止"],
                    ["自动滚动控制", "❌ 无", "✅ ↓ 回到底部", "✅ ↓ 新消息", "✅ ↓ 回到底部", "✅ 手动滚动"],
                    ["消息分组", "❌ 每条独立", "✅ 同发送者合并", "—", "—", "—"],
                    ["时间分隔线", "❌ 无", "✅ 日期分隔", "✅ 时间标注", "—", "—"],
                    ["可折叠思考过程", "❌ 无", "—", "✅ 推理步骤", "✅ 思维链", "✅ 规划步骤"],
                    ["输入状态指示", "⚠️ 仅计数", "✅ xxx 输入中...", "✅ 三点动画", "—", "✅ 正在思考"],
                    ["键盘快捷键", "⚠️ 仅 Enter", "✅ ↑ 编辑", "✅ ↑ 编辑/Esc", "—", "✅ ⌘K/Ctrl+L"],
                    ["长内容折叠", "❌ 全显示", "✅ 展开更多", "✅ 继续生成", "—", "✅ 折叠"],
                    ["骨架屏加载", "❌ 空白", "✅ 骨架动画", "✅ 骨架动画", "✅ 骨架动画", "✅ 骨架动画"],
                    ["未读消息提示", "❌ 无", "✅ N 条新消息", "—", "—", "—"],
                    ["消息气泡差异化", "⚠️ 简单左右", "✅ 彩色气泡", "✅ 用户/AI 分区", "✅ 用户/AI 分区", "✅ 代码/文本分区"],
                  ].map(([label, ours, dd, gpt, ds, cursor]) => (
                    <div key={label as string} style={{ display: "contents" }}>
                      <div style={{ padding: "6px 4px", fontWeight: 500, color: C.text, borderBottom: `1px solid ${C.border}` }}>{label as string}</div>
                      <div style={{ padding: "6px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: (ours as string).startsWith("❌") ? C.red : (ours as string).startsWith("⚠") ? C.amber : C.green }}>{ours as string}</div>
                      <div style={{ padding: "6px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>{dd as string}</div>
                      <div style={{ padding: "6px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>{gpt as string}</div>
                      <div style={{ padding: "6px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>{ds as string}</div>
                      <div style={{ padding: "6px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>{cursor as string}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Priority 1: Message Hover Toolbar */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🔴 P0：消息 Hover 浮动工具栏 <Badge color={C.red} bg={C.redBg}>对标 ChatGPT / 钉钉</Badge></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>当前问题</div>
                  <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.8 }}>
                    • 操作按钮始终显示或固定在消息底部，视觉噪音大<br />
                    • 视觉噪音大，每条消息都带着操作区域<br />
                    • 移动端和小屏幕上操作按钮拥挤
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.green}30` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.green }}>建议方案</div>
                  <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.8 }}>
                    • Hover 消息时在右上角显示浮动工具栏<br />
                    • 工具栏固定定位，不占用消息空间<br />
                    • 用户消息：编辑 / 引用 / 复制<br />
                    • Agent 消息：复制 / 重新生成 / 引用回复<br />
                    • 移动端：长按弹出菜单替代 hover
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, background: C.bg, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>💬 Hover 工具栏 Wireframe</div>
                <div style={{ position: "relative", maxWidth: 500 }}>
                  <div style={{ background: C.surface, borderRadius: 16, padding: "10px 16px", fontSize: 13, color: C.text, maxWidth: 360 }}>
                    开发贪吃蛇小游戏，网页版
                  </div>
                  <div style={{ position: "absolute", top: -10, right: 0, display: "flex", gap: 2, background: C.surface, borderRadius: 6, padding: "3px 4px", border: `1px solid ${C.borderLight}` }}>
                    {["✏️", "💬", "📋"].map((icon, i) => (
                      <div key={i} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, cursor: "pointer", fontSize: 13 }} title={["编辑", "引用", "复制"][i]}>
                        {icon}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Priority 2: Stop Generation + Auto Scroll */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🔴 P0：停止生成 + 自动滚动控制 <Badge color={C.red} bg={C.redBg}>对标 ChatGPT / DeepSeek</Badge></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>停止生成按钮</div>
                    <div style={{ color: C.textMuted }}>• 仅当「当前用户最近引用链」内有 running 时，Composer 上方显示停止按钮</div>
                    <div style={{ color: C.textMuted }}>• 居中显示，■ 图标 + "停止生成" 文案</div>
                    <div style={{ color: C.textMuted }}>• 仅取消当前用户最近引用链内 running invocation</div>
                    <div style={{ color: C.textMuted }}>• 群级停止仅 admin；禁止误伤他人并行任务</div>
                    <div style={{ color: C.textMuted }}>• 禁止消息行内小链接式「停止」；统一使用 Composer 居中按钮</div>
                    <div style={{ color: C.textMuted }}>• ChatGPT/DeepSeek 都用底部居中大按钮</div>
                  </div>
                  <div style={{ marginTop: 8, background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 20px", background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`, fontSize: 13, color: C.textMuted, cursor: "pointer" }}>
                        <span style={{ color: C.red }}>■</span> 停止生成
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>自动滚动控制</div>
                    <div style={{ color: C.textMuted }}>• 用户主动向上滚动时 → 暂停自动滚动</div>
                    <div style={{ color: C.textMuted }}>• 显示 "↓ 回到底部" 浮动按钮（右下角）</div>
                    <div style={{ color: C.textMuted }}>• 有新消息时 → 按钮变为 "↓ N 条新消息"</div>
                    <div style={{ color: C.textMuted }}>• 点击按钮 → 平滑滚动到底部 + 恢复自动滚动</div>
                    <div style={{ color: C.textMuted }}>• 判断逻辑：scrollTop + clientHeight {'>'} scrollHeight - 100</div>
                  </div>
                  <div style={{ marginTop: 8, background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}`, position: "relative", height: 80 }}>
                    <div style={{ position: "absolute", bottom: 12, right: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                        <span style={{ color: "#fff", fontSize: 16 }}>↓</span>
                      </div>
                    </div>
                    <div style={{ position: "absolute", bottom: 16, left: 12, fontSize: 11, color: C.textMuted }}>用户向上滚动时显示的 FAB</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Priority 3: Message Grouping + Time Separators */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🟡 P1：消息分组 + 时间分隔 <Badge color={C.amber} bg={C.amberBg}>对标 钉钉 / 企微 / Slack</Badge></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>消息分组规则</div>
                  <div style={{ color: C.textMuted }}>• 同一发送者连续消息 → 合并头像，仅第一条显示</div>
                  <div style={{ color: C.textMuted }}>• 后续消息缩进对齐，不重复显示名称</div>
                  <div style={{ color: C.textMuted }}>• 间隔超过 5 分钟 → 重新显示头像和名称</div>
                  <div style={{ color: C.textMuted }}>• Agent 消息不参与用户气泡分组（始终独立显示）</div>
                  <div style={{ color: C.textMuted }}>• 时间分隔线打断分组</div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>时间分隔线</div>
                  <div style={{ color: C.textMuted }}>• 不同日期之间插入日期分隔线（"今天" / "昨天" / "6月8日"）</div>
                  <div style={{ color: C.textMuted }}>• 同一天内间隔超过 2 小时 → 插入时间分隔线（"14:30"）</div>
                  <div style={{ color: C.textMuted }}>• 分隔线样式：居中文字 + 两侧细线</div>
                  <div style={{ color: C.textMuted }}>• 参考钉钉/企微的经典分隔线设计</div>
                </div>
              </div>
              <div style={{ marginTop: 12, background: C.bg, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, maxWidth: 500 }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>💬 消息分组 + 时间分隔 Wireframe</div>
                {/* Date separator */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                  <span style={{ fontSize: 10, color: C.textDim }}>今天</span>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                {/* First message with avatar */}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Avatar name="D" type="user" size={28} />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>dev</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>14:02</span>
                    </div>
                    <div style={{ background: C.surface, borderRadius: 14, padding: "8px 14px", fontSize: 12, color: C.text }}>开发贪吃蛇小游戏</div>
                  </div>
                </div>
                {/* Consecutive message - no avatar */}
                <div style={{ display: "flex", gap: 8, marginTop: 4, paddingLeft: 36 }}>
                  <div style={{ background: C.surface, borderRadius: 14, padding: "8px 14px", fontSize: 12, color: C.text }}>网页版，要支持手机操作</div>
                </div>
                {/* Time separator */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                  <span style={{ fontSize: 10, color: C.textDim }}>16:30</span>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                {/* New group after time gap */}
                <div style={{ display: "flex", gap: 8 }}>
                  <Avatar name="D" type="user" size={28} />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>dev</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>16:30</span>
                    </div>
                    <div style={{ background: C.surface, borderRadius: 14, padding: "8px 14px", fontSize: 12, color: C.text }}>再加个排行榜功能</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Priority 4: Collapsible Thinking + Input Indicator */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🟡 P1：可折叠思考过程 + 输入状态指示 <Badge color={C.amber} bg={C.amberBg}>对标 DeepSeek / ChatGPT</Badge></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>可折叠思考过程</div>
                    <div style={{ color: C.textMuted }}>• Agent 回复中的 workflow_action 或 planning 部分可折叠</div>
                    <div style={{ color: C.textMuted }}>• 默认折叠，仅显示摘要行（"📝 规划了 3 个步骤"）</div>
                    <div style={{ color: C.textMuted }}>• 点击展开查看详细内容</div>
                    <div style={{ color: C.textMuted }}>• DeepSeek 的思维链、ChatGPT 的 Reasoning 都是此模式</div>
                    <div style={{ color: C.textMuted }}>• 减少视觉噪音，用户可选择是否查看</div>
                  </div>
                  <div style={{ marginTop: 8, background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Avatar name="需" type="agent" size={24} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>需求分析师</div>
                        <div style={{ background: C.surface, borderRadius: 8, padding: "6px 10px", fontSize: 11, color: C.textMuted, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <span>▶</span> 📝 规划了 3 个步骤（点击展开）
                        </div>
                        <div style={{ fontSize: 12, color: C.text }}>需求分析完成。功能包含：方向键控制、食物得分、碰撞检测。</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>输入状态指示器</div>
                    <div style={{ color: C.textMuted }}>• 当有 Agent 正在执行时，Header 显示动态指示器</div>
                    <div style={{ color: C.textMuted }}>• 格式："🤖 前端工程师 正在思考…"</div>
                    <div style={{ color: C.textMuted }}>• 多个 Agent 运行时："🤖 2 个 Agent 正在工作…"</div>
                    <div style={{ color: C.textMuted }}>• 三点弹跳动画（经典打字指示器）</div>
                    <div style={{ color: C.textMuted }}>• 替代目前静态的 StatusBar 计数</div>
                  </div>
                  <div style={{ marginTop: 8, background: C.bg, borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", background: C.surface, borderRadius: 8, width: "fit-content" }}>
                      <div style={{ display: "flex", gap: 2 }}>
                        {["⠁", "⠂", "⠄"].map((d, i) => (
                          <span key={i} style={{ fontSize: 14, color: C.primary, animation: `pulse 1.2s ${i * 0.2}s infinite` }}>{d}</span>
                        ))}
                      </div>
                      <span style={{ fontSize: 12, color: C.textMuted }}>前端工程师 正在思考</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Priority 5: Keyboard Shortcuts + Skeleton Loading */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🔵 P2：键盘快捷键 + 骨架屏 + 长内容折叠 <Badge color={C.blue} bg={C.blueBg}>对标 Cursor / ChatGPT</Badge></h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>键盘快捷键增强</div>
                  <div style={{ color: C.textMuted }}><code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>↑</code> 编辑最后一条自己的消息</div>
                  <div style={{ color: C.textMuted }}><code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>Esc</code> 取消编辑 / 引用</div>
                  <div style={{ color: C.textMuted }}><code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>⌘K</code> 快速跳转群（未来）</div>
                  <div style={{ color: C.textMuted }}><code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>⌘/</code> 显示快捷键帮助</div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>来源：ChatGPT / Cursor / Slack</div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>骨架屏加载</div>
                  <div style={{ color: C.textMuted }}>• 消息列表加载时显示骨架屏动画</div>
                  <div style={{ color: C.textMuted }}>• 模拟消息气泡形状（左/右交替）</div>
                  <div style={{ color: C.textMuted }}>• shimmer 动画效果</div>
                  <div style={{ color: C.textMuted }}>• 避免加载时的空白页面感</div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>来源：所有现代聊天应用</div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>长内容折叠</div>
                  <div style={{ color: C.textMuted }}>• 消息超过 500 字时自动折叠</div>
                  <div style={{ color: C.textMuted }}>• 显示 "展开更多 ↓" 按钮</div>
                  <div style={{ color: C.textMuted }}>• Agent 长回复同理</div>
                  <div style={{ color: C.textMuted }}>• 避免超长内容占据整个视口</div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>来源：ChatGPT / 钉钉</div>
                </div>
              </div>
            </div>

            {/* Priority 6: Unread Indicator + Message Bubble */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⚪ P3：未读消息提示 + 气泡视觉差异化</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>未读消息提示</div>
                  <div style={{ color: C.textMuted }}>• 群列表显示未读计数 Badge</div>
                  <div style={{ color: C.textMuted }}>• 滚动离开后有新消息 → 显示 "N 条新消息" 横条</div>
                  <div style={{ color: C.textMuted }}>• 点击横条跳转到第一条未读消息</div>
                  <div style={{ color: C.textMuted }}>• 第一条未读消息上方显示 "—— 新消息 ——" 分隔线</div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>气泡视觉差异化</div>
                  <div style={{ color: C.textMuted }}>• 用户消息：右对齐 + primary 背景色</div>
                  <div style={{ color: C.textMuted }}>• Agent 回复：左对齐 + surface 背景色</div>
                  <div style={{ color: C.textMuted }}>• 禁止居中编排系统消息</div>
                  <div style={{ color: C.textMuted }}>• 考虑用户消息右侧圆角特殊化（气泡尾巴）</div>
                  <div style={{ color: C.textMuted }}>• 与 ChatGPT 的 user/assistant 分区一致</div>
                </div>
              </div>
            </div>

            {/* Summary: Implementation Priority */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>📊 壳层优化优先级（协作语义层见「设计宪法」）</h3>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 80px 1fr", gap: "6px 12px", fontSize: 12, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>优先级</div>
                  <div style={{ fontWeight: 700 }}>改进项</div>
                  <div style={{ fontWeight: 700 }}>工作量</div>
                  <div style={{ fontWeight: 700 }}>对标来源</div>
                  {[
                    ["—", "RoomMessage + quote 双视图", "—", "设计宪法 §3"],
                    ["—", "流程动态 + 话题生命周期", "—", "设计宪法 §6"],
                    ["—", "消息事件图 + 阶段压缩", "—", "设计宪法 §6/§10"],
                    ["P0", "自动滚动控制 + FAB", "2-3h", "所有聊天应用"],
                    ["P0", "停止生成（仅本线程）", "1-2h", "ChatGPT / DeepSeek"],
                    ["P1", "消息 Hover 浮动工具栏", "2-3h", "ChatGPT / 钉钉"],
                    ["P1", "消息折叠/展开 + 活跃聚焦", "2-3h", "设计宪法 §3"],
                    ["P1", "时间分隔线", "1-2h", "钉钉 / 企微"],
                    ["P1", "可折叠思考段（消息内）", "2-3h", "DeepSeek / ChatGPT"],
                    ["P2", "消息分组（仅用户气泡）", "3-4h", "钉钉 / Slack"],
                    ["P2", "键盘快捷键增强", "2-3h", "Cursor / ChatGPT"],
                    ["P2", "骨架屏加载", "1-2h", "现代 Web App"],
                    ["P3", "未读消息提示", "2-3h", "钉钉 / 企微"],
                  ].map(([p, item, effort, source]) => (
                    <div key={item as string} style={{ display: "contents" }}>
                      <div style={{ padding: "4px 0" }}>
                        <Badge color={(p as string) === "P0" ? C.red : (p as string) === "P1" ? C.amber : (p as string) === "P2" ? C.blue : C.textMuted} bg={`${(p as string) === "P0" ? C.red : (p as string) === "P1" ? C.amber : (p as string) === "P2" ? C.blue : C.textMuted}20`}>
                          {p as string}
                        </Badge>
                      </div>
                      <div style={{ padding: "4px 0", color: C.text }}>{item as string}</div>
                      <div style={{ padding: "4px 0", color: C.textDim }}>{effort as string}</div>
                      <div style={{ padding: "4px 0", color: C.textMuted, fontSize: 11 }}>{source as string}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Exceptions */}
        {tab === "exceptions" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>异常场景与边界 UI</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>以下是协作群各类异常场景的 UI 设计。每种异常都有明确的用户感知方式和恢复路径。</p>

            {/* Network / API Errors */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>1. 网络与 API 错误</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.red }}>发送失败</div>
                  <div style={{ background: C.bg, borderRadius: 16, padding: "8px 14px", fontSize: 13, color: C.text, marginBottom: 8, border: `1px solid ${C.red}30` }}>
                    这是一条发送失败的消息
                    <span style={{ color: C.red, fontSize: 10, marginLeft: 6 }}>✗ 失败</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn small variant="outline">重试</Btn>
                    <Btn small variant="ghost">删除</Btn>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
                    乐观消息保留在列表，标记红色边框；提供重试/删除；toast 显示原因
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.amber }}>加载失败</div>
                  <div style={{ background: C.bg, borderRadius: 10, padding: 20, textAlign: "center", border: `1px solid ${C.amber}30` }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>😵</div>
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>消息加载失败</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>网络异常</div>
                    <Btn small variant="outline">重新加载</Btn>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
                    React Query error 状态 + 重试按钮
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.amber }}>WS 断连</div>
                  <div style={{ padding: "6px 12px", background: "rgba(245,158,11,0.08)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber }} />
                    <span style={{ fontSize: 11, color: C.amber }}>连接已断开，正在重连…</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
                    状态栏变黄；自动重连后恢复；超 30s 显示手动刷新
                  </div>
                </div>
              </div>
            </div>

            {/* Permission Errors */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>2. 权限与授权异常</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.red }}>非成员访问</div>
                  <div style={{ background: C.bg, borderRadius: 10, padding: 24, textAlign: "center", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 4 }}>无权限访问此群</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>你不是该群的成员</div>
                    <Btn variant="outline">返回群列表</Btn>
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.red }}>操作被拒绝</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.redBg, borderRadius: 8, marginBottom: 8 }}>
                    <span>⛔</span>
                    <span style={{ fontSize: 12, color: C.red }}>权限不足：仅群管理员可执行此操作</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
                    Guest 审批/人工确认 → toast.error | 非作者取消 invocation → 403 | 非 admin 设置 → 按钮不显示
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.amber }}>Guest 只读边界</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 11, color: C.textMuted, lineHeight: 1.8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>可见</div>
                      消息列表（双视图）· 流程动态只读 · 阶段摘要 · 成员列表
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>不可见/禁用</div>
                      Composer 禁用 · 审批/确认轻卡无操作按钮 · 停止生成 · 成员管理 · 群设置危险操作
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Route Failure */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>3. 路由失败</h3>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, maxWidth: 480 }}>
                <RouteFailurePicker />
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>
                  出现在消息区异常横幅；用户选手动 Agent 后创建新 Agent 消息，等同人工 route
                </div>
              </div>
            </div>

            {/* Agent Execution Errors */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>4. Agent 执行异常</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.red }}>回答失败</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Avatar name="前" type="agent" size={24} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.textMuted }}>前端工程师</span>
                        <Badge color={C.red} bg={C.redBg}>回答失败</Badge>
                      </div>
                      <div style={{ background: C.redBg, borderRadius: 12, padding: "8px 12px", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Agent 未能完成回答。</div>
                      <Btn small variant="ghost">🔄 重试</Btn>
                    </div>
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.amber }}>永久排队</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Avatar name="后" type="agent" size={24} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.textMuted }}>后端工程师</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.amber }}>⠋ 排队中 · 5m 12s</div>
                      <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>⚠️ 排队超过 5 分钟</div>
                    </div>
                  </div>
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.amber }}>链式暂停</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Avatar name="S" type="agent" size={24} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.textMuted }}>SQA 团队长</span>
                        <Badge color={C.amber} bg={C.amberBg}>已暂停</Badge>
                      </div>
                      <div style={{ background: C.amberBg, borderRadius: 12, padding: "8px 12px", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>链式调用深度已达上限，需管理员手动恢复。</div>
                      <Btn small variant="outline">▶ 恢复</Btn>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Empty States */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>5. 空态与边界</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
                {[
                  { icon: "💬", desc: "暂无协作群", action: "创建第一个群" },
                  { icon: "📭", desc: "开始对话吧", action: null },
                  { icon: "👤", desc: "暂无群成员", action: null },
                  { icon: "🤖", desc: "暂无可用 Agent", action: "去创建" },
                ].map((e, i) => (
                  <div key={i} style={{ background: C.surface, borderRadius: 10, padding: 20, border: `1px solid ${C.border}`, textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{e.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>{e.desc}</div>
                    {e.action && <div style={{ fontSize: 12, color: C.primaryLight, cursor: "pointer" }}>{e.action}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Optimistic / Race Conditions */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>6. 乐观更新与竞态</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8, color: C.textMuted }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>乐观消息 ID 冲突</div>
                  乐观消息用 optimistic-timestamp 作为临时 ID；发送中禁止「编辑」操作；Hover 工具栏 disabled + tooltip；WS 返回真实 message 后自动替换
                </div>
                <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8, color: C.textMuted }}>
                  <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>并发 @mention 同一 Agent</div>
                  第一个 @ 进入 running；后续 @ 进入 queued 并显示等待计时；每条 queued 消息独立显示等待时间；前一个完成后自动 dequeue 下一个
                </div>
              </div>
            </div>

            {/* Archived */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>7. 归档与退出后</h3>
              <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.8, color: C.textMuted }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <div><div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>归档群</div>AlertDialog 二次确认 → 导航到群列表 → 从侧边栏移除 → 进行中任务被取消</div>
                  <div><div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>退出群（非 owner）</div>AlertDialog 确认 → 导航到群列表 → 聊天记录不可见 → 可被重新邀请</div>
                  <div><div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>Owner 退出限制</div>设置页显示「群主需先转让后才能退出」→ 退出按钮不显示</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Acceptance Checklist */}
        {tab === "acceptance" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>验收清单</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20, lineHeight: 1.6, maxWidth: 720 }}>
              工程实施与回归测试以本清单为准。每项均为<strong style={{ color: C.text }}>规范性要求</strong>，对应「📜 设计宪法」及各 Tab 线框；不存在平行方案或可选路径。
            </p>

            {[
              {
                title: "域边界与 API 契约",
                color: C.primary,
                items: [
                  "RoomMessage / ControlStep / Topic / FlowEvent / HumanAction / Snapshot 字段与「🧩 后台方案」契约一致，snake_case",
                  "FlowEvent 可独立写入，不依赖 Topic 预先存在；Topic 仅由压缩流程创建/更新",
                  "公有 API 与 UI 不出现 Delivery 概念",
                  "所有 room 响应经 zod parseWithFallback；query key 含 wsId + roomId",
                  "所有控制步骤写入 step_id；同一 step_id 的 running/result/error 可幂等 patch",
                ],
              },
              {
                title: "消息模型与双视图",
                color: C.blue,
                items: [
                  "思考中→完成是同一 message_id 的状态变迁；禁止拆成两条消息",
                  "Agent 互@ = 新消息 + quote_message_id；禁止消息子树嵌套",
                  "默认 ThreadBlock；可切换时间线；偏好存 room:{roomId}:chatView",
                  "聊天区始终全量 RoomMessage；展开/折叠 Topic 不过滤聊天区",
                  "Agent 产出仅 message content；无居中系统失败墙",
                  "attribution pill 表达路由/@ 来源；禁止 route_hint 独立行",
                ],
              },
              {
                title: "三种协作模式",
                color: C.green,
                items: [
                  "路由（无@）：RouteStep running → succeeded/failed；成功后 Agent message attribution「由群管理分配指定」",
                  "直连（单@）：Manager 不 route；Agent 直接执行；仅异常时升级",
                  "并行（多@）：每条 @ 独立 invocation；Manager 不 route、不 review",
                  "并行模式：多 Agent 消息并列 quote 同一用户消息",
                  "失败展示：消息行内 TerminalBody / 异常横幅 + RouteFailurePicker；禁止 ⚠️ XX 回答失败 系统消息墙",
                ],
              },
              {
                title: "流程动态与阶段压缩",
                color: C.amber,
                items: [
                  "flow_event 含 category；message/control/confirm/phase/meta 投影规则固定",
                  "message 类事件折叠进消息节点；不单独占流程行",
                  "control/confirm 类事件按 step_id 合并为 ControlStep 原子节点；路由决策中与结果不得拆分",
                  "agent_at / relay_hint 作为 ControlStep；聊天区不渲染对应卡片",
                  "Topic 压缩仅在人工确认接受、授权结案或手动归档后发生；可展开还原原始子图",
                  "结案：manager_complete_succeeded → human_confirm_requested → accepted → topic_compressed",
                  "pending_count = 待人工确认事项数（非 invocation pending 数）",
                  "流程动态分页：limit=20 + before 游标；点击节点滚动高亮 message",
                ],
              },
              {
                title: "Manager 路由与监督",
                color: C.primary,
                items: [
                  "路由失败：RouteStep=failed，节点内挂 RouteFailurePicker；不写散文系统消息",
                  "接力仅写 RelayStep；聊天区无 relay hint 卡",
                  "升级：EscalateStep + 异常横幅；不生成 agent_at 聊天行",
                  "直连/并行成功路径不 enqueueManagerReview",
                  "Agent 互@深度超限 → paused + 恢复入口（admin）",
                ],
              },
              {
                title: "人工确认与审批",
                color: C.red,
                items: [
                  "human_confirm：消息行内轻卡 + Composer 横幅；拒绝必填原因并写 flow_event",
                  "接受 → human_confirm_accepted + topic_compressed；待处理 -1",
                  "Approval：消息 footer 轻卡；AlertDialog 二次确认；guest 不可审批",
                  "human_action sweeper：expires_at 到期 → expired",
                ],
              },
              {
                title: "Invocation 生命周期",
                color: C.blue,
                items: [
                  "dispatch：queued → running；running 只更新预创建 Agent message",
                  "completion：先落 content + invocation.status → message 类 flow_event → WS 广播",
                  "sweeper：超时 → timed_out；drain 失败必须写 failed + 日志",
                  "停止：仅当前用户最近引用链内 running；Composer 居中按钮",
                  "Cancel：仅 author 或 admin；Retry 检查 max_retries",
                ],
              },
              {
                title: "WebSocket 与实时",
                color: C.green,
                items: [
                  "订阅 room:message / flow_event / control_step_updated / invocation_updated / approval_requested / human_action_updated / snapshot_updated",
                  "flow_event：append + 按 category 投影；control_step_updated：按 step_id patch；snapshot_updated：刷新看板 pending/running/compressed_topics",
                  "优先 patch by id；失败再 invalidate",
                ],
              },
              {
                title: "工程约束",
                color: C.textMuted,
                items: [
                  "packages/views/room 零 next/*、react-router-dom；路由用 NavigationAdapter",
                  "packages/core/room 零 react-dom；状态：Query 管服务端、Zustand 管客户端 UI",
                  "web + desktop 共用 RoomView；禁止重复实现",
                  "Manager prompt 输出结构化 action/step，不写散文系统消息",
                ],
              },
            ].map((section) => (
              <div key={section.title} style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: section.color }}>{section.title}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {section.items.map((item) => (
                    <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}`, fontSize: 12, lineHeight: 1.7, color: C.textMuted }}>
                      <span style={{ color: C.green, flexShrink: 0, marginTop: 1 }}>☐</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ background: C.primaryBg, borderRadius: 10, padding: 14, border: `1px solid ${C.primary}30`, fontSize: 12, color: C.textMuted, lineHeight: 1.7 }}>
              <strong style={{ color: C.primaryLight }}>使用方式：</strong>
              从「域边界」→「消息模型」→「协作模式」顺序实施；每完成一组在 PR 描述中勾选对应条目。
              争议以「📜 设计宪法」11 条为最终裁决，不得引用已删除的平行 spec。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
