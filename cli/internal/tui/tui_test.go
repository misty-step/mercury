package tui

import (
	"fmt"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/misty-step/mercury/cli/internal/api"
)

// mockClient implements a minimal test client
type mockClient struct {
	emails []api.Email
	email  *api.Email
	err    error
}

func (m *mockClient) ListEmails(limit, offset int, folder string) (*api.EmailListResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &api.EmailListResponse{Emails: m.emails, Total: len(m.emails)}, nil
}

func (m *mockClient) GetEmail(id int) (*api.Email, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.email, nil
}

// Test helpers

func testEmails() []api.Email {
	receivedAt := time.Now().UTC().Format(time.RFC3339)
	return []api.Email{
		{ID: 1, Sender: "alice@example.com", Subject: "Hello", ReceivedAt: receivedAt, IsRead: 0},
		{ID: 2, Sender: "bob@example.com", Subject: "World", ReceivedAt: receivedAt, IsRead: 1},
	}
}

func TestModel_Init(t *testing.T) {
	client := &mockClient{emails: testEmails()}
	if client == nil {
		t.Fatal("client should not be nil")
	}
	// Note: NewModel takes *api.Client, need to adjust for testing
	// For now, test the fetch command directly

	// Verify Init returns a fetch command
	m := NewModel(nil)
	cmd := m.Init()
	if cmd == nil {
		t.Fatal("expected init cmd, got nil")
	}
	// In real impl, Init returns fetchEmails cmd
}

func TestModel_Update_WindowSize(t *testing.T) {
	m := NewModel(nil)

	msg := tea.WindowSizeMsg{Width: 120, Height: 40}
	updated, _ := m.Update(msg)

	model := updated.(Model)
	if model.width != 120 {
		t.Errorf("width = %d, want 120", model.width)
	}
	if model.height != 40 {
		t.Errorf("height = %d, want 40", model.height)
	}
}

func TestModel_Update_Quit(t *testing.T) {
	m := NewModel(nil)

	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}
	_, cmd := m.Update(msg)

	// Quit command should be returned
	if cmd == nil {
		t.Error("expected quit command, got nil")
	}
}

func TestModel_Update_Tab(t *testing.T) {
	m := NewModel(nil)

	// Start with list focus
	if m.focus != focusList {
		t.Fatalf("initial focus = %v, want focusList", m.focus)
	}

	// Tab should switch to preview
	msg := tea.KeyMsg{Type: tea.KeyTab}
	updated, _ := m.Update(msg)
	model := updated.(Model)

	if model.focus != focusPreview {
		t.Errorf("focus after tab = %v, want focusPreview", model.focus)
	}

	// Tab again should switch back
	updated, _ = model.Update(msg)
	model = updated.(Model)

	if model.focus != focusList {
		t.Errorf("focus after second tab = %v, want focusList", model.focus)
	}
}

func TestModel_Update_EmailsFetched(t *testing.T) {
	m := NewModel(nil)
	m.loading = true

	// When emails are fetched with results, loading stays true while fetching first email detail
	emails := testEmails()
	msg := EmailsFetched{Emails: emails, Total: 2}
	updated, _ := m.Update(msg)
	model := updated.(Model)

	if model.err != nil {
		t.Errorf("err should be nil, got %v", model.err)
	}
	if len(model.emails) != 2 {
		t.Errorf("emails count = %d, want 2", len(model.emails))
	}
}

func TestModel_Update_EmailsFetched_Empty(t *testing.T) {
	m := NewModel(nil)
	m.loading = true

	// When no emails, loading should be false
	msg := EmailsFetched{Emails: []api.Email{}, Total: 0}
	updated, _ := m.Update(msg)
	model := updated.(Model)

	if model.loading {
		t.Error("loading should be false after EmailsFetched with no emails")
	}
	if model.err != nil {
		t.Errorf("err should be nil, got %v", model.err)
	}
}

func TestModel_Update_ErrMsg(t *testing.T) {
	m := NewModel(nil)
	m.loading = true

	testErr := fmt.Errorf("test error")
	msg := ErrMsg{Err: testErr}
	updated, _ := m.Update(msg)
	model := updated.(Model)

	if model.loading {
		t.Error("loading should be false after ErrMsg")
	}
	if model.err != testErr {
		t.Errorf("err = %v, want %v", model.err, testErr)
	}
}
