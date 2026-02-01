package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/misty-step/mercury/cli/internal/api"
	"github.com/spf13/cobra"
)

var replyCmd = &cobra.Command{
	Use:   "reply <id>",
	Short: "Reply to an email",
	Args:  cobra.ExactArgs(1),
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

		printHeader("Reply")
		printDim("To: %s", email.Sender)
		subject := normalizeReplySubject(email.Subject)
		printDim("Subject: %s", subject)
		fmt.Println("")

		reader := bufio.NewReader(os.Stdin)
		defaultFrom := getDefaultFrom()
		fromPrompt := "From: "
		if defaultFrom != "" {
			fromPrompt = fmt.Sprintf("From [%s]: ", defaultFrom)
		}
		from, err := promptLine(reader, fromPrompt, defaultFrom)
		if errors.Is(err, ErrUserCancelled) {
			fmt.Println("Cancelled.")
			return nil
		}
		if err != nil {
			return err
		}
		fmt.Println("Body (Ctrl+D when done):")
		bodyBytes, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		body := string(bodyBytes)

		if strings.TrimSpace(from) == "" {
			return fmt.Errorf("sender required (set MERCURY_FROM environment variable for a default)")
		}
		if !validEmail(from) {
			return fmt.Errorf("invalid sender email")
		}
		replyTo := extractEmailAddress(email.Sender)
		if replyTo == "" {
			return fmt.Errorf("cannot reply: invalid sender address %q", email.Sender)
		}
		if strings.TrimSpace(body) == "" {
			return fmt.Errorf("body required")
		}

		req := &api.SendRequest{
			From:    from,
			To:      replyTo,
			Subject: subject,
			Text:    body,
		}
		if strings.TrimSpace(email.MessageID) != "" {
			req.Headers = map[string]string{
				"In-Reply-To": email.MessageID,
				"References":  email.MessageID,
			}
		}

		printDim("Sending reply...")
		resp, err := client.SendEmail(req)
		if err != nil {
			return err
		}
		if resp.Success {
			printSuccess("Reply sent.")
			return nil
		}
		if resp.Error != "" {
			return fmt.Errorf("reply failed: %s", resp.Error)
		}
		return fmt.Errorf("reply failed")
	},
}

func init() {
	rootCmd.AddCommand(replyCmd)
}
