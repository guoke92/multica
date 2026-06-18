/**
 * 协作群 Room 域 — 前端 UI/UX 唯一设计规范
 *
 * 本规范基于新 Room 协作模型：
 * Message / Mention / Assignment / Invocation / ManagerDecision / InvocationEvent。
 *
 * 不保留旧的 Topic / Delivery / ControlStep / FlowEvent step_id / 全链 message_id anchor
 * 等兼容交互。若实现与本文冲突，以本文为准。
 */
import { useState, type CSSProperties, type ReactNode } from "react";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surface2: "#202434",
  surfaceHover: "#252a3c",
  border: "#2a2e3e",
  borderLight: "#3a4057",
  text: "#e4e6ed",
  textMuted: "#9aa0b2",
  textDim: "#656b7d",
  primary: "#6366f1",
  primaryLight: "#818cf8",
  primaryBg: "rgba(99,102,241,0.14)",
  green: "#22c55e",
  greenBg: "rgba(34,197,94,0.14)",
  red: "#ef4444",
  redBg: "rgba(239,68,68,0.14)",
  amber: "#f59e0b",
  amberBg: "rgba(245,158,11,0.14)",
  blue: "#3b82f6",
  blueBg: "rgba(59,130,246,0.14)",
};

type BadgeTone = "default" | "manager" | "running" | "success" | "error" | "muted";
type MessageSenderType = "user" | "agent" | "system";
type MentionTargetType = "agent" | "squad" | "member" | "user" | "issue" | "all";
type AssignmentKind =
  | "mention"
  | "auto_review"
  | "manager_route"
  | "manager_relay"
  | "approval"
  | "retry"
  | "timeout_review"
  | "reassign"
  | "join";
type AssignmentStatus = "pending" | "blocked" | "running" | "completed" | "failed" | "cancelled" | "skipped";
type InvocationStatus =
  | "pending"
  | "queued"
  | "running"
  | "delivered"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";
type ManagerAction = "assign" | "ask_user" | "complete" | "retry" | "reassign" | "wait" | "skip";

type RoomMessage = {
  id: string;
  sender: string;
  senderType: MessageSenderType;
  content: string;
  time: string;
  quoteMessageId?: string | null;
};

type RoomMention = {
  id: string;
  messageId: string;
  targetType: MentionTargetType;
  targetId?: string;
  label: string;
};

type RoomAssignment = {
  id: string;
  sourceMessageId: string;
  assignee: string;
  assigneeType: "agent" | "squad" | "manager" | "user";
  kind: AssignmentKind;
  status: AssignmentStatus;
  reason?: string;
  outputMessageId?: string;
  createdBy: "user" | "agent" | "manager" | "system";
};

type AssignmentDependency = {
  assignmentId: string;
  dependsOnAssignmentId: string;
};

type RoomInvocation = {
  id: string;
  assignmentId: string;
  status: InvocationStatus;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
};

type ManagerDecision = {
  id: string;
  sourceMessageId: string;
  action: ManagerAction;
  reason: string;
  createdAssignmentIds: string[];
};

const toneStyle: Record<BadgeTone, { color: string; bg: string }> = {
  default: { color: C.textMuted, bg: C.surface2 },
  manager: { color: C.primaryLight, bg: C.primaryBg },
  running: { color: C.amber, bg: C.amberBg },
  success: { color: C.green, bg: C.greenBg },
  error: { color: C.red, bg: C.redBg },
  muted: { color: C.textDim, bg: C.bg },
};

const assignmentStatusTone: Record<AssignmentStatus, BadgeTone> = {
  pending: "muted",
  blocked: "running",
  running: "running",
  completed: "success",
  failed: "error",
  cancelled: "muted",
  skipped: "muted",
};

const assignmentStatusText: Record<AssignmentStatus, string> = {
  pending: "待处理",
  blocked: "等待依赖",
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  skipped: "无需处理",
};

const assignmentKindText: Record<AssignmentKind, string> = {
  mention: "直接 @ 指派",
  auto_review: "群管判断下一步",
  manager_route: "群管路由",
  manager_relay: "群管接力",
  approval: "人工确认",
  retry: "失败重试",
  timeout_review: "超时分析",
  reassign: "重新指派",
  join: "等待并汇合",
};

const cn: CSSProperties = {
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
};

function Badge({ children, tone = "default" }: { children: ReactNode; tone?: BadgeTone }) {
  const s = toneStyle[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
        lineHeight: "16px",
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Button({
  children,
  variant = "default",
  small = false,
}: {
  children: ReactNode;
  variant?: "default" | "outline" | "ghost" | "danger";
  small?: boolean;
}) {
  const base: CSSProperties = {
    border: "none",
    borderRadius: 7,
    padding: small ? "4px 9px" : "7px 12px",
    fontSize: small ? 11 : 12,
    fontWeight: 600,
    cursor: "pointer",
  };
  const styles: Record<string, CSSProperties> = {
    default: { ...base, background: C.primary, color: "white" },
    outline: { ...base, background: "transparent", color: C.text, border: `1px solid ${C.borderLight}` },
    ghost: { ...base, background: "transparent", color: C.textMuted },
    danger: { ...base, background: C.red, color: "white" },
  };
  return <button style={styles[variant]}>{children}</button>;
}

function Avatar({ name, type = "agent", size = 28 }: { name: string; type?: MessageSenderType | "manager"; size?: number }) {
  const bg =
    type === "user" ? C.primary : type === "manager" ? C.primaryLight : type === "system" ? C.textDim : "#8b5cf6";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: bg,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(11, size * 0.42),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0, color: C.text, fontSize: 17, fontWeight: 700 }}>{title}</h2>
      {desc ? <p style={{ margin: "6px 0 0", color: C.textMuted, fontSize: 13, lineHeight: 1.7 }}>{desc}</p> : null}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 16px" }}>
      <div style={{ height: 1, flex: 1, background: C.border }} />
      <span style={{ color: C.textDim, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
        {label}
      </span>
      <div style={{ height: 1, flex: 1, background: C.border }} />
    </div>
  );
}

const ROOMS = [
  { id: "dev", name: "开发", desc: "贪吃蛇游戏开发", active: true },
  { id: "product", name: "产品讨论", desc: "需求评审与排期", active: false },
  { id: "ops", name: "运维告警", desc: "线上异常协作", active: false },
];

const MESSAGES: RoomMessage[] = [
  { id: "m1", sender: "dev", senderType: "user", content: "开发一个贪吃蛇小游戏", time: "09:55" },
  {
    id: "m2",
    sender: "需求分析师",
    senderType: "agent",
    quoteMessageId: "m1",
    content: "需求方案已完成：方向键控制、得分、碰撞检测、胜负状态、移动端 D-Pad。",
    time: "09:58",
  },
  {
    id: "m3",
    sender: "系统架构师",
    senderType: "agent",
    quoteMessageId: "m2",
    content: "架构方案已完成：不引入 Phaser，使用 Canvas + gameEngine + controller + storage 模块。",
    time: "10:00",
  },
  {
    id: "m4",
    sender: "前端工程师",
    senderType: "agent",
    quoteMessageId: "m3",
    content: "正在实现核心逻辑与键盘/触控控制。",
    time: "10:04",
  },
  {
    id: "m5",
    sender: "UI/UX 设计师",
    senderType: "agent",
    quoteMessageId: "m3",
    content: "正在补充游戏面板、结束态和移动端操作说明。",
    time: "10:04",
  },
];

const MENTIONS: RoomMention[] = [
  { id: "mention1", messageId: "m3", targetType: "agent", targetId: "front", label: "@前端工程师" },
  { id: "mention2", messageId: "m3", targetType: "agent", targetId: "ui", label: "@UI/UX 设计师" },
];

const ASSIGNMENTS: RoomAssignment[] = [
  {
    id: "a1",
    sourceMessageId: "m1",
    assignee: "群管",
    assigneeType: "manager",
    kind: "auto_review",
    status: "completed",
    reason: "用户未指定执行者，需要判断首个负责人。",
    createdBy: "system",
  },
  {
    id: "a2",
    sourceMessageId: "m1",
    assignee: "需求分析师",
    assigneeType: "agent",
    kind: "manager_route",
    status: "completed",
    reason: "先明确需求边界与验收点。",
    outputMessageId: "m2",
    createdBy: "manager",
  },
  {
    id: "a3",
    sourceMessageId: "m2",
    assignee: "群管",
    assigneeType: "manager",
    kind: "auto_review",
    status: "completed",
    reason: "Agent 输出没有 @ 下一跳，需要群管判断。",
    createdBy: "system",
  },
  {
    id: "a4",
    sourceMessageId: "m2",
    assignee: "系统架构师",
    assigneeType: "agent",
    kind: "manager_relay",
    status: "completed",
    reason: "基于需求方案完成技术架构。",
    outputMessageId: "m3",
    createdBy: "manager",
  },
  {
    id: "a5",
    sourceMessageId: "m3",
    assignee: "群管",
    assigneeType: "manager",
    kind: "auto_review",
    status: "completed",
    reason: "架构已完成，判断后续并行推进者。",
    createdBy: "system",
  },
  {
    id: "a6",
    sourceMessageId: "m3",
    assignee: "前端工程师",
    assigneeType: "agent",
    kind: "manager_relay",
    status: "running",
    reason: "实现 Canvas 游戏、控制器、存储与胜负状态。",
    createdBy: "manager",
  },
  {
    id: "a7",
    sourceMessageId: "m3",
    assignee: "UI/UX 设计师",
    assigneeType: "agent",
    kind: "manager_relay",
    status: "running",
    reason: "补充游戏界面、移动端 D-Pad 与结束态。",
    createdBy: "manager",
  },
];

const INVOCATIONS: RoomInvocation[] = [
  { id: "i1", assignmentId: "a1", status: "succeeded", startedAt: "09:55", completedAt: "09:56" },
  { id: "i2", assignmentId: "a2", status: "succeeded", startedAt: "09:56", completedAt: "09:58" },
  { id: "i3", assignmentId: "a3", status: "succeeded", startedAt: "09:58", completedAt: "09:58" },
  { id: "i4", assignmentId: "a4", status: "succeeded", startedAt: "09:58", completedAt: "10:00" },
  { id: "i5", assignmentId: "a5", status: "succeeded", startedAt: "10:00", completedAt: "10:01" },
  { id: "i6", assignmentId: "a6", status: "running", startedAt: "10:04" },
  { id: "i7", assignmentId: "a7", status: "queued", startedAt: "10:04" },
];

const DECISIONS: ManagerDecision[] = [
  {
    id: "d1",
    sourceMessageId: "m1",
    action: "assign",
    reason: "这是一个新开发任务，先由需求分析师澄清功能边界。",
    createdAssignmentIds: ["a2"],
  },
  {
    id: "d2",
    sourceMessageId: "m2",
    action: "assign",
    reason: "需求方案已形成，需要系统架构师设计实现结构。",
    createdAssignmentIds: ["a4"],
  },
  {
    id: "d3",
    sourceMessageId: "m3",
    action: "assign",
    reason: "架构已完成，前端实现与 UI 设计可以并行。",
    createdAssignmentIds: ["a6", "a7"],
  },
];

const JOIN_ASSIGNMENTS: RoomAssignment[] = [
  {
    id: "j1",
    sourceMessageId: "jm1",
    assignee: "AgentB",
    assigneeType: "agent",
    kind: "mention",
    status: "completed",
    reason: "确认问题 1",
    outputMessageId: "jm2",
    createdBy: "agent",
  },
  {
    id: "j2",
    sourceMessageId: "jm1",
    assignee: "AgentC",
    assigneeType: "agent",
    kind: "mention",
    status: "completed",
    reason: "确认问题 2",
    outputMessageId: "jm3",
    createdBy: "agent",
  },
  {
    id: "j3",
    sourceMessageId: "jm1",
    assignee: "AgentA",
    assigneeType: "agent",
    kind: "join",
    status: "running",
    reason: "等待 AgentB 与 AgentC 均确认后，自动触发 AgentA 继续下一步。",
    createdBy: "system",
  },
];

const JOIN_DEPENDENCIES: AssignmentDependency[] = [
  { assignmentId: "j3", dependsOnAssignmentId: "j1" },
  { assignmentId: "j3", dependsOnAssignmentId: "j2" },
];

function mentionLabels(messageId: string) {
  return MENTIONS.filter((m) => m.messageId === messageId).map((m) => m.label);
}

function messageById(id?: string | null) {
  return id ? MESSAGES.find((m) => m.id === id) : undefined;
}

const MEMBER_RUNTIME = [
  { id: "manager", name: "群管", status: "空闲", detail: "最近判断：前端/UI 并行", tone: "success" as BadgeTone },
  { id: "req", name: "需求分析师", status: "空闲", detail: "已完成需求方案", tone: "muted" as BadgeTone },
  { id: "arch", name: "系统架构师", status: "空闲", detail: "已完成架构方案", tone: "muted" as BadgeTone },
  { id: "front", name: "前端工程师", status: "运行中", detail: "正在实现 Canvas 游戏", tone: "running" as BadgeTone },
  { id: "ui", name: "UI/UX 设计师", status: "排队中", detail: "等待执行 UI 方案", tone: "running" as BadgeTone },
];

const summaryCounts = {
  pending: ASSIGNMENTS.filter((a) => a.status === "pending").length,
  running: ASSIGNMENTS.filter((a) => a.status === "running").length,
  failed: ASSIGNMENTS.filter((a) => a.status === "failed").length,
  completed: ASSIGNMENTS.filter((a) => a.status === "completed").length,
};

function AttentionStrip() {
  const active = ASSIGNMENTS.filter((a) => a.status === "running" || a.status === "failed" || a.status === "pending");
  if (active.length === 0) return null;
  return (
    <div
      style={{
        margin: "10px 0 2px",
        border: `1px solid ${C.border}`,
        background: C.surface,
        borderRadius: 10,
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: C.textMuted, fontSize: 11 }}>当前进行</span>
      {active.slice(0, 3).map((a) => (
        <Badge key={a.id} tone={assignmentStatusTone[a.status]}>
          {a.assignee} · {assignmentStatusText[a.status]}
        </Badge>
      ))}
      {active.length > 3 ? <span style={{ color: C.textDim, fontSize: 11 }}>+{active.length - 3}</span> : null}
    </div>
  );
}

function MessageRow({ message }: { message: RoomMessage }) {
  const quote = messageById(message.quoteMessageId);
  const labels = mentionLabels(message.id);
  const isUser = message.senderType === "user";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, flexDirection: isUser ? "row-reverse" : "row" }}>
        <Avatar name={message.sender} type={message.senderType} />
        <div style={{ flex: 1, maxWidth: "86%", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: isUser ? "flex-end" : "flex-start",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 5,
            }}
          >
            <span style={{ color: C.textMuted, fontSize: 11 }}>{message.sender}</span>
            <span style={{ color: C.textDim, fontSize: 10 }}>{message.time}</span>
          </div>
          {quote ? (
            <div
              style={{
                borderLeft: `2px solid ${C.borderLight}`,
                paddingLeft: 8,
                color: C.textDim,
                fontSize: 10,
                lineHeight: 1.5,
                marginBottom: 6,
              }}
            >
              回复 {quote.sender}：{quote.content.slice(0, 42)}
              {quote.content.length > 42 ? "..." : ""}
            </div>
          ) : null}
          <div
            style={{
              background: isUser ? C.primaryBg : C.surface,
              border: `1px solid ${isUser ? `${C.primary}33` : C.border}`,
              borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              padding: "9px 12px",
              color: C.text,
              fontSize: 12,
              lineHeight: 1.65,
              textAlign: isUser ? "right" : "left",
            }}
          >
            {message.content}
          </div>
          {labels.length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {labels.map((label) => (
                <Badge key={label} tone="manager">
                  {label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlatMessageList() {
  return (
    <div>
      <AttentionStrip />
      {MESSAGES.map((msg) => (
        <MessageRow key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function RoomShellPreview() {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: "hidden",
        background: C.bg,
        height: 680,
        display: "grid",
        gridTemplateColumns: "210px 1fr 300px",
      }}
    >
      <aside style={{ borderRight: `1px solid ${C.border}`, padding: 12 }}>
        <div style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>协作群</div>
        {ROOMS.map((room) => (
          <div
            key={room.id}
            style={{
              padding: 10,
              borderRadius: 10,
              background: room.active ? C.surface2 : "transparent",
              border: room.active ? `1px solid ${C.border}` : "1px solid transparent",
              marginBottom: 6,
            }}
          >
            <div style={{ color: C.text, fontSize: 12, fontWeight: 650 }}>{room.name}</div>
            <div style={{ color: C.textDim, fontSize: 10, marginTop: 3 }}>{room.desc}</div>
          </div>
        ))}
      </aside>
      <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>开发</div>
            <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>群聊式平铺消息，引用只作为消息内预览</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button small>消息</Button>
            <Button small variant="outline">流程</Button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          <FlatMessageList />
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, padding: 12 }}>
          <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 12, background: C.surface, padding: 10 }}>
            <div style={{ color: C.textDim, fontSize: 11, marginBottom: 8 }}>
              引用只能选一条；可同时 @ 多个 Agent。无 @ 时自动生成群管判断 Assignment。
            </div>
            <div style={{ color: C.textMuted, fontSize: 12 }}>输入消息，@ 提及成员或 Agent...</div>
          </div>
        </div>
      </main>
      <aside style={{ borderLeft: `1px solid ${C.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        <WorkboardPanel />
      </aside>
    </div>
  );
}

function StatPill({ label, value, tone = "default" }: { label: string; value: number; tone?: BadgeTone }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 8px" }}>
      <div style={{ color: C.textDim, fontSize: 9, marginBottom: 2 }}>{label}</div>
      <div style={{ color: toneStyle[tone].color, fontSize: 15, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function MemberRuntimeList() {
  return (
    <div>
      <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, margin: "12px 0 7px" }}>成员状态</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {MEMBER_RUNTIME.map((member) => (
          <div key={member.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "center" }}>
            <Avatar name={member.name} type={member.id === "manager" ? "manager" : "agent"} size={24} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.text, fontSize: 11, fontWeight: 650 }}>{member.name}</div>
              <div style={{ color: C.textDim, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {member.detail}
              </div>
            </div>
            <Badge tone={member.tone}>{member.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkboardPanel() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>协作状态</div>
        <Badge tone="running">{summaryCounts.running} 运行中</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <StatPill label="待处理" value={summaryCounts.pending} />
        <StatPill label="运行中" value={summaryCounts.running} tone="running" />
        <StatPill label="异常" value={summaryCounts.failed} tone="error" />
        <StatPill label="完成" value={summaryCounts.completed} tone="success" />
      </div>
      <MemberRuntimeList />
      <Divider label="流程动态" />
      <FlowTimeline />
    </div>
  );
}

function FlowTimeline() {
  const ordered = ASSIGNMENTS;
  const join = JOIN_ASSIGNMENTS.find((a) => a.kind === "join");
  const joinDeps = join
    ? JOIN_DEPENDENCIES.filter((d) => d.assignmentId === join.id)
        .map((d) => JOIN_ASSIGNMENTS.find((a) => a.id === d.dependsOnAssignmentId))
        .filter(Boolean) as RoomAssignment[]
    : [];
  const joinDone = joinDeps.filter((d) => d.status === "completed").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ordered.map((a, index) => (
        <div key={a.id} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: toneStyle[assignmentStatusTone[a.status]].color,
                marginTop: 5,
              }}
            />
            {index < ordered.length - 1 ? <div style={{ flex: 1, width: 1, background: C.border, minHeight: 18 }} /> : null}
          </div>
          <div>
            <div style={{ color: C.text, fontSize: 11, fontWeight: 650 }}>{a.assignee}</div>
            <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.45 }}>
              {assignmentKindText[a.kind]} · 来源 #{a.sourceMessageId}
            </div>
          </div>
        </div>
      ))}
      {join ? (
        <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: joinDone === joinDeps.length ? C.green : C.amber,
                marginTop: 5,
              }}
            />
          </div>
          <div
            style={{
              border: `1px solid ${C.primary}33`,
              background: C.primaryBg,
              borderRadius: 8,
              padding: "7px 8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ color: C.primaryLight, fontSize: 11, fontWeight: 700 }}>Join · 等待确认完成后触发 AgentA</div>
              <Badge tone={joinDone === joinDeps.length ? "success" : "running"}>
                {joinDone}/{joinDeps.length}
              </Badge>
            </div>
            <div style={{ color: C.textDim, fontSize: 10, marginTop: 4 }}>
              AgentB、AgentC 均完成后自动触发 AgentA；不在聊天里要求分别 @ 回流。
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SpecList({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: C.surface,
            padding: "9px 12px",
            color: C.textMuted,
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function ModelTab() {
  const rows = [
    ["RoomMessage", "消息内容事实：文本、发送者、quote_message_id。不得承载 pending/running 执行状态。"],
    ["RoomMessageMention", "结构化 @：一条消息可 @ 多个对象；只有 agent/squad 自动生成 Assignment。"],
    ["RoomAssignment", "协作指派：某条 source message 需要谁处理。UI 主状态读它。"],
    ["AssignmentDependency", "等待关系：一个 blocked/join assignment 可依赖多个前置 assignment 全部完成。"],
    ["RoomInvocation", "一次 Agent 执行尝试：排队、运行、失败、超时、重试。"],
    ["RoomManagerDecision", "群管决策审计：assign / complete / wait / retry 等。"],
    ["RoomInvocationEvent", "append-only 运行事件：流程动态的原子事实源。"],
  ];
  return (
    <div>
      <SectionTitle
        title="数据模型与 UI 职责"
        desc="前端不再从 invocation.message_id、flow_event.step_id 或 Topic 推断流程。聊天窗口只展示平铺消息；Assignment 是右侧协作状态和流程动态的事实来源。"
      />
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: "10px 16px", fontSize: 12 }}>
          {rows.map(([name, desc]) => (
            <div key={name} style={{ display: "contents" }}>
              <div style={{ color: C.primaryLight, fontFamily: "monospace", fontWeight: 700 }}>{name}</div>
              <div style={{ color: C.textMuted, lineHeight: 1.7 }}>{desc}</div>
            </div>
          ))}
        </div>
      </Card>
      <Divider label="删除旧交互" />
      <SpecList
        items={[
          "删除 Topic/阶段压缩作为流程主入口；若未来需要 Topic，只能作为消息图的只读分组投影。",
          "删除 route_hint / relay_hint / agent_at 这类独立聊天卡；群管补边显示为 Assignment 和 Decision。",
          "删除 message state 表达 Agent 运行时；思考中、排队中、失败重试属于 Invocation 展开细节。",
          "删除 enqueueManagerReview 语义在 UI 中的暴露；统一文案为“群管判断下一步”。",
          "删除大块 Workboard 分组卡片；右侧只保留状态数字、成员运行态和紧凑流程动态。",
        ]}
      />
    </div>
  );
}

function InteractionTab() {
  return (
    <div>
      <SectionTitle
        title="主交互：企微/微信式平铺群聊"
        desc="聊天窗口是平等消息流，不按引用层级缩进展示。引用只作为消息气泡内的 quote preview；Assignment 不默认挂在每条消息下。"
      />
      <RoomShellPreview />
      <Divider label="交互规则" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <h3 style={{ color: C.text, fontSize: 14, marginTop: 0 }}>引用与 @</h3>
          <SpecList
            items={[
              "引用只能选一条消息；输入框展示 quote preview，发送后写 room_message.quote_message_id。",
              "@ 可同时选择多个对象；发送后写 room_message_mention，多 Agent 会生成多条 Assignment。",
              "Agent 输出消息必须 quote 本次 invocation.source_message_id，不能再统一 quote 用户根消息。",
            ]}
          />
        </Card>
        <Card>
          <h3 style={{ color: C.text, fontSize: 14, marginTop: 0 }}>自动推进</h3>
          <SpecList
            items={[
              "用户消息无 @：立即创建群管 auto_review Assignment；聊天区只在顶部轻量 AttentionStrip 或右侧状态中提示，不在消息下展开链路。",
              "Agent 输出无 @：以该输出消息为 source 创建群管 auto_review，不再回到用户原始消息 anchor。",
              "群管 assign 后：右侧成员状态与紧凑流程动态更新；聊天区不插入 route_hint，也不展开 Assignment chips。",
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function FlowTab() {
  return (
    <div>
      <SectionTitle
        title="右侧协作状态与流程动态"
        desc="右侧面板解释当前消息流转，但不抢占聊天空间。状态统计只用数字；成员列表展示运行态；流程动态用紧凑时间线解释最近 Assignment。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "310px 1fr", gap: 18 }}>
        <Card>
          <WorkboardPanel />
        </Card>
        <div>
          <Card style={{ marginBottom: 14 }}>
            <h3 style={{ color: C.text, marginTop: 0, fontSize: 14 }}>Assignment 展开策略</h3>
            <SpecList
              items={[
                "默认不在聊天消息下展示 Assignment 列表；只在右侧流程动态和成员状态里体现。",
                "点击流程动态节点或成员状态时，抽屉/Popover 展示 Assignment reason、source message、output message 和 invocation attempts。",
                "失败时在右侧异常计数和相关节点上提示；聊天区仅在需要用户处理时出现轻量横幅。",
                "并行时右侧成员状态同时显示多个 running/queued；流程动态中用同级节点表达，不占用聊天区。",
                "等待汇合时显示 Join 节点，例如“等待 2/2 完成后触发 AgentA”；不要求 B/C 在聊天里分别 @ 回 AgentA。",
              ]}
            />
          </Card>
          <Card>
            <h3 style={{ color: C.text, marginTop: 0, fontSize: 14 }}>状态可见性</h3>
            <SpecList
              items={[
                "任何停顿必须在右侧可见：待群管判断、待 Agent 执行、等待人工确认、失败等待处理。",
                "daemon no task to claim 不应出现在 UI；UI 只看 Assignment 是否还有 pending/running/failed。",
                "群管 JSON 解析失败：auto_review Assignment = failed，右侧异常计数 + 流程节点提供重试；聊天区不刷系统墙。",
                "群管 complete：右侧显示“任务已完成”，聊天区可选一条极简系统分隔提示，不再继续创建 auto_review。",
              ]}
            />
          </Card>
          <Card style={{ marginTop: 14 }}>
            <h3 style={{ color: C.text, marginTop: 0, fontSize: 14 }}>Join 后端实现约束</h3>
            <SpecList
              items={[
                "Join 不是独立页面，也不是聊天消息；它只是流程动态中的一种 Assignment 节点。",
                "被阻塞的 assignment 初始 status=blocked，不创建 invocation；依赖全部 completed 后，在同一事务中改为 pending/running 并创建 invocation。",
                "依赖满足检测必须在 assignment completion 事务内完成，使用行锁或唯一约束避免并发完成时重复触发 AgentA。",
                "Join 节点的进度由 AssignmentDependency 派生，例如 completed_count/total_count；前端不自行扫描聊天文本判断。",
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function APIContractTab() {
  const rows = [
    ["GET /rooms/:id/graph", "RoomGraphSnapshot", "messages / mentions / assignments / invocations / decisions / invocation_events 一次返回"],
    ["POST /rooms/:id/messages", "发送消息", "body: content, quote_message_id；返回 message + created assignments"],
    ["POST /rooms/:id/assignments", "手动指派", "source_message_id + assignee；用于“指派给…”和“让群管判断”"],
    ["POST /rooms/:id/assignments/:id/retry", "重试", "创建新的 invocation attempt；不修改历史 invocation"],
    ["room:message_created", "新增消息", "append message，并处理 quote/mention 展示"],
    ["room:assignment_updated", "指派状态变化", "patch assignment；右侧统计、成员状态与流程动态同步变化"],
    ["room:assignment_dependency_updated", "依赖满足度变化", "patch 流程动态中的 join 节点完成度；满足后自动触发 blocked assignment"],
    ["room:invocation_event_created", "运行事件", "append event；只影响展开细节和流程动态"],
    ["room:manager_decision_created", "群管决策", "显示 decision reason，并链接 created_assignment_ids"],
  ];
  return (
    <div>
      <SectionTitle
        title="前端 API 与实时契约"
        desc="前端不再请求 invocations + messages 后自行猜流程，而是消费 RoomGraphSnapshot。API 响应必须按 schema parse，不允许裸 cast。"
      />
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "220px 170px 1fr", gap: "10px 14px", fontSize: 12 }}>
          <div style={{ color: C.text, fontWeight: 700 }}>接口 / 事件</div>
          <div style={{ color: C.text, fontWeight: 700 }}>对象</div>
          <div style={{ color: C.text, fontWeight: 700 }}>前端更新</div>
          {rows.map(([api, obj, update]) => (
            <div key={api} style={{ display: "contents" }}>
              <div style={{ color: C.primaryLight, fontFamily: "monospace" }}>{api}</div>
              <div style={{ color: C.textMuted }}>{obj}</div>
              <div style={{ color: C.textDim, lineHeight: 1.6 }}>{update}</div>
            </div>
          ))}
        </div>
      </Card>
      <Divider label="前端模块删除与替换" />
      <SpecList
        items={[
          "删除/重写 room-flow-utils 中以 step_id、message_id anchor 聚合流程的投影逻辑；改为 assignment + invocation_event。",
          "删除 room-route-hint、room-invocation-reply-slot 中旧 attribution 猜测逻辑；改读 assignment.kind / created_by。",
          "重写 room-workboard-panel：显示状态数字、成员运行态与紧凑流程动态，不再大面积展示 completed assignment 列表。",
          "RoomMessageList 改为企微/微信式平铺时间线；保留 quote preview，但禁止引用层级缩进树。",
          "RoomComposer 保留单 quote；增强多 @ chips 和“让群管判断当前引用消息”快捷动作。",
          "新增 AssignmentDependency 展示与实时更新：右侧 join 节点显示完成度，满足后 patch 为 running/completed。",
        ]}
      />
      <Divider label="Join 后端事务契约" />
      <SpecList
        items={[
          "新增 room_assignment_dependency：assignment_id 为被阻塞的后续 assignment，depends_on_assignment_id 为前置 assignment。",
          "blocked assignment 不入队、不创建 invocation；只有依赖全部 completed 后才 materialize invocation。",
          "CompleteAssignment 事务内检查依赖：锁定受影响的 blocked assignments，确认 all_completed，再原子更新 status 并创建 invocation。",
          "幂等约束：同一 assignment 同时只能有一个 active invocation；dependency 满足检测重复执行不能重复派发。",
          "如果任一依赖 failed/cancelled，join assignment 进入 failed 或等待群管 reassign，具体由 manager decision 决定。",
        ]}
      />
    </div>
  );
}

function ExceptionTab() {
  const cases = [
    ["群管决策失败", "auto_review assignment failed", "右侧异常节点 + 重试群管判断；聊天区不刷系统失败墙"],
    ["Agent 执行失败", "assignment failed + invocation failed", "右侧显示失败原因；提供重试、重新指派、让群管分析"],
    ["Agent 超时", "invocation timed_out", "如果 task 仍活跃显示“超时但仍在执行”；否则转 timeout_review"],
    ["人工审批", "assignment kind=approval", "仅需要用户操作时在聊天顶部/Composer 附近出现轻量卡片；同意/拒绝后更新 Assignment"],
    ["任务完成", "manager decision action=complete", "右侧显示完成决策，停止自动群管 review"],
    ["多 Agent 并行", "同 source 多 assignment", "右侧成员状态并行更新；流程动态同级分叉"],
    ["等待多个确认", "assignment dependency / join", "B/C 回复后不 @ 回 A；Join 统计依赖完成度，满足后自动触发 A"],
  ];
  return (
    <div>
      <SectionTitle title="异常与收尾交互" desc="所有异常都必须落到 Assignment 状态，不能通过散文系统消息或日志让用户猜。" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {cases.map(([title, state, ui]) => (
          <Card key={title}>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
            <div style={{ color: C.primaryLight, fontFamily: "monospace", fontSize: 11, marginBottom: 8 }}>{state}</div>
            <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.7 }}>{ui}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AcceptanceTab() {
  return (
    <div>
      <SectionTitle title="前端验收清单" desc="不保留旧 UI 兼容路径；每项都应能从实际界面或测试中验证。" />
      <SpecList
        items={[
          "聊天主流默认平铺展示消息；引用只以 quote preview 形式显示，禁止按引用深度缩进嵌套。",
          "消息下方不默认展示 AssignmentBlock；仅 active/failed 且需要用户感知时允许顶部轻量 AttentionStrip。",
          "多 @ 发送后，聊天区只显示原消息和 @ 文本；并行状态在右侧成员运行态和流程动态体现。",
          "需要多个 Agent 确认后再继续时，创建 blocked/join Assignment 及 dependency；禁止依赖 B/C 分别 @ 回发起 Agent 来闭环。",
          "右侧协作状态只显示待处理/运行中/异常/完成数字，不渲染大块分组列表。",
          "流程动态以 Assignment 为主线，点击节点展开 Invocation attempts；不占用聊天主流空间。",
          "群管 decision reason 可从流程节点/详情抽屉查看；聊天区不插入 route_hint/relay_hint。",
          "失败、超时、解析失败都落在右侧异常状态和流程节点，并提供可执行的下一步按钮。",
          "删除 Topic/Delivery/ControlStep 相关文案、API、组件入口和验收项。",
          "前端所有 Room API 响应使用 zod schema + parseWithFallback；字段按新模型命名。",
          "web/desktop 共用 packages/views/room 实现，不新增平台重复 UI。",
        ]}
      />
    </div>
  );
}

function ConstitutionTab() {
  return (
    <div>
      <SectionTitle
        title="设计宪法"
        desc="这些规则用于裁决实现争议。任何旧实现与这些规则冲突时，删除旧实现，不做兼容层。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SpecList
          items={[
            "Message 是内容事实，不是运行时状态容器。",
            "引用只能一个，@ 可以多个；二者分别建模，不互相替代。",
            "Assignment 是协作指派的事实源；聊天区默认不直接展开 Assignment 链。",
            "等待多个并行结果时用 AssignmentDependency / join 表达，不用重复 @ 回流表达。",
            "Invocation 是执行尝试；失败重试创建新 attempt，不覆盖历史。",
            "群管路由必须写 ManagerDecision + Assignment，不允许只写日志或散文消息。",
          ]}
        />
        <SpecList
          items={[
            "自动推进基于“新 Message 是否有下一跳 Assignment”，不基于历史 invocation anchor。",
            "流程动态是解释层，不是事实源；任何投影都可从 graph snapshot 重建。",
            "没有下一步时必须在右侧可见：完成、等待、失败、跳过四者之一。",
            "Topic/Delivery/ControlStep 不是本阶段 UI 概念；相关入口全部删除。",
            "不兼容旧数据；清库后按新模型实现。",
          ]}
        />
      </div>
    </div>
  );
}

const TABS = [
  { id: "constitution", label: "设计宪法" },
  { id: "model", label: "模型职责" },
  { id: "interaction", label: "主界面交互" },
  { id: "flow", label: "Workboard/流程" },
  { id: "api", label: "API/实时契约" },
  { id: "exceptions", label: "异常与收尾" },
  { id: "acceptance", label: "验收清单" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function RoomDesignSpec() {
  const [tab, setTab] = useState<TabId>("constitution");
  return (
    <div style={{ ...cn, minHeight: "100vh", background: C.bg, color: C.text, padding: 24 }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <header style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, color: C.text, fontSize: 24, letterSpacing: "-0.02em" }}>
                协作群 Room UI 设计规范
              </h1>
              <p style={{ margin: "8px 0 0", color: C.textMuted, fontSize: 13, lineHeight: 1.7, maxWidth: 780 }}>
                基于 Message / Mention / Assignment / Invocation / ManagerDecision / InvocationEvent 的完整重构版。
                删除旧 Topic、Delivery、ControlStep、step_id 合并和全链 message_id anchor 交互。
              </p>
            </div>
            <Badge tone="manager">New Graph Model</Badge>
          </div>
        </header>

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                border: `1px solid ${tab === t.id ? C.primary : C.border}`,
                background: tab === t.id ? C.primaryBg : C.surface,
                color: tab === t.id ? C.primaryLight : C.textMuted,
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div>
          {tab === "constitution" ? <ConstitutionTab /> : null}
          {tab === "model" ? <ModelTab /> : null}
          {tab === "interaction" ? <InteractionTab /> : null}
          {tab === "flow" ? <FlowTab /> : null}
          {tab === "api" ? <APIContractTab /> : null}
          {tab === "exceptions" ? <ExceptionTab /> : null}
          {tab === "acceptance" ? <AcceptanceTab /> : null}
        </div>
      </div>
    </div>
  );
}
