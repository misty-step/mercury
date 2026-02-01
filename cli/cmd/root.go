package cmd

import (
	"fmt"
	"net/mail"
	"os"
	"strconv"
	"strings"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/misty-step/mercury/cli/internal/api"
)

const defaultFrom = "kaylee@mistystep.io"

var (
	version = "dev"
	apiURL  string

	rootCmd = &cobra.Command{
		Use:           "mercury",
		Short:         "Mercury Mail CLI",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	headerStyle  = color.New(color.FgBlue, color.Bold)
	successStyle = color.New(color.FgGreen)
	errorStyle   = color.New(color.FgRed)
	dimStyle     = color.New(color.Faint)
	warnStyle    = color.New(color.FgYellow)
)

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		printError(err)
		os.Exit(1)
	}
}

func init() {
	apiURL = api.BaseURLFromEnv()
	rootCmd.Version = version
	rootCmd.SetVersionTemplate("mercury v{{.Version}}\n")
	rootCmd.PersistentFlags().StringVar(&apiURL, "api-url", apiURL, "Server URL")
	color.NoColor = !isTTY(os.Stdout)
}

func authedClient() (*api.Client, error) {
	return api.NewClient(apiURL)
}

func unauthedClient() *api.Client {
	return api.NewClientNoAuth(apiURL)
}

func printHeader(title string) {
	headerStyle.Println(title)
	fmt.Println(strings.Repeat("-", 78))
}

func printSuccess(format string, args ...interface{}) {
	successStyle.Fprintf(color.Output, format+"\n", args...)
}

func printDim(format string, args ...interface{}) {
	dimStyle.Fprintf(color.Output, format+"\n", args...)
}

func printError(err error) {
	errorStyle.Fprintf(color.Error, "Error: %s\n", err.Error())
}

func isTTY(file *os.File) bool {
	info, err := file.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func parseIDArg(arg string) (int, error) {
	id, err := strconv.Atoi(arg)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid id: %q", arg)
	}
	return id, nil
}

func parseOptionalInt(arg string, fallback int) (int, error) {
	if strings.TrimSpace(arg) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(arg)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %q", arg)
	}
	return value, nil
}

func truncate(s string, max int) string {
	if max <= 0 {
		return ""
	}
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func normalizeSender(sender string) string {
	sender = strings.TrimSpace(sender)
	if sender == "" {
		return ""
	}
	if addr, err := mail.ParseAddress(sender); err == nil {
		sender = addr.Address
	}
	if at := strings.Index(sender, "@"); at != -1 {
		return sender[:at]
	}
	return sender
}

func validEmail(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	_, err := mail.ParseAddress(value)
	return err == nil
}
