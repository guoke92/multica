package service

import (
	"strings"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// extractRoomReplyFromTaskMessages rebuilds the user-visible assistant answer
// from streamed task_message rows when the daemon completes with an empty
// terminal output field. Mirrors the chat copy-text path: preface + final
// text segments outside the tool/thinking fold.
func extractRoomReplyFromTaskMessages(msgs []db.TaskMessage) string {
	if len(msgs) == 0 {
		return ""
	}
	if reply := extractVisibleTextReply(msgs); strings.TrimSpace(reply) != "" {
		return reply
	}
	// Some backends stream assistant prose as "thinking" only; use that as a
	// last resort before marking the room invocation failed.
	return extractAllProseMessages(msgs)
}

func extractVisibleTextReply(msgs []db.TaskMessage) string {
	firstNonText := -1
	for i, m := range msgs {
		if !isReplyTextType(m.Type) {
			firstNonText = i
			break
		}
	}
	if firstNonText == -1 {
		return joinProseContents(msgs, func(int) bool { return true })
	}
	lastNonText := len(msgs) - 1
	for lastNonText >= 0 && isReplyTextType(msgs[lastNonText].Type) {
		lastNonText--
	}
	var parts []string
	for i, m := range msgs {
		if !isReplyTextType(m.Type) {
			continue
		}
		if i < firstNonText || i > lastNonText {
			if content := strings.TrimSpace(taskMessageContent(m)); content != "" {
				parts = append(parts, content)
			}
		}
	}
	return strings.Join(parts, "\n\n")
}

func extractAllProseMessages(msgs []db.TaskMessage) string {
	return joinProseContents(msgs, func(i int) bool {
		typ := msgs[i].Type
		return typ == "text" || typ == "thinking"
	})
}

func joinProseContents(msgs []db.TaskMessage, include func(int) bool) string {
	var parts []string
	for i, m := range msgs {
		if !include(i) {
			continue
		}
		if content := strings.TrimSpace(taskMessageContent(m)); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n\n")
}

func isReplyTextType(typ string) bool {
	return typ == "text"
}

func taskMessageContent(m db.TaskMessage) string {
	if m.Content.Valid {
		return m.Content.String
	}
	return ""
}
