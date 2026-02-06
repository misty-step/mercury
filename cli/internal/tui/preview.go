package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/misty-step/mercury/cli/internal/api"
)

var (
	headerLabelStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("242"))
	headerValueStyle = lipgloss.NewStyle()
	subjectStyle     = lipgloss.NewStyle().Bold(true)
	dividerStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
)

type PreviewModel struct {
	viewport viewport.Model
	email    *api.Email
	ready    bool
}

func NewPreviewModel(width, height int) PreviewModel {
	vp := viewport.New(width, height)
	vp.Style = lipgloss.NewStyle().Padding(0, 1)
	return PreviewModel{viewport: vp}
}

func (m PreviewModel) Update(msg tea.Msg) (PreviewModel, tea.Cmd) {
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m PreviewModel) View() string {
	if m.email == nil {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("242")).Render("Select an email to preview")
	}
	return m.viewport.View()
}

func (m *PreviewModel) SetEmail(email *api.Email) {
	m.email = email
	if email == nil {
		m.viewport.SetContent("")
		return
	}

	var sb strings.Builder

	// Headers
	sb.WriteString(headerLabelStyle.Render("From: "))
	sb.WriteString(headerValueStyle.Render(email.Sender))
	sb.WriteString("\n")

	sb.WriteString(headerLabelStyle.Render("To: "))
	sb.WriteString(headerValueStyle.Render(email.Recipient))
	sb.WriteString("\n")

	sb.WriteString(headerLabelStyle.Render("Subject: "))
	sb.WriteString(subjectStyle.Render(email.Subject))
	sb.WriteString("\n")

	sb.WriteString(headerLabelStyle.Render("Date: "))
	sb.WriteString(headerValueStyle.Render(email.ReceivedAt))
	sb.WriteString("\n")

	// Divider
	dividerWidth := m.viewport.Width - 2
	if dividerWidth < 0 {
		dividerWidth = 0
	}
	divider := strings.Repeat("─", dividerWidth)
	sb.WriteString(dividerStyle.Render(divider))
	sb.WriteString("\n\n")

	// Body
	body := email.Body()
	if body == "" {
		body = "(No content)"
	}
	sb.WriteString(body)

	m.viewport.SetContent(sb.String())
	m.viewport.GotoTop()
}

func (m *PreviewModel) SetSize(w, h int) {
	m.viewport.Width = w
	m.viewport.Height = h
	if m.email != nil {
		m.SetEmail(m.email) // Re-render with new width
	}
}
