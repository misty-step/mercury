package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show mailbox statistics",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := authedClient()
		if err != nil {
			return err
		}

		stats, err := client.GetStats()
		if err != nil {
			return err
		}

		printHeader("Mailbox Statistics")
		fmt.Printf("Total:   %d\n", stats.Total)
		fmt.Printf("Unread:  %d\n", stats.Unread)
		fmt.Printf("Starred: %d\n", stats.Starred)
		fmt.Printf("Inbox:   %d\n", stats.Inbox)
		fmt.Printf("Trash:   %d\n", stats.Trash)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(statsCmd)
}
