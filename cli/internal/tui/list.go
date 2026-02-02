package tui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/misty-step/mercury/cli/internal/api"
)

// EmailItem wraps api.Email to implement list.Item
type EmailItem struct {
	Email api.Email
}

func (i EmailItem) Title() string {
	unread := " "
	if i.Email.IsRead == 0 {
		unread = "*"
	}
	sender := truncateSender(i.Email.Sender, 18)
	return fmt.Sprintf("%s [%3d] %s", unread, i.Email.ID, sender)
}

func (i EmailItem) Description() string {
	return truncate(i.Email.Subject, 40)
}

func (i EmailItem) FilterValue() string {
	return i.Email.Subject + " " + i.Email.Sender
}

func truncateSender(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-2] + ".."
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-2] + ".."
}

// ListModel wraps bubbles list
type ListModel struct {
	list   list.Model
	emails []api.Email
}

func NewListModel(width, height int) ListModel {
	delegate := list.NewDefaultDelegate()

	// Style unread emails as bold
	delegate.Styles.NormalTitle = delegate.Styles.NormalTitle.Bold(false)
	delegate.Styles.SelectedTitle = delegate.Styles.SelectedTitle.Bold(true)

	l := list.New([]list.Item{}, delegate, width, height)
	l.Title = "Inbox"
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(true)
	l.Styles.Title = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("62"))

	return ListModel{list: l}
}

func (m ListModel) Update(msg tea.Msg) (ListModel, tea.Cmd) {
	var cmd tea.Cmd
	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

func (m ListModel) View() string {
	return m.list.View()
}

func (m *ListModel) SetEmails(emails []api.Email) {
	m.emails = emails
	items := make([]list.Item, len(emails))
	for i, e := range emails {
		items[i] = EmailItem{Email: e}
	}
	m.list.SetItems(items)
}

func (m ListModel) SelectedEmail() *api.Email {
	if item := m.list.SelectedItem(); item != nil {
		if ei, ok := item.(EmailItem); ok {
			return &ei.Email
		}
	}
	return nil
}

func (m *ListModel) SetSize(w, h int) {
	m.list.SetSize(w, h)
}

func (m ListModel) Index() int {
	return m.list.Index()
}

func (m *ListModel) SetIndex(index int) {
	m.list.Select(index)
}
