package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

var readCmd = &cobra.Command{
	Use:     "read <id>",
	Short:   "Read an email",
	Aliases: []string{"show", "view"},
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id, err := parseIDArg(args[0])
		if err != nil {
			return err
		}

		client, err := authedClient()
		if err != nil {
			return err
		}

		email, err := client.GetEmail(id)
		if err != nil {
			return err
		}

		printHeader(fmt.Sprintf("Email #%d", id))
		fmt.Printf("From:    %s\n", email.Sender)
		fmt.Printf("To:      %s\n", email.Recipient)
		fmt.Printf("Subject: %s\n", email.Subject)
		fmt.Printf("Date:    %s\n", email.ReceivedAt)
		fmt.Println("")
		fmt.Println(strings.Repeat("-", 78))
		fmt.Println("")

		body := email.Body()
		if body == "" {
			body = "(no body)"
		}
		fmt.Println(body)

		// Mark as read (best effort - don't fail the read if this fails)
		if !email.Read() {
			_ = client.MarkAsRead(id)
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(readCmd)
}
