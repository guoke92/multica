package service

import (
	"encoding/json"
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const roomContextRecentLimit = 50

// RoomContextEntry is one message in the room conversation context.
type RoomContextEntry struct {
	MessageID      string `json:"message_id"`
	SenderType     string `json:"sender_type"`
	SenderID       string `json:"sender_id,omitempty"`
	QuoteMessageID string `json:"quote_message_id,omitempty"`
	Summary        string `json:"summary"`
	Source         string `json:"source"`
}

// RoomPromptContext is the structured conversation context for room agent prompts.
type RoomPromptContext struct {
	TriggerMessageID string             `json:"trigger_message_id"`
	ManagerBrief     string             `json:"manager_brief,omitempty"`
	ManagerScene     string             `json:"manager_scene,omitempty"`
	AssignmentKind   string             `json:"assignment_kind,omitempty"`
	HighRelevance    []RoomContextEntry `json:"high_relevance"`
	Recent           []RoomContextEntry `json:"recent"`
	CatalogIDs       []string           `json:"catalog_ids,omitempty"`
}

// Render formats the context pack as prompt text.
func (p RoomPromptContext) Render(roomID string) string {
	var b strings.Builder
	if p.ManagerBrief != "" {
		b.WriteString("## 群管指派说明\n")
		b.WriteString(p.ManagerBrief)
		b.WriteString("\n\n")
	}
	if len(p.HighRelevance) > 0 {
		b.WriteString("## 高相关对话\n")
		for _, e := range p.HighRelevance {
			writeContextEntry(&b, e)
		}
		b.WriteString("\n")
	}
	if len(p.Recent) > 0 {
		b.WriteString("## 最近对话\n")
		for _, e := range p.Recent {
			writeContextEntry(&b, e)
		}
		b.WriteString("\n")
	}
	if len(p.CatalogIDs) > 0 {
		b.WriteString("## 更多消息 ID\n")
		b.WriteString(strings.Join(p.CatalogIDs, ", "))
		b.WriteString("\n\n")
	}
	if roomID != "" {
		fmt.Fprintf(&b, "如需完整内容：`multica room message get %s <message_id> --output json`\n", roomID)
	}
	return strings.TrimSpace(b.String())
}

func writeContextEntry(b *strings.Builder, e RoomContextEntry) {
	fmt.Fprintf(b, "- [message_id=%s]", e.MessageID)
	if e.SenderType != "" {
		fmt.Fprintf(b, " [%s]", e.SenderType)
	}
	if e.QuoteMessageID != "" {
		fmt.Fprintf(b, " [quote=%s]", e.QuoteMessageID)
	}
	fmt.Fprintf(b, " %s\n", e.Summary)
}

func messageSummary(m db.RoomMessage) string {
	s := strings.TrimSpace(m.Content)
	if s != "" {
		return s
	}
	if len(m.Metadata) > 0 {
		var meta map[string]any
		if json.Unmarshal(m.Metadata, &meta) == nil {
			if detailed, ok := meta["detailed_explanation"].(string); ok {
				return truncateForSummary(detailed, roomMessageSummaryMaxLen)
			}
		}
	}
	return ""
}

func entryFromMessage(m db.RoomMessage, source string) RoomContextEntry {
	e := RoomContextEntry{
		MessageID:  util.UUIDToString(m.ID),
		SenderType: m.SenderType,
		Summary:    messageSummary(m),
		Source:     source,
	}
	if m.SenderID.Valid {
		e.SenderID = util.UUIDToString(m.SenderID)
	}
	if m.QuoteMessageID.Valid {
		e.QuoteMessageID = util.UUIDToString(m.QuoteMessageID)
	}
	return e
}

func resolveManagerScene(assignment db.RoomAssignment, intent string) string {
	if assignment.Kind == "auto_review" {
		if _, ok := parseAssignmentEscalationReason(assignment.Reason); ok {
			return "escalate"
		}
		switch intent {
		case "route", "review", "confirm", "escalate":
			return intent
		}
	}
	return ""
}

// BuildRoomPromptContext assembles prioritized conversation context for a room invocation.
func (s *TaskService) BuildRoomPromptContext(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	triggerMsg db.RoomMessage,
	intent string,
) (RoomPromptContext, error) {
	pack := RoomPromptContext{
		TriggerMessageID: util.UUIDToString(triggerMsg.ID),
		AssignmentKind:   assignment.Kind,
	}
	if assignment.Reason.Valid && strings.TrimSpace(assignment.Reason.String) != "" {
		pack.ManagerBrief = formatManagerBrief(assignment, room)
	}
	if scene := resolveManagerScene(assignment, intent); scene != "" {
		pack.ManagerScene = scene
	}

	msgs, err := s.Queries.ListRoomMessages(ctx, db.ListRoomMessagesParams{
		RoomID: room.ID,
		Limit:  roomContextRecentLimit,
	})
	if err != nil {
		return pack, err
	}
	byID := make(map[string]db.RoomMessage, len(msgs))
	for _, m := range msgs {
		byID[util.UUIDToString(m.ID)] = m
	}

	seen := make(map[string]struct{})
	var high []RoomContextEntry
	addHigh := func(m db.RoomMessage, source string) {
		id := util.UUIDToString(m.ID)
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		high = append(high, entryFromMessage(m, source))
	}

	triggerID := util.UUIDToString(triggerMsg.ID)
	addHigh(triggerMsg, "trigger")

	if triggerMsg.QuoteMessageID.Valid {
		if quoted, ok := byID[util.UUIDToString(triggerMsg.QuoteMessageID)]; ok {
			addHigh(quoted, "direct_quote")
		}
	}

	for cur := triggerMsg; cur.QuoteMessageID.Valid; {
		parent, ok := byID[util.UUIDToString(cur.QuoteMessageID)]
		if !ok {
			break
		}
		src := "quote_ancestor"
		if parent.SenderType == "user" {
			src = "user_root"
		}

		addHigh(parent, src)
		cur = parent
	}

	userRoot := findUserRootMessage(triggerMsg, byID)
	if userRoot.ID.Valid {
		addHigh(userRoot, "user_root")
	}

	sortHighRelevance(high, triggerID)

	var recent []RoomContextEntry
	var catalog []string
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		id := util.UUIDToString(m.ID)
		if _, ok := seen[id]; ok {
			continue
		}
		if len(recent) < 8 {
			recent = append(recent, entryFromMessage(m, "recent"))
			seen[id] = struct{}{}
		} else {
			catalog = append(catalog, id)
		}
	}
	sort.Slice(recent, func(i, j int) bool {
		return recent[i].MessageID < recent[j].MessageID
	})

	pack.HighRelevance = high
	pack.Recent = recent
	pack.CatalogIDs = catalog
	return pack, nil
}

func findUserRootMessage(start db.RoomMessage, byID map[string]db.RoomMessage) db.RoomMessage {
	cur := start
	for {
		if cur.SenderType == "user" {
			return cur
		}
		if !cur.QuoteMessageID.Valid {
			break
		}
		parent, ok := byID[util.UUIDToString(cur.QuoteMessageID)]
		if !ok {
			break
		}
		cur = parent
	}
	return db.RoomMessage{}
}

func sortHighRelevance(entries []RoomContextEntry, triggerID string) {
	priority := func(e RoomContextEntry) int {
		switch e.Source {
		case "trigger":
			return 0
		case "direct_quote":
			return 1
		case "manager_dispatch":
			return 2
		case "user_root":
			return 3
		case "quote_ancestor":
			if e.SenderType == "user" {
				return 4
			}
			return 6
		default:
			return 7
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		pi, pj := priority(entries[i]), priority(entries[j])
		if pi != pj {
			return pi < pj
		}
		if entries[i].MessageID == triggerID {
			return true
		}
		if entries[j].MessageID == triggerID {
			return false
		}
		return entries[i].MessageID < entries[j].MessageID
	})
}

func formatManagerBrief(assignment db.RoomAssignment, room db.Room) string {
	reason := strings.TrimSpace(assignment.Reason.String)
	if reason == "" {
		return ""
	}
	switch assignment.Kind {
	case "manager_route":
		return fmt.Sprintf("群管路由：%s", reason)
	case "manager_relay":
		return fmt.Sprintf("群管接力：%s", reason)
	case "reassign":
		return fmt.Sprintf("群管改派：%s", reason)
	default:
		if _, ok := parseAssignmentEscalationReason(assignment.Reason); ok {
			return fmt.Sprintf("升级处理：%s", reason)
		}
		_ = room
		return reason
	}
}

// BuildRoomInvocationAssembledPrompt renders the server-side prompt bundle for debugging.
func (s *TaskService) BuildRoomInvocationAssembledPrompt(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	sourceMessage db.RoomMessage,
	inv db.RoomInvocation,
) string {
	var b strings.Builder
	intent := inv.Intent
	scene := resolveManagerScene(assignment, intent)

	if room.ManagerAgentID.Valid &&
		assignment.AssigneeID.Valid &&
		assignment.AssigneeID.Bytes == room.ManagerAgentID.Bytes {
		policy := ParseRoomPolicy(room.Policy)
		b.WriteString(MergeManagerAgentInstructions(policy.ManagerCustomPrompt))
		b.WriteString("\n\n")
		fmt.Fprintf(&b, "## Mode: %s (intent=%s, kind=%s)\n\n", scene, intent, assignment.Kind)
	} else if brief := formatManagerBrief(assignment, room); brief != "" {
		fmt.Fprintf(&b, "## Assignment brief\n\n%s\n\n", brief)
	}

	rendered, _, err := s.RenderRoomPromptContext(ctx, room, assignment, sourceMessage, intent)
	if err == nil && strings.TrimSpace(rendered) != "" {
		b.WriteString(rendered)
		b.WriteString("\n\n")
	}

	fmt.Fprintf(&b, "## Trigger message\n\n%s\n", sourceMessage.Content)
	return strings.TrimSpace(b.String())
}

// RenderRoomPromptContext builds and renders conversation context for daemon prompts.
func (s *TaskService) RenderRoomPromptContext(
	ctx context.Context,
	room db.Room,
	assignment db.RoomAssignment,
	triggerMsg db.RoomMessage,
	intent string,
) (string, RoomPromptContext, error) {
	pack, err := s.BuildRoomPromptContext(ctx, room, assignment, triggerMsg, intent)
	if err != nil {
		return "", pack, err
	}
	return pack.Render(util.UUIDToString(room.ID)), pack, nil
}

// CountAgentHopsSinceUserRoot counts agent messages walking quote parents from start.
func CountAgentHopsSinceUserRoot(start db.RoomMessage, byID map[string]db.RoomMessage) int {
	count := 0
	cur := start
	visited := make(map[string]struct{})
	for {
		id := util.UUIDToString(cur.ID)
		if _, ok := visited[id]; ok {
			break
		}
		visited[id] = struct{}{}
		if cur.SenderType == "agent" {
			count++
		}
		if cur.SenderType == "user" {
			break
		}
		if !cur.QuoteMessageID.Valid {
			break
		}
		parent, ok := byID[util.UUIDToString(cur.QuoteMessageID)]
		if !ok {
			break
		}
		cur = parent
	}
	return count
}
