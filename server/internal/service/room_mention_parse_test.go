package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolvePlainAgentMentions(t *testing.T) {
	agents := []roomAgentName{
		{id: "a1", name: "需求分析师"},
		{id: "a2", name: "系统架构师"},
	}
	got := resolvePlainAgentMentions("好的，我来@需求分析师。 @需求分析师 请回复一下。", agents)
	require.Len(t, got, 1)
	require.Equal(t, "agent", got[0].Type)
	require.Equal(t, "a1", got[0].ID)
}

func TestResolvePlainAgentMentions_LongestNameFirst(t *testing.T) {
	agents := []roomAgentName{
		{id: "short", name: "分析"},
		{id: "long", name: "需求分析师"},
	}
	got := resolvePlainAgentMentions("@需求分析师 你好", agents)
	require.Len(t, got, 1)
	require.Equal(t, "long", got[0].ID)
}

func TestResolvePlainAgentMentions_StructuredWins(t *testing.T) {
	content := "[@需求分析师](mention://agent/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb) hi"
	got := resolvePlainAgentMentions(content, []roomAgentName{
		{id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "需求分析师"},
	})
	require.Empty(t, got)
}
