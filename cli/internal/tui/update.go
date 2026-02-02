package tui

import (
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.status != "" {
			m.status = ""
		}
		switch {
		case key.Matches(msg, keys.Quit):
			return m, tea.Quit
		case key.Matches(msg, keys.Tab):
			if m.focus == focusList {
				m.focus = focusPreview
			} else {
				m.focus = focusList
			}
			return m, nil
		case key.Matches(msg, keys.Refresh):
			m.loading = true
			m.err = nil
			return m, tea.Batch(fetchEmails(m.client, 50, 0), m.spinner.Tick)
		case key.Matches(msg, keys.MarkRead):
			if selected := m.list.SelectedEmail(); selected != nil && selected.IsRead == 0 {
				m.loading = true
				m.err = nil
				return m, tea.Batch(markRead(m.client, selected.ID), m.spinner.Tick)
			}
			return m, nil
		case key.Matches(msg, keys.Delete):
			if selected := m.list.SelectedEmail(); selected != nil {
				m.loading = true
				m.err = nil
				return m, tea.Batch(deleteEmail(m.client, selected.ID), m.spinner.Tick)
			}
			return m, nil
		case key.Matches(msg, keys.Compose):
			m.err = nil
			return startCompose(m, "", "", nil)
		case key.Matches(msg, keys.Reply):
			m.err = nil
			return startReply(m, m.currentEmail)
		}

		if m.focus == focusList {
			switch {
			case key.Matches(msg, keys.Up), key.Matches(msg, keys.Down):
				var cmd tea.Cmd
				m.list, cmd = m.list.Update(msg)
				if selected := m.list.SelectedEmail(); selected != nil {
					m.selected = m.list.Index()
					if m.currentEmail == nil || m.currentEmail.ID != selected.ID {
						m.loading = true
						m.err = nil
						return m, tea.Batch(cmd, fetchEmail(m.client, selected.ID), m.spinner.Tick)
					}
				}
				return m, cmd
			case key.Matches(msg, keys.Enter):
				m.focus = focusPreview
				return m, nil
			default:
				var cmd tea.Cmd
				m.list, cmd = m.list.Update(msg)
				return m, cmd
			}
		}

		var cmd tea.Cmd
		m.preview, cmd = m.preview.Update(msg)
		return m, cmd

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.help.Width = m.width
		statusHeight := lipgloss.Height(m.statusView())
		contentHeight := m.height - statusHeight
		if contentHeight < 0 {
			contentHeight = 0
		}
		listWidth := m.width / 3
		previewWidth := m.width - listWidth - 2
		listHeight := contentHeight - 2
		if listHeight < 0 {
			listHeight = 0
		}
		m.list.SetSize(listWidth, listHeight)
		m.preview.SetSize(previewWidth, listHeight)
		return m, nil

	case EmailsFetched:
		m.loading = false
		m.err = nil
		m.emails = msg.Emails
		m.list.SetEmails(msg.Emails)
		if len(m.emails) == 0 {
			m.selected = 0
			m.currentEmail = nil
			m.preview.SetEmail(nil)
			return m, nil
		}
		if m.selected < 0 || m.selected >= len(m.emails) {
			m.selected = 0
		}
		m.list.SetIndex(m.selected)
		m.loading = true
		return m, tea.Batch(fetchEmail(m.client, m.emails[m.selected].ID), m.spinner.Tick)

	case EmailFetched:
		m.loading = false
		m.err = nil
		if selected := m.list.SelectedEmail(); selected != nil && selected.ID != msg.Email.ID {
			return m, nil
		}
		email := msg.Email
		m.currentEmail = &email
		m.preview.SetEmail(&email)
		return m, nil

	case EmailMarked:
		m.loading = false
		m.err = nil
		for i := range m.emails {
			if m.emails[i].ID == msg.ID {
				m.emails[i].IsRead = 1
				break
			}
		}
		if m.currentEmail != nil && m.currentEmail.ID == msg.ID {
			m.currentEmail.IsRead = 1
		}
		m.list.SetEmails(m.emails)
		if m.selected >= 0 && m.selected < len(m.emails) {
			m.list.SetIndex(m.selected)
		}
		return m, nil

	case EmailDeleted:
		m.loading = false
		m.err = nil
		idx := -1
		for i, email := range m.emails {
			if email.ID == msg.ID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return m, nil
		}
		m.emails = append(m.emails[:idx], m.emails[idx+1:]...)
		if len(m.emails) == 0 {
			m.selected = 0
			m.currentEmail = nil
			m.list.SetEmails(nil)
			m.preview.SetEmail(nil)
			return m, nil
		}
		if idx >= len(m.emails) {
			idx = len(m.emails) - 1
		}
		m.selected = idx
		m.list.SetEmails(m.emails)
		m.list.SetIndex(m.selected)
		m.currentEmail = nil
		m.preview.SetEmail(nil)
		m.loading = true
		return m, tea.Batch(fetchEmail(m.client, m.emails[idx].ID), m.spinner.Tick)

	case EditorClosed:
		return handleEditorClose(m, msg.TmpFile, msg.Err)

	case EmailSent:
		m.loading = true
		m.err = nil
		m.status = "Sent " + msg.MessageID
		return m, tea.Batch(fetchEmails(m.client, 50, 0), m.spinner.Tick)

	case ErrMsg:
		m.loading = false
		m.err = msg.Err
		m.status = ""
		return m, nil

	case spinner.TickMsg:
		if !m.loading {
			return m, nil
		}
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}

	return m, nil
}
