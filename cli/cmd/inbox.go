package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var inboxCmd = &cobra.Command{
	Use:     "inbox [limit] [offset]",
	Short:   "List emails in inbox",
	Aliases: []string{"list", "ls"},
	Args:    cobra.MaximumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		limit := 20
		offset := 0
		var err error

		if len(args) > 0 {
			limit, err = parseOptionalInt(args[0], limit)
			if err != nil {
				return err
			}
		}
		if len(args) > 1 {
			offset, err = parseOptionalInt(args[1], offset)
			if err != nil {
				return err
			}
		}
		if limit <= 0 {
			return fmt.Errorf("limit must be positive")
		}
		if offset < 0 {
			return fmt.Errorf("offset must be zero or positive")
		}

		client, err := authedClient()
		if err != nil {
			return err
		}

		resp, err := client.ListEmails(limit, offset, "inbox")
		if err != nil {
			return err
		}

		printHeader("Mercury Inbox")

		if len(resp.Emails) == 0 {
			fmt.Println("  (empty)")
		} else {
			for _, email := range resp.Emails {
				marker := " "
				if email.IsRead == 0 {
					marker = "*"
				}
				sender := truncate(normalizeSender(email.Sender), 25)
				subject := truncate(email.Subject, 45)
				fmt.Printf("%s [%3d] %-25s %s\n", marker, email.ID, sender, subject)
			}
		}

		fmt.Printf("\nTotal: %d emails\n", resp.Total)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(inboxCmd)
}
