package tui

import "github.com/charmbracelet/bubbles/key"

type keyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Tab      key.Binding
	Quit     key.Binding
	Refresh  key.Binding
	MarkRead key.Binding
	Delete   key.Binding
	Compose  key.Binding
	Reply    key.Binding
}

var keys = keyMap{
	Up: key.NewBinding(
		key.WithKeys("up", "k"),
		key.WithHelp("↑/k", "up"),
	),
	Down: key.NewBinding(
		key.WithKeys("down", "j"),
		key.WithHelp("↓/j", "down"),
	),
	Enter: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "preview"),
	),
	Tab: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "switch"),
	),
	Quit: key.NewBinding(
		key.WithKeys("q", "ctrl+c"),
		key.WithHelp("q", "quit"),
	),
	Refresh: key.NewBinding(
		key.WithKeys("r"),
		key.WithHelp("r", "refresh"),
	),
	MarkRead: key.NewBinding(
		key.WithKeys("m"),
		key.WithHelp("m", "mark read"),
	),
	Delete: key.NewBinding(
		key.WithKeys("d"),
		key.WithHelp("d", "delete"),
	),
	Compose: key.NewBinding(
		key.WithKeys("c"),
		key.WithHelp("c", "compose"),
	),
	Reply: key.NewBinding(
		key.WithKeys("R"),
		key.WithHelp("R", "reply"),
	),
}

func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Compose, k.Refresh, k.MarkRead, k.Delete, k.Reply, k.Tab, k.Quit}
}

func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Up, k.Down, k.Enter},
		{k.Compose, k.Refresh, k.MarkRead, k.Delete, k.Reply},
		{k.Tab, k.Quit},
	}
}
