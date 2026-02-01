package cmd

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/misty-step/mercury/cli/internal/api"
	"github.com/spf13/cobra"
)

var sendCmd = &cobra.Command{
	Use:   "send [from] [to] [subject]",
	Short: "Send an email",
	Args:  cobra.MaximumNArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) != 0 && len(args) != 3 {
			return fmt.Errorf("provide [from] [to] [subject] or no args for interactive mode")
		}

		reader := bufio.NewReader(os.Stdin)
		from := ""
		to := ""
		subject := ""
		var body string

		if len(args) == 0 {
			printHeader("Compose New Email")
			line, err := promptLine(reader, fmt.Sprintf("From [%s]: ", defaultFrom), defaultFrom)
			if err != nil {
				return err
			}
			from = line
			to, err = promptLine(reader, "To: ", "")
			if err != nil {
				return err
			}
			subject, err = promptLine(reader, "Subject: ", "")
			if err != nil {
				return err
			}
			fmt.Println("Body (Ctrl+D when done):")
			bodyBytes, err := io.ReadAll(reader)
			if err != nil {
				return err
			}
			body = string(bodyBytes)
		} else {
			from = args[0]
			to = args[1]
			subject = args[2]
			bodyBytes, err := io.ReadAll(os.Stdin)
			if err != nil {
				return err
			}
			body = string(bodyBytes)
		}

		if strings.TrimSpace(from) == "" {
			from = defaultFrom
		}
		if strings.TrimSpace(to) == "" {
			return fmt.Errorf("recipient required")
		}
		if !validEmail(to) {
			return fmt.Errorf("invalid recipient email")
		}
		if strings.TrimSpace(from) != "" && !validEmail(from) {
			return fmt.Errorf("invalid sender email")
		}
		if strings.TrimSpace(subject) == "" {
			return fmt.Errorf("subject required")
		}
		if strings.TrimSpace(body) == "" {
			return fmt.Errorf("body required")
		}

		client, err := authedClient()
		if err != nil {
			return err
		}

		printDim("Sending...")
		resp, err := client.SendEmail(&api.SendRequest{
			From:    from,
			To:      to,
			Subject: subject,
			Text:    body,
		})
		if err != nil {
			return err
		}
		if resp.Success {
			if resp.MessageID != "" {
				printSuccess("Sent. Message ID: %s", resp.MessageID)
			} else {
				printSuccess("Sent.")
			}
			return nil
		}
		if resp.Error != "" {
			return fmt.Errorf("send failed: %s", resp.Error)
		}
		return fmt.Errorf("send failed")
	},
}

func init() {
	rootCmd.AddCommand(sendCmd)
}

func promptLine(reader *bufio.Reader, prompt string, fallback string) (string, error) {
	warnStyle.Fprint(color.Output, prompt)
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return fallback, nil
	}
	return line, nil
}
