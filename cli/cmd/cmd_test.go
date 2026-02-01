package cmd

import (
	"os"
	"testing"
)

func TestNormalizeReplySubject(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Hello", "Re: Hello"},
		{"Re: Hello", "Re: Hello"},
		{"RE: Hello", "Re: Hello"},
		{"re: Hello", "Re: Hello"},
		{"Re: Re: Hello", "Re: Hello"},
		{"RE: RE: RE: Hello", "Re: Hello"},
		{"Re:Hello", "Re: Hello"},
		{"", "Re: "},
	}

	for _, tt := range tests {
		got := normalizeReplySubject(tt.input)
		if got != tt.want {
			t.Errorf("normalizeReplySubject(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestExtractEmailAddress(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"john@example.com", "john@example.com"},
		{"John Doe <john@example.com>", "john@example.com"},
		{"<jane@test.org>", "jane@test.org"},
		{"", ""},
		{"not an email", ""},
		{"  alice@foo.bar  ", "alice@foo.bar"},
	}

	for _, tt := range tests {
		got := extractEmailAddress(tt.input)
		if got != tt.want {
			t.Errorf("extractEmailAddress(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestGetDefaultFrom(t *testing.T) {
	original := os.Getenv("MERCURY_FROM")
	defer os.Setenv("MERCURY_FROM", original)

	if err := os.Setenv("MERCURY_FROM", ""); err != nil {
		t.Fatalf("set env: %v", err)
	}
	if got := getDefaultFrom(); got != "" {
		t.Errorf("expected empty, got %q", got)
	}

	if err := os.Setenv("MERCURY_FROM", "test@example.com"); err != nil {
		t.Fatalf("set env: %v", err)
	}
	if got := getDefaultFrom(); got != "test@example.com" {
		t.Errorf("expected test@example.com, got %q", got)
	}
}
