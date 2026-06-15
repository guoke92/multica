package service

import (
	_ "embed"
	"encoding/json"
)

//go:embed room_workflow_templates.json
var roomWorkflowTemplatesJSON []byte

type WorkflowPhaseDef struct {
	Key      string   `json:"key"`
	Title    string   `json:"title"`
	RoleKey  string   `json:"role_key,omitempty"`
	RoleKeys []string `json:"role_keys,omitempty"`
	Parallel bool     `json:"parallel"`
}

type WorkflowTemplateDef struct {
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Phases      []WorkflowPhaseDef `json:"phases"`
	RoleKeys    []string           `json:"role_keys"`
}

func LoadWorkflowTemplates() (map[string]WorkflowTemplateDef, error) {
	var m map[string]WorkflowTemplateDef
	if err := json.Unmarshal(roomWorkflowTemplatesJSON, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func GetWorkflowTemplate(key string) (WorkflowTemplateDef, bool) {
	m, err := LoadWorkflowTemplates()
	if err != nil {
		return WorkflowTemplateDef{}, false
	}
	t, ok := m[key]
	return t, ok
}
