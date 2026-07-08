package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/util"
	"github.com/stretchr/testify/require"
)

func TestArchiveRoomArchivesAutoCreatedManagerAgent(t *testing.T) {
	createReq := newRequest(http.MethodPost, "/api/rooms", map[string]any{
		"name": "Mgr Archive Room",
		"type": "project",
		"manager_agent": map[string]any{
			"runtime_id": testRuntimeID,
		},
	})
	createReq = withChatTestWorkspaceCtx(t, createReq)
	w := httptest.NewRecorder()
	testHandler.CreateRoom(w, createReq)
	require.Equal(t, http.StatusCreated, w.Code)

	var room RoomResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &room))
	require.NotNil(t, room.ManagerAgentID)

	archiveReq := newRequest(http.MethodDelete, "/api/rooms/"+room.ID, nil)
	archiveReq = withURLParam(archiveReq, "roomId", room.ID)
	archiveReq = withChatTestWorkspaceCtx(t, archiveReq)
	wArchive := httptest.NewRecorder()
	testHandler.ArchiveRoom(wArchive, archiveReq)
	require.Equal(t, http.StatusNoContent, wArchive.Code)

	agent, err := testHandler.Queries.GetAgent(context.Background(), util.MustParseUUID(*room.ManagerAgentID))
	require.NoError(t, err)
	require.True(t, agent.ArchivedAt.Valid, "auto-created manager agent should be archived with the room")

	archReq := newRequest(http.MethodPost, "/api/agents/"+*room.ManagerAgentID+"/archive", nil)
	archReq = withURLParam(archReq, "id", *room.ManagerAgentID)
	wConflict := httptest.NewRecorder()
	testHandler.ArchiveAgent(wConflict, archReq)
	require.Equal(t, http.StatusConflict, wConflict.Code)
}

func TestCreateRoomRequiresName(t *testing.T) {
	req := newRequest(http.MethodPost, "/api/rooms", map[string]any{})
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.CreateRoom(w, req)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateRoomAndSendMessage(t *testing.T) {
	req := newRequest(http.MethodPost, "/api/rooms", map[string]any{
		"name": "Test Room",
		"type": "project",
	})
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.CreateRoom(w, req)
	require.Equal(t, http.StatusCreated, w.Code)

	var room RoomResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &room))
	require.Equal(t, "Test Room", room.Name)

	msgReq := newRequest(http.MethodPost, "/api/rooms/"+room.ID+"/messages", map[string]string{
		"content": "hello without mentions",
	})
	msgReq = withURLParam(msgReq, "roomId", room.ID)
	msgReq = withChatTestWorkspaceCtx(t, msgReq)
	w2 := httptest.NewRecorder()
	testHandler.SendRoomMessage(w2, msgReq)
	require.Equal(t, http.StatusCreated, w2.Code)
}

func TestListRoomDeliveriesGone(t *testing.T) {
	req := newRequest(http.MethodGet, "/api/rooms/00000000-0000-0000-0000-000000000001/deliveries", nil)
	req = withURLParam(req, "roomId", "00000000-0000-0000-0000-000000000001")
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.ListRoomDeliveries(w, req)
	require.Equal(t, http.StatusGone, w.Code)
}

func TestGetRoomWorkboardGone(t *testing.T) {
	req := newRequest(http.MethodGet, "/api/rooms/00000000-0000-0000-0000-000000000001/workboard", nil)
	req = withURLParam(req, "roomId", "00000000-0000-0000-0000-000000000001")
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.GetRoomWorkboard(w, req)
	require.Equal(t, http.StatusGone, w.Code)
}

func TestGetRoomGraphResponseShape(t *testing.T) {
	createReq := newRequest(http.MethodPost, "/api/rooms", map[string]any{
		"name": "Graph Room",
		"type": "project",
		"manager_agent": map[string]any{
			"runtime_id": testRuntimeID,
		},
	})
	createReq = withChatTestWorkspaceCtx(t, createReq)
	w := httptest.NewRecorder()
	testHandler.CreateRoom(w, createReq)
	require.Equal(t, http.StatusCreated, w.Code)

	var room RoomResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &room))

	msgReq := newRequest(http.MethodPost, "/api/rooms/"+room.ID+"/messages", map[string]string{
		"content": "hello without mentions",
	})
	msgReq = withURLParam(msgReq, "roomId", room.ID)
	msgReq = withChatTestWorkspaceCtx(t, msgReq)
	wMsg := httptest.NewRecorder()
	testHandler.SendRoomMessage(wMsg, msgReq)
	require.Equal(t, http.StatusCreated, wMsg.Code)

	graphReq := newRequest(http.MethodGet, "/api/rooms/"+room.ID+"/graph", nil)
	graphReq = withURLParam(graphReq, "roomId", room.ID)
	graphReq = withChatTestWorkspaceCtx(t, graphReq)
	wGraph := httptest.NewRecorder()
	testHandler.GetRoomGraph(wGraph, graphReq)
	require.Equal(t, http.StatusOK, wGraph.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(wGraph.Body.Bytes(), &body))
	require.Contains(t, body, "assignments")
	require.Contains(t, body, "invocation_events")

	assignments, ok := body["assignments"].([]any)
	require.True(t, ok)
	if len(assignments) > 0 {
		first, ok := assignments[0].(map[string]any)
		require.True(t, ok)
		require.IsType(t, "", first["id"])
		require.IsType(t, "", first["room_id"], "assignment room_id must be a string UUID")
	}

	events, ok := body["invocation_events"].([]any)
	require.True(t, ok)
	if len(events) > 0 {
		first, ok := events[0].(map[string]any)
		require.True(t, ok)
		payload, ok := first["payload"].(map[string]any)
		require.True(t, ok, "invocation event payload must be a JSON object, not base64")
		_ = payload
	}
}
