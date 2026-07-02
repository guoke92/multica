package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var roomCmd = &cobra.Command{
	Use:   "room",
	Short: "Work with collaboration rooms",
}

var roomMessageCmd = &cobra.Command{
	Use:   "message",
	Short: "Work with room messages",
}

var roomMessageGetCmd = &cobra.Command{
	Use:   "get <room-id> <message-id>",
	Short: "Get a room message by ID",
	Long:  "Fetch a room message summary and optional full agent output.",
	Args:  exactArgs(2),
	RunE:  runRoomMessageGet,
}

func init() {
	roomMessageGetCmd.Flags().String("output", "json", "Output format: json")
	roomMessageCmd.AddCommand(roomMessageGetCmd)
	roomCmd.AddCommand(roomMessageCmd)
}

func runRoomMessageGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var msg map[string]any
	path := fmt.Sprintf("/api/rooms/%s/messages/%s", args[0], args[1])
	if err := client.GetJSON(ctx, path, &msg); err != nil {
		return fmt.Errorf("get room message: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, msg)
	}
	fmt.Printf("id: %s\nsender: %s\ncontent: %s\n", strVal(msg, "id"), strVal(msg, "sender_type"), strVal(msg, "content"))
	return nil
}
