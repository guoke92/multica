package service

import "encoding/json"

// ManagerInvocationOutcomeType is the canonical display contract for a manager invocation.
type ManagerInvocationOutcomeType string

const (
	ManagerOutcomeDispatch      ManagerInvocationOutcomeType = "dispatch"
	ManagerOutcomeRelay         ManagerInvocationOutcomeType = "relay"
	ManagerOutcomeReassign      ManagerInvocationOutcomeType = "reassign"
	ManagerOutcomeReviewComplete ManagerInvocationOutcomeType = "review_complete"
	ManagerOutcomeAskUser       ManagerInvocationOutcomeType = "ask_user"
	ManagerOutcomeWait          ManagerInvocationOutcomeType = "wait"
	ManagerOutcomeSkip          ManagerInvocationOutcomeType = "skip"
	ManagerOutcomeRetry         ManagerInvocationOutcomeType = "retry"
	ManagerOutcomeFailed        ManagerInvocationOutcomeType = "failed"
	ManagerOutcomeCancelled     ManagerInvocationOutcomeType = "cancelled"
)

// RoleInvocationOutcomeType is the canonical display contract for a role-agent invocation.
type RoleInvocationOutcomeType string

const RoleOutcomeTextOutput RoleInvocationOutcomeType = "text_output"

// RoomInvocationOutcome is the structured display result of any room invocation.
// Role agents use type="text_output"; manager agents use the manager enum.
type RoomInvocationOutcome struct {
	Type               string `json:"type"`
	TargetAgentID      string `json:"target_agent_id,omitempty"`
	TargetAssignmentID string `json:"target_assignment_id,omitempty"`
	Reason             string `json:"reason,omitempty"`
	Conclusion         string `json:"conclusion,omitempty"`
	MessageID          string `json:"message_id,omitempty"`
}

func (o RoomInvocationOutcome) MarshalJSON() ([]byte, error) {
	type raw RoomInvocationOutcome
	return json.Marshal(raw(o))
}

func managerOutcome(t ManagerInvocationOutcomeType, targetAgentID, reason, conclusion string) RoomInvocationOutcome {
	return RoomInvocationOutcome{
		Type:          string(t),
		TargetAgentID: targetAgentID,
		Reason:        reason,
		Conclusion:    conclusion,
	}
}

func roleOutcome(messageID string) RoomInvocationOutcome {
	return RoomInvocationOutcome{Type: string(RoleOutcomeTextOutput), MessageID: messageID}
}

func failedOutcome(reason string) RoomInvocationOutcome {
	return RoomInvocationOutcome{Type: string(ManagerOutcomeFailed), Reason: reason}
}

func cancelledOutcome() RoomInvocationOutcome {
	return RoomInvocationOutcome{Type: string(ManagerOutcomeCancelled)}
}
