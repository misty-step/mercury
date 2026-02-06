package tui

import (
	"fmt"
	"net/mail"
	"os"
	"os/exec"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/misty-step/mercury/cli/internal/api"
)

// ComposeState holds compose session data
type ComposeState struct {
	To      string
	Subject string
	TmpFile string
	Headers map[string]string // For In-Reply-To, References
}

// getEditor returns the editor command, checking $VISUAL, $EDITOR, then defaulting to vim
func getEditor() string {
	if editor := os.Getenv("VISUAL"); editor != "" {
		return editor
	}
	if editor := os.Getenv("EDITOR"); editor != "" {
		return editor
	}
	return "vim"
}

// buildEditorCommand creates an exec.Command for the editor with the given file
// Handles editors with arguments like "code --wait" by parsing the editor string
func buildEditorCommand(editor, filePath string) *exec.Cmd {
	parts := strings.Fields(editor)
	if len(parts) == 0 {
		parts = []string{"vim"}
	}
	args := append(parts[1:], filePath)
	return exec.Command(parts[0], args...)
}

// shellQuote safely quotes a string for shell execution
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// cleanupCompose removes temp file and clears compose state
func cleanupCompose(m *Model) {
	if m.compose != nil && m.compose.TmpFile != "" {
		os.Remove(m.compose.TmpFile)
	}
	m.compose = nil
}

// startCompose initiates a new email composition
func startCompose(m Model, to, subject string, headers map[string]string) (Model, tea.Cmd) {
	// Block new compose while one is active
	if m.compose != nil {
		if m.compose.TmpFile == "" {
			return m, nil
		}
		editor := getEditor()
		tmpPath := m.compose.TmpFile
		return m, tea.ExecProcess(buildEditorCommand(editor, tmpPath), func(err error) tea.Msg {
			return EditorClosed{TmpFile: tmpPath, Err: err}
		})
	}

	// Create temp file with template
	tmpFile, err := os.CreateTemp("", "mercury-compose-*.txt")
	if err != nil {
		m.err = err
		return m, nil
	}

	// Write template
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("To: %s\n", to))
	sb.WriteString(fmt.Sprintf("Subject: %s\n", subject))
	for k, v := range headers {
		sb.WriteString(fmt.Sprintf("%s: %s\n", k, v))
	}
	sb.WriteString("\n")
	sb.WriteString("# Write your message above. Lines starting with # are ignored.\n")
	sb.WriteString("# Save and close the editor to send, or delete all content to cancel.\n")

	if _, err := tmpFile.WriteString(sb.String()); err != nil {
		m.err = err
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return m, nil
	}
	if err := tmpFile.Close(); err != nil {
		m.err = err
		_ = os.Remove(tmpFile.Name())
		return m, nil
	}

	m.compose = &ComposeState{
		To:      to,
		Subject: subject,
		TmpFile: tmpFile.Name(),
		Headers: headers,
	}

	editor := getEditor()

	return m, tea.ExecProcess(buildEditorCommand(editor, tmpFile.Name()), func(err error) tea.Msg {
		return EditorClosed{TmpFile: tmpFile.Name(), Err: err}
	})
}

// startReply initiates a reply to the given email
func startReply(m Model, email *api.Email) (Model, tea.Cmd) {
	// Block new compose while one is active
	if m.compose != nil {
		return m, nil
	}

	if email == nil {
		return m, nil
	}

	to := extractEmailAddress(email.Sender)
	if to == "" {
		to = email.Sender
	}

	subject := normalizeReplySubject(email.Subject)

	headers := make(map[string]string)
	if email.MessageID != "" {
		headers["In-Reply-To"] = email.MessageID
		headers["References"] = email.MessageID
	}

	tmpFile, err := os.CreateTemp("", "mercury-reply-*.txt")
	if err != nil {
		m.err = err
		return m, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("To: %s\n", to))
	sb.WriteString(fmt.Sprintf("Subject: %s\n", subject))
	for k, v := range headers {
		sb.WriteString(fmt.Sprintf("%s: %s\n", k, v))
	}
	sb.WriteString("\n")
	sb.WriteString("\n")
	sb.WriteString("\n")
	sb.WriteString(fmt.Sprintf("On %s, %s wrote:\n", email.ReceivedAt, email.Sender))

	body := email.Body()
	for _, line := range strings.Split(body, "\n") {
		sb.WriteString("> " + line + "\n")
	}

	if _, err := tmpFile.WriteString(sb.String()); err != nil {
		m.err = err
		tmpFile.Close()
		_ = os.Remove(tmpFile.Name())
		return m, nil
	}
	if err := tmpFile.Close(); err != nil {
		m.err = err
		_ = os.Remove(tmpFile.Name())
		return m, nil
	}

	m.compose = &ComposeState{
		To:      to,
		Subject: subject,
		TmpFile: tmpFile.Name(),
		Headers: headers,
	}

	editor := getEditor()

	return m, tea.ExecProcess(buildEditorCommand(editor, tmpFile.Name()), func(err error) tea.Msg {
		return EditorClosed{TmpFile: tmpFile.Name(), Err: err}
	})
}

// handleEditorClose processes the composed message
func handleEditorClose(m Model, tmpFile string, editorErr error) (Model, tea.Cmd) {
	if m.compose == nil || m.compose.TmpFile != tmpFile {
		return m, nil
	}

	if editorErr != nil {
		m.err = editorErr
		_ = os.Remove(tmpFile)
		m.compose = nil
		return m, nil
	}

	content, err := os.ReadFile(tmpFile)
	if err != nil {
		m.err = err
		_ = os.Remove(tmpFile)
		m.compose = nil
		return m, nil
	}

	// Parse content
	lines := strings.Split(string(content), "\n")
	var to, subject, body string
	headers := make(map[string]string)
	inHeaders := true
	var bodyLines []string

	for _, line := range lines {
		if inHeaders {
			if strings.TrimSpace(line) == "" {
				inHeaders = false
				continue
			}
			if idx := strings.Index(line, ": "); idx != -1 {
				key := strings.TrimSpace(line[:idx])
				val := strings.TrimSpace(line[idx+2:])
				switch strings.ToLower(key) {
				case "to":
					to = val
				case "subject":
					subject = val
				default:
					headers[key] = val
				}
			}
		} else {
			// Skip comment lines
			if !strings.HasPrefix(strings.TrimSpace(line), "#") {
				bodyLines = append(bodyLines, line)
			}
		}
	}

	body = strings.TrimSpace(strings.Join(bodyLines, "\n"))

	// If body is empty, cancel
	if body == "" {
		_ = os.Remove(tmpFile)
		m.compose = nil
		return m, nil
	}

	// Validate To field
	if to == "" || !strings.Contains(to, "@") {
		m.err = fmt.Errorf("invalid recipient: To must be non-empty and contain @. Press 'c' to edit draft")
		return m, nil
	}

	// Validate Subject field
	if subject == "" {
		m.err = fmt.Errorf("invalid email: Subject must be non-empty. Press 'c' to edit draft")
		return m, nil
	}

	_ = os.Remove(tmpFile)
	m.compose = nil

	// Send the email
	return m, sendEmail(m.client, &api.SendRequest{
		To:      to,
		Subject: subject,
		Text:    body,
		Headers: headers,
	})
}

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

// sendEmail sends an email via the API
func sendEmail(client *api.Client, req *api.SendRequest) tea.Cmd {
	return func() tea.Msg {
		resp, err := client.SendEmail(req)
		if err != nil {
			return ErrMsg{Err: err}
		}
		return EmailSent{MessageID: resp.MessageID}
	}
}
