package api

import "testing"

func TestEmailBody(t *testing.T) {
	tests := []struct {
		name     string
		rawEmail string
		want     string
	}{
		{
			name:     "empty raw email",
			rawEmail: "",
			want:     "",
		},
		{
			name:     "plain text email",
			rawEmail: "From: test@example.com\r\nTo: recipient@example.com\r\nSubject: Test\r\nContent-Type: text/plain\r\n\r\nHello, World!",
			want:     "Hello, World!",
		},
		{
			name:     "no content-type header",
			rawEmail: "From: test@example.com\r\nSubject: Test\r\n\r\nPlain body here",
			want:     "Plain body here",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &Email{RawEmail: tt.rawEmail}
			got := e.Body()
			if got != tt.want {
				t.Errorf("Body() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEmailReadStarred(t *testing.T) {
	e := &Email{IsRead: 0, IsStarred: 1}

	if e.Read() {
		t.Error("expected Read() = false")
	}
	if !e.Starred() {
		t.Error("expected Starred() = true")
	}

	e.IsRead = 1
	if !e.Read() {
		t.Error("expected Read() = true after setting IsRead=1")
	}
}
