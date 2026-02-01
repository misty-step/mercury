package cmd

import (
	"bufio"
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
		printDim("Subject: Re: %s", email.Subject)
		fmt.Println("")

		reader := bufio.NewReader(os.Stdin)
		from, err := promptLine(reader, fmt.Sprintf("From [%s]: ", defaultFrom), defaultFrom)
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
			from = defaultFrom
		}
		if !validEmail(from) {
			return fmt.Errorf("invalid sender email")
		}
		if !validEmail(email.Sender) {
			return fmt.Errorf("invalid recipient email")
		}
		if strings.TrimSpace(body) == "" {
			return fmt.Errorf("body required")
		}

		subject := fmt.Sprintf("Re: %s", email.Subject)
		req := &api.SendRequest{
			From:    from,
			To:      email.Sender,
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
