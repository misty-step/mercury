package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/misty-step/mercury/cli/internal/config"
)

var profileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Manage Mercury profiles",
}

var profileListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all profiles",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}

		if len(cfg.Profiles) == 0 {
			fmt.Println("No profiles configured.")
			fmt.Println("Create ~/.config/mercury/config.toml to add profiles.")
			return nil
		}

		printHeader("Profiles")
		for name, p := range cfg.Profiles {
			marker := "  "
			if name == cfg.Default {
				marker = "* "
			}
			fmt.Printf("%s%s <%s>\n", marker, name, p.Email)
		}
		return nil
	},
}

var profileUseCmd = &cobra.Command{
	Use:   "use <name>",
	Short: "Set default profile",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		name := args[0]

		cfg, err := config.Load()
		if err != nil {
			return err
		}

		if _, ok := cfg.Profiles[name]; !ok {
			return fmt.Errorf("profile %q not found", name)
		}

		cfg.Default = name
		if err := config.Save(cfg); err != nil {
			return err
		}

		printSuccess("Default profile set to %q", name)
		return nil
	},
}

func init() {
	profileCmd.AddCommand(profileListCmd)
	profileCmd.AddCommand(profileUseCmd)
	rootCmd.AddCommand(profileCmd)
}
