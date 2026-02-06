package tui

import "github.com/charmbracelet/lipgloss"

var (
	focusedBorderColor = lipgloss.Color("69")
	blurredBorderColor = lipgloss.Color("240")
	focusedPanelStyle  = lipgloss.NewStyle().Border(lipgloss.ThickBorder()).BorderForeground(focusedBorderColor)
	blurredPanelStyle  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(blurredBorderColor)
	statusTextStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("242"))
	statusErrorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Bold(true)
	statusBarStyle     = lipgloss.NewStyle()
)

func (m Model) statusView() string {
	if m.width == 0 {
		return ""
	}

	switch {
	case m.err != nil:
		return statusBarStyle.Width(m.width).Render(statusErrorStyle.Render(m.err.Error()))
	case m.loading:
		text := lipgloss.JoinHorizontal(
			lipgloss.Left,
			m.spinner.View(),
			statusTextStyle.Render(" Loading..."),
		)
		return statusBarStyle.Width(m.width).Render(text)
	case m.status != "":
		return statusBarStyle.Width(m.width).Render(statusTextStyle.Render(m.status))
	default:
		return statusBarStyle.Width(m.width).Render(m.help.View(keys))
	}
}

func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}

	statusView := m.statusView()
	statusHeight := lipgloss.Height(statusView)
	contentHeight := m.height - statusHeight
	if contentHeight < 0 {
		contentHeight = 0
	}

	listWidth := m.width / 3
	previewWidth := m.width - listWidth - 2
	if previewWidth < 0 {
		previewWidth = 0
	}

	listStyle := blurredPanelStyle
	previewStyle := blurredPanelStyle
	if m.focus == focusList {
		listStyle = focusedPanelStyle
	}
	if m.focus == focusPreview {
		previewStyle = focusedPanelStyle
	}

	listView := listStyle.Copy().
		Width(listWidth).
		Height(contentHeight).
		Render(m.list.View())

	previewView := previewStyle.Copy().
		Width(previewWidth).
		Height(contentHeight).
		Render(m.preview.View())

	panes := lipgloss.JoinHorizontal(lipgloss.Top, listView, previewView)
	return lipgloss.JoinVertical(lipgloss.Left, panes, statusView)
}
