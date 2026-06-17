package service

import (
	"encoding/json"
	"fmt"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// RoomPolicy is the V1 room.policy JSON contract.
type RoomPolicy struct {
	WorkflowTemplate    string            `json:"workflow_template"`
	ManagerCustomPrompt string            `json:"manager_custom_prompt,omitempty"`
	RoleBindings        map[string]string `json:"role_bindings"`
	Routing             RoomPolicyRouting `json:"routing"`
	Fallback            RoomPolicyFallback `json:"fallback"`
	// MaxChainDepth caps agent-to-agent chain length (default 5).
	MaxChainDepth int `json:"max_chain_depth"`
}

type RoomPolicyRouting struct {
	Unmentioned              string `json:"unmentioned"`
	ExplicitAgentMention     string `json:"explicit_agent_mention"`
	ManagerAgentMustBeMember bool   `json:"manager_agent_must_be_member"`
	// OnAgentComplete controls post-completion behaviour:
	//   "manager_review" — route back to manager for evaluation
	//   "agent_relay"    — let the completing agent relay to next
	//   "auto"           — system decides (default)
	OnAgentComplete string `json:"on_agent_complete"`
	// OnChainDepthLimit controls behaviour when max chain depth is reached:
	//   "pause"            — pause and wait for user input (default)
	//   "escalate_manager" — notify manager agent
	OnChainDepthLimit string `json:"on_chain_depth_limit"`
}

type RoomPolicyFallback struct {
	RoleTaskMaxRetries int    `json:"role_task_max_retries"`
	OnRoleFailure      string `json:"on_role_failure"`
	OnAmbiguousIntake  string `json:"on_ambiguous_intake"`
}

func DefaultRoomPolicy(template string) RoomPolicy {
	return RoomPolicy{
		WorkflowTemplate: template,
		RoleBindings:     map[string]string{},
		MaxChainDepth:    5,
		Routing: RoomPolicyRouting{
			Unmentioned:              "manager",
			ExplicitAgentMention:     "direct",
			ManagerAgentMustBeMember: false,
			OnAgentComplete:          "auto",
			OnChainDepthLimit:        "pause",
		},
		Fallback: RoomPolicyFallback{
			RoleTaskMaxRetries: 1,
			OnRoleFailure:      "manager_replan",
			OnAmbiguousIntake:  "manager_ask_user",
		},
	}
}

func ParseRoomPolicy(raw []byte) RoomPolicy {
	if len(raw) == 0 {
		return DefaultRoomPolicy("")
	}
	var p RoomPolicy
	if err := json.Unmarshal(raw, &p); err != nil {
		return DefaultRoomPolicy("")
	}
	if p.RoleBindings == nil {
		p.RoleBindings = map[string]string{}
	}
	if p.Routing.Unmentioned == "" {
		p.Routing.Unmentioned = "manager"
	}
	if p.Routing.ExplicitAgentMention == "" {
		p.Routing.ExplicitAgentMention = "direct"
	}
	if p.Fallback.OnRoleFailure == "" {
		p.Fallback.OnRoleFailure = "manager_replan"
	}
	if p.Fallback.OnAmbiguousIntake == "" {
		p.Fallback.OnAmbiguousIntake = "manager_ask_user"
	}
	if p.MaxChainDepth <= 0 {
		p.MaxChainDepth = 5
	}
	if p.Routing.OnAgentComplete == "" {
		p.Routing.OnAgentComplete = "auto"
	}
	if p.Routing.OnChainDepthLimit == "" {
		p.Routing.OnChainDepthLimit = "pause"
	}
	if p.Fallback.RoleTaskMaxRetries == 0 {
		p.Fallback.RoleTaskMaxRetries = 1
	}
	return p
}

// RoomMaxChainDepth returns the configured agent-to-agent chain cap for a room.
func RoomMaxChainDepth(room db.Room) int {
	d := ParseRoomPolicy(room.Policy).MaxChainDepth
	if d <= 0 {
		return 5
	}
	return d
}

func MarshalRoomPolicy(p RoomPolicy) ([]byte, error) {
	return json.Marshal(p)
}

func (p RoomPolicy) ResolveRoleAgentID(roleKey string) (string, bool) {
	id, ok := p.RoleBindings[roleKey]
	return id, ok && id != ""
}

func ValidateRoomPolicyAgents(p RoomPolicy, memberAgentIDs map[string]struct{}) error {
	for role, agentID := range p.RoleBindings {
		if agentID == "" {
			continue
		}
		if _, ok := memberAgentIDs[agentID]; !ok {
			return fmt.Errorf("role %q agent %q is not a room member", role, agentID)
		}
	}
	return nil
}
