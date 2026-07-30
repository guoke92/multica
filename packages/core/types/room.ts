export type RoomSnapshot = {
  pending_count?: number;
  blocked_count?: number;
  queued_count?: number;
  running_count?: number;
  failed_count?: number;
  completed_count?: number;
  active_invocation_count?: number;
  manager_active_count?: number;
  unread_message_count?: number;
  mention_unread_count?: number;
  last_message_preview?: string;
  last_message_at?: string;
  latest_event_id?: string;
  /** Legacy snapshot field — may still appear on older server builds. */
  timed_out_count?: number;
};

export type RoomPolicy = {
  workflow_template?: string;
  manager_custom_prompt?: string;
  role_bindings?: Record<string, string>;
  routing?: {
    unmentioned?: string;
    explicit_agent_mention?: string;
    manager_agent_must_be_member?: boolean;
  };
  fallback?: {
    role_task_max_retries?: number;
    on_role_failure?: string;
    on_ambiguous_intake?: string;
  };
};

export type Room = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  type: string;
  manager_agent_id?: string;
  policy?: RoomPolicy;
  snapshot: RoomSnapshot;
  created_at: string;
  updated_at: string;
};

export type RoomInvocationEvent = {
  id: string;
  room_id: string;
  assignment_id: string;
  invocation_id?: string;
  type: string;
  actor_type: string;
  actor_id?: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RoomMessage = {
  id: string;
  sender_type: string;
  sender_id?: string;
  content: string;
  quote_message_id?: string;
  message_kind?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  edited_at?: string;
};

export type RoomMessageMention = {
  id: string;
  message_id: string;
  target_type: string;
  target_id: string;
  source_type?: "manual" | "agent_mention" | "manager_dispatch";
  source_message_id?: string;
  assignment_id?: string;
  label?: string;
  span_start?: number;
  span_end?: number;
  created_at?: string;
};

export type RoomAssignment = {
  id: string;
  room_id: string;
  source_message_id: string;
  assignee_type: string;
  assignee_id: string;
  kind: string;
  status: string;
  reason?: string;
  output_message_id?: string;
  created_by_type?: string;
  created_by_id?: string;
  created_at?: string;
  updated_at?: string;
  failure_acknowledged_at?: string;
  failure_acknowledged_by?: string;
  superseded_by_assignment_id?: string;
};

export type RoomAssignmentDependency = {
  id: string;
  assignment_id: string;
  depends_on_assignment_id: string;
  created_at?: string;
};

export type ManagerInvocationOutcome =
  | { type: "dispatch"; target_agent_id: string; reason?: string }
  | { type: "relay"; target_agent_id: string; reason?: string }
  | { type: "reassign"; target_agent_id: string; reason?: string }
  | { type: "review_complete"; conclusion?: string }
  | { type: "ask_user"; conclusion?: string }
  | { type: "wait"; conclusion?: string }
  | { type: "skip" }
  | { type: "retry"; target_assignment_id?: string }
  | { type: "failed"; reason?: string }
  | { type: "cancelled" };

export type RoleInvocationOutcome = {
  type: "text_output";
  message_id: string;
};

export type RoomInvocationOutcome = ManagerInvocationOutcome | RoleInvocationOutcome;

export type RoomInvocation = {
  id: string;
  room_id?: string;
  assignment_id: string;
  source_message_id: string;
  agent_id: string;
  intent?: string;
  status: string;
  priority?: string;
  retry_count?: number;
  max_retries?: number;
  task_id?: string;
  output_message_id?: string;
  outcome?: RoomInvocationOutcome;
  failure_reason?: string;
  timeout_at?: string;
  started_at?: string;
  completed_at?: string;
  cancelled_by?: string;
  cancelled_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type RoomManagerDecision = {
  id: string;
  room_id: string;
  source_message_id: string;
  invocation_id?: string;
  action: string;
  payload?: Record<string, unknown>;
  created_assignment_ids?: string[];
  created_by_type?: string;
  created_by_id?: string;
  created_at?: string;
};

export type RoomHumanInteractionOption = {
  id: string;
  label: string;
};

export type RoomHumanInteraction = {
  id: string;
  room_id: string;
  kind: "notify" | "ask" | "confirm" | "approve";
  status: "pending" | "responded" | "dismissed" | "expired";
  title?: string;
  body: string;
  options?: RoomHumanInteractionOption[];
  allow_custom_response?: boolean;
  invocation_id?: string;
  assignment_id?: string;
  decision_id?: string;
  approval_request_id?: string;
  created_by_type: string;
  created_by_id?: string;
  response_text?: string;
  response_option_id?: string;
  responded_by?: string;
  responded_at?: string;
  dismissed_at?: string;
  created_at: string;
  updated_at: string;
};

/** Orchestration snapshot — messages live in the messages infinite query. */
export type RoomGraphSnapshot = {
  mentions: RoomMessageMention[];
  assignments: RoomAssignment[];
  assignment_dependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  decisions: RoomManagerDecision[];
  invocation_events: RoomInvocationEvent[];
  human_interactions?: RoomHumanInteraction[];
};

export type RoomMember = {
  principal_type: string;
  principal_id: string;
  role: string;
};

export type SendRoomMessageResponse = {
  message: RoomMessage;
  mentions?: RoomMessageMention[];
  assignments?: RoomAssignment[];
  invocations?: RoomInvocation[];
};

export type UpdateRoomMessageResponse = {
  message: RoomMessage;
  assignments?: RoomAssignment[];
  invocations?: RoomInvocation[];
};

export type RespondRoomHumanInteractionResponse = {
  interaction: RoomHumanInteraction;
  message?: RoomMessage;
  assignments?: RoomAssignment[];
  invocations?: RoomInvocation[];
};
