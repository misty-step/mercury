package cmd

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var (
	deleteForce     bool
	deletePermanent bool
)

var deleteCmd = &cobra.Command{
	Use:     "delete <id>",
	Short:   "Delete an email",
	Aliases: []string{"rm", "del"},
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id, err := parseIDArg(args[0])
		if err != nil {
			return err
		}

		if !deleteForce {
			confirm, err := confirmPrompt(fmt.Sprintf("Delete email #%d? [y/N] ", id))
			if err != nil {
				return err
			}
			if !confirm {
				fmt.Println("Cancelled.")
				return nil
			}
		}

		client, err := authedClient()
		if err != nil {
			return err
		}

		if err := client.DeleteEmail(id, deletePermanent); err != nil {
			return err
		}
		printSuccess("Deleted email #%d", id)
		return nil
	},
}

func init() {
	deleteCmd.Flags().BoolVarP(&deleteForce, "force", "f", false, "Skip confirmation")
	deleteCmd.Flags().BoolVar(&deletePermanent, "permanent", false, "Permanently delete email")
	rootCmd.AddCommand(deleteCmd)
}

func confirmPrompt(prompt string) (bool, error) {
	warnStyle.Fprint(color.Output, prompt)
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return false, err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return false, nil
	}
	switch strings.ToLower(line) {
	case "y", "yes":
		return true, nil
	default:
		return false, nil
	}
}
