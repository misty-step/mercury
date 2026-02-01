package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"os"
	"strconv"
	"strings"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/misty-step/mercury/cli/internal/api"
)

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

// ErrUserCancelled indicates the user pressed Ctrl+D to cancel.
var ErrUserCancelled = errors.New("cancelled")

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

func getDefaultFrom() string {
	if from := strings.TrimSpace(os.Getenv("MERCURY_FROM")); from != "" {
		return from
	}
	return ""
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

// normalizeReplySubject ensures subject has exactly one "Re: " prefix.
func normalizeReplySubject(subject string) string {
	cleaned := subject
	for {
		lower := strings.ToLower(cleaned)
		if strings.HasPrefix(lower, "re:") {
			cleaned = strings.TrimSpace(cleaned[3:])
		} else if strings.HasPrefix(lower, "re ") {
			cleaned = strings.TrimSpace(cleaned[3:])
		} else {
			break
		}
	}
	return "Re: " + cleaned
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

// extractEmailAddress extracts the email address from a potentially formatted sender.
// e.g., "John Doe <john@example.com>" -> "john@example.com"
func extractEmailAddress(sender string) string {
	sender = strings.TrimSpace(sender)
	if sender == "" {
		return ""
	}
	addr, err := mail.ParseAddress(sender)
	if err != nil {
		if strings.Contains(sender, "@") {
			return sender
		}
		return ""
	}
	return addr.Address
}

func validEmail(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	_, err := mail.ParseAddress(value)
	return err == nil
}

func promptLine(reader *bufio.Reader, prompt string, fallback string) (string, error) {
	warnStyle.Fprint(color.Output, prompt)
	line, err := reader.ReadString('\n')
	if err == io.EOF {
		if line == "" {
			fmt.Println()
			return "", ErrUserCancelled
		}
		line = strings.TrimSpace(line)
		if line == "" {
			return fallback, nil
		}
		return line, nil
	}
	if err != nil {
		return "", err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return fallback, nil
	}
	return line, nil
}
