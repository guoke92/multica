package service

import (
	"context"
	"sort"
	"strings"

	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type roomAgentName struct {
	id   string
	name string
}

// collectRoomMentions parses structured mention:// links plus plain @AgentName
// tokens that match agent members of the room (common in agent-authored replies).
func (s *TaskService) collectRoomMentions(
	ctx context.Context,
	room db.Room,
	content string,
) ([]util.Mention, error) {
	seen := make(map[string]bool)
	var out []util.Mention
	add := func(m util.Mention) {
		if m.Type != "agent" && m.Type != "squad" {
			return
		}
		if m.Type == "agent" && room.ManagerAgentID.Valid && m.ID == util.UUIDToString(room.ManagerAgentID) {
			return
		}
		key := m.Type + ":" + m.ID
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, m)
	}
	for _, m := range util.ParseMentions(content) {
		add(m)
	}
	plain, err := s.plainAgentMentionsInRoom(ctx, room, content)
	if err != nil {
		return out, err
	}
	for _, m := range plain {
		add(m)
	}
	return out, nil
}

func (s *TaskService) plainAgentMentionsInRoom(
	ctx context.Context,
	room db.Room,
	content string,
) ([]util.Mention, error) {
	members, err := s.Queries.ListRoomMembers(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	var agents []roomAgentName
	for _, m := range members {
		if m.PrincipalType != "agent" {
			continue
		}
		if room.ManagerAgentID.Valid && m.PrincipalID.Bytes == room.ManagerAgentID.Bytes {
			continue
		}
		agent, err := s.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID:          m.PrincipalID,
			WorkspaceID: room.WorkspaceID,
		})
		if err != nil || agent.ArchivedAt.Valid {
			continue
		}
		name := strings.TrimSpace(agent.Name)
		if name == "" {
			continue
		}
		agents = append(agents, roomAgentName{
			id:   util.UUIDToString(agent.ID),
			name: name,
		})
	}
	return resolvePlainAgentMentions(content, agents), nil
}

func resolvePlainAgentMentions(content string, agents []roomAgentName) []util.Mention {
	if strings.TrimSpace(content) == "" || len(agents) == 0 {
		return nil
	}
	// Strip structured mention links so their display text is not re-matched.
	stripped := stripStructuredMentions(content)
	sorted := append([]roomAgentName(nil), agents...)
	sort.Slice(sorted, func(i, j int) bool {
		return len(sorted[i].name) > len(sorted[j].name)
	})
	seen := make(map[string]bool)
	var out []util.Mention
	for _, ag := range sorted {
		if !strings.Contains(stripped, "@"+ag.name) {
			continue
		}
		if seen[ag.id] {
			continue
		}
		seen[ag.id] = true
		out = append(out, util.Mention{Type: "agent", ID: ag.id})
	}
	return out
}

// stripStructuredMentions removes markdown-style mention links
// ([@Name](mention://...)) so their display text is not mistaken for
// plain-text @mentions.
func stripStructuredMentions(content string) string {
	var b strings.Builder
	rest := content
	for {
		openIdx := strings.Index(rest, "[@")
		if openIdx == -1 {
			b.WriteString(rest)
			break
		}
		closeIdx := strings.Index(rest[openIdx:], ")")
		if closeIdx == -1 {
			b.WriteString(rest)
			break
		}
		link := rest[openIdx : openIdx+closeIdx+1]
		if strings.Contains(link, "](mention://") {
			b.WriteString(rest[:openIdx])
		} else {
			b.WriteString(rest[:openIdx+closeIdx+1])
		}
		rest = rest[openIdx+closeIdx+1:]
	}
	return b.String()
}
