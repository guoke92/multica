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

func TestGetRoomWorkboardShape(t *testing.T) {
	createReq := newRequest(http.MethodPost, "/api/rooms", map[string]any{
		"name": "Workboard Room",
		"type": "project",
	})
	createReq = withChatTestWorkspaceCtx(t, createReq)
	w := httptest.NewRecorder()
	testHandler.CreateRoom(w, createReq)
	require.Equal(t, http.StatusCreated, w.Code)

	var room RoomResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &room))

	wbReq := newRequest(http.MethodGet, "/api/rooms/"+room.ID+"/workboard", nil)
	wbReq = withURLParam(wbReq, "roomId", room.ID)
	wbReq = withChatTestWorkspaceCtx(t, wbReq)
	wb := httptest.NewRecorder()
	testHandler.GetRoomWorkboard(wb, wbReq)
	require.Equal(t, http.StatusOK, wb.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(wb.Body.Bytes(), &body))
	require.Contains(t, body, "pending_count")
	require.Contains(t, body, "running_count")
	_, hasIssues := body["issues"]
	require.False(t, hasIssues, "workboard must not expose issues[]")
	_, hasDelivery := body["active_delivery"]
	require.False(t, hasDelivery, "workboard must not expose active_delivery")
}
