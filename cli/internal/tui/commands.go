package tui

import (
	tea "github.com/charmbracelet/bubbletea"

	"github.com/misty-step/mercury/cli/internal/api"
)

// fetchEmails fetches the email list asynchronously
func fetchEmails(client *api.Client, limit, offset int) tea.Cmd {
	return func() tea.Msg {
		resp, err := client.ListEmails(limit, offset, "inbox")
		if err != nil {
			return ErrMsg{Err: err}
		}
		return EmailsFetched{Emails: resp.Emails, Total: resp.Total}
	}
}

// fetchEmail fetches a single email with full content
func fetchEmail(client *api.Client, id int) tea.Cmd {
	return func() tea.Msg {
		email, err := client.GetEmail(id)
		if err != nil {
			return ErrMsg{Err: err}
		}
		return EmailFetched{Email: *email}
	}
}

// markRead marks an email as read
func markRead(client *api.Client, id int) tea.Cmd {
	return func() tea.Msg {
		if err := client.MarkAsRead(id); err != nil {
			return ErrMsg{Err: err}
		}
		return EmailMarked{ID: id}
	}
}

// deleteEmail soft-deletes an email
func deleteEmail(client *api.Client, id int) tea.Cmd {
	return func() tea.Msg {
		if err := client.DeleteEmail(id, false); err != nil {
			return ErrMsg{Err: err}
		}
		return EmailDeleted{ID: id}
	}
}
