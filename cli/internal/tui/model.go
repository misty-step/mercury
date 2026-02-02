package tui

import (
	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/misty-step/mercury/cli/internal/api"
)

type focus int

const (
	focusList focus = iota
	focusPreview
)

type Model struct {
	focus        focus
	width        int
	height       int
	list         ListModel
	preview      PreviewModel
	emails       []api.Email
	selected     int
	currentEmail *api.Email
	err          error
	status       string
	loading      bool
	spinner      spinner.Model
	client       *api.Client
	help         help.Model
	compose      *ComposeState
}

func NewModel(client *api.Client) Model {
	spin := spinner.New()
	spin.Spinner = spinner.Line
	spin.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("69"))
	return Model{
		focus:   focusList,
		list:    NewListModel(0, 0),
		preview: NewPreviewModel(0, 0),
		loading: true,
		spinner: spin,
		client:  client,
		help:    help.New(),
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(fetchEmails(m.client, 50, 0), m.spinner.Tick)
}
