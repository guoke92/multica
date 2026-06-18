/** @deprecated Topic product concept removed in room graph refactor. */
export type TopicSummary = {
  id: string;
  title: string;
  status: string;
  root_message_id?: string;
  last_message_id?: string;
  event_count: number;
  updated_at: string;
};

export type RoomSnapshot = {
  pending_count?: number;
  blocked_count?: number;
  queued_count?: number;
  running_count?: number;
  failed_count?: number;
  completed_count?: number;
  /** @deprecated */
  timed_out_count?: number;
  /** @deprecated */
  active_graph_id?: string;
  /** @deprecated */
  compressed_topics?: TopicSummary[];
  /** @deprecated */
  active_topic_id?: string;
  /** @deprecated */
  topic_summaries?: TopicSummary[];
  latest_event_id?: string;
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

/** @deprecated Delivery product concept removed in room graph refactor. */
export type RoomDelivery = {
  id: string;
  room_id: string;
  title: string;
  status: string;
  workflow_template: string;
  current_phase: string;
  card_message_id?: string;
  anchor_message_id?: string;
  created_at: string;
  updated_at: string;
};

/** @deprecated Topic product concept removed in room graph refactor. */
export type RoomTopic = {
  id: string;
  room_id: string;
  delivery_id?: string;
  parent_topic_id?: string;
  title: string;
  status: string;
  phase_key: string;
  assignee_agent_id?: string;
  root_message_id?: string;
  last_message_id?: string;
  event_count?: number;
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

/** @deprecated Use RoomInvocationEvent */
export type RoomFlowEvent = RoomInvocationEvent;

export type RoomHumanAction = {
  id: string;
  room_id: string;
  topic_id: string;
  message_id: string;
  invocation_id?: string;
  type: string;
  status: string;
  assignee_id?: string;
  title: string;
  reason?: string;
  expires_at?: string;
  decided_at?: string;
};

export type RoomProgressItem = {
  title: string;
  status: string;
  detail?: string;
};

export type RoomWorkboard = {
  pending_count: number;
  blocked_count?: number;
  queued_count?: number;
  running_count: number;
  failed_count?: number;
  completed_count?: number;
  /** @deprecated */
  timed_out_count?: number;
  /** @deprecated */
  active_graph_id?: string;
  /** @deprecated */
  compressed_topics?: TopicSummary[];
  /** @deprecated */
  active_topic_id?: string;
  /** @deprecated */
  topic_summaries?: TopicSummary[];
  latest_event_id?: string;
  progress_items?: RoomProgressItem[];
  /** @deprecated */
  active_delivery?: RoomDelivery;
};

export type RoomMessage = {
  id: string;
  sender_type: string;
  sender_id?: string;
  content: string;
  quote_message_id?: string;
  /** @deprecated */
  delivery_id?: string;
  /** @deprecated */
  topic_id?: string;
  message_kind?: string;
  metadata?: Record<string, unknown>;
  relay_metadata?: Record<string, unknown>;
  created_at: string;
  edited_at?: string;
};

export type RoomMessageMention = {
  id: string;
  message_id: string;
  target_type: string;
  target_id: string;
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
};

export type RoomAssignmentDependency = {
  id: string;
  assignment_id: string;
  depends_on_assignment_id: string;
  created_at?: string;
};

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

export type RoomGraphSnapshot = {
  messages: RoomMessage[];
  mentions: RoomMessageMention[];
  assignments: RoomAssignment[];
  assignment_dependencies: RoomAssignmentDependency[];
  invocations: RoomInvocation[];
  decisions: RoomManagerDecision[];
  invocation_events: RoomInvocationEvent[];
};

export type RoomMember = {
  principal_type: string;
  principal_id: string;
  role: string;
};

/** @deprecated Legacy mention-invocation list shape; prefer RoomInvocation. */
export type MentionInvocation = {
  id: string;
  message_id?: string;
  target_type: string;
  target_id: string;
  intent?: string;
  status: string;
  task_id?: string;
  response_message_id?: string;
  retry_count?: number;
  max_retries?: number;
  failure_reason?: string;
  created_at?: string;
};

export type SendRoomMessageResponse = {
  message_id: string;
  created_at: string;
  invocations?: RoomInvocation[];
};
