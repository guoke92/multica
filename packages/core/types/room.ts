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
  queued_count?: number;
  running_count?: number;
  failed_count?: number;
  timed_out_count?: number;
  active_graph_id?: string;
  compressed_topics?: TopicSummary[];
  active_topic_id?: string;
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

/** @deprecated Delivery product concept — use RoomTopic. */
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

export type RoomFlowEvent = {
  id: string;
  room_id: string;
  topic_id?: string;
  category?: "message" | "control" | "confirm" | "phase" | "meta" | string;
  step_id?: string;
  from_message_id?: string;
  to_message_id?: string;
  type: string;
  message_id?: string;
  invocation_id?: string;
  actor_type: string;
  actor_id?: string;
  payload: Record<string, unknown>;
  created_at: string;
};

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
  queued_count?: number;
  running_count: number;
  failed_count?: number;
  timed_out_count?: number;
  active_graph_id?: string;
  compressed_topics?: TopicSummary[];
  active_topic_id?: string;
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
  delivery_id?: string;
  topic_id?: string;
  message_kind?: string;
  metadata?: Record<string, unknown>;
  relay_metadata?: Record<string, unknown>;
  created_at: string;
  edited_at?: string;
};

export type RoomMember = {
  principal_type: string;
  principal_id: string;
  role: string;
};

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
  invocations?: MentionInvocation[];
};
