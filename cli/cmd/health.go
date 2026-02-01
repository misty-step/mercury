package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

var healthCmd = &cobra.Command{
	Use:     "health",
	Short:   "Check server health",
	Aliases: []string{"ping"},
	RunE: func(cmd *cobra.Command, args []string) error {
		printDim("Checking %s...", apiURL)
		client := unauthedClient()

		resp, err := client.Health()
		if err != nil {
			return err
		}

		if strings.EqualFold(resp.Status, "ok") {
			printSuccess("Server is healthy.")
		} else {
			return fmt.Errorf("server unhealthy: %s", resp.Status)
		}

		fmt.Printf("Status:    %s\n", resp.Status)
		fmt.Printf("Timestamp: %s\n", resp.Timestamp)
		fmt.Printf("Version:   %s\n", resp.Version)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(healthCmd)
}
