package api

import (
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
)

type Email struct {
	ID          int    `json:"id"`
	MessageID   string `json:"message_id"`
	Sender      string `json:"sender"`
	Recipient   string `json:"recipient"`
	Subject     string `json:"subject"`
	ReceivedAt  string `json:"received_at"`
	IsRead      int    `json:"is_read"`
	IsStarred   int    `json:"is_starred"`
	Folder      string `json:"folder"`
	RawEmail    string `json:"raw_email,omitempty"`
	HeadersJSON string `json:"headers_json,omitempty"`
}

// EmailUpdate represents fields that can be updated on an email.
type EmailUpdate struct {
	IsRead     *bool   `json:"is_read,omitempty"`
	IsStarred  *bool   `json:"is_starred,omitempty"`
	Folder     *string `json:"folder,omitempty"`
	MarkSynced bool    `json:"mark_synced,omitempty"`
}

// Body extracts the plain text body from the raw email.
// Returns empty string if raw email is not available or parsing fails.
func (e *Email) Body() string {
	if strings.TrimSpace(e.RawEmail) == "" {
		return ""
	}

	msg, err := mail.ReadMessage(strings.NewReader(e.RawEmail))
	if err != nil {
		return ""
	}

	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || mediaType == "" {
		body, _ := io.ReadAll(msg.Body)
		return strings.TrimSpace(string(body))
	}

	if strings.HasPrefix(mediaType, "text/plain") {
		body, _ := io.ReadAll(msg.Body)
		return decodeBody(body, params["charset"])
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		if text := extractTextFromMultipart(msg.Body, params["boundary"]); text != "" {
			return text
		}
	}

	body, _ := io.ReadAll(msg.Body)
	return strings.TrimSpace(string(body))
}

// Read returns true if the email has been read.
func (e *Email) Read() bool {
	return e.IsRead == 1
}

// Starred returns true if the email is starred.
func (e *Email) Starred() bool {
	return e.IsStarred == 1
}

func extractTextFromMultipart(r io.Reader, boundary string) string {
	if boundary == "" {
		return ""
	}

	mr := multipart.NewReader(r, boundary)
	for {
		part, err := mr.NextPart()
		if err != nil {
			break
		}

		text := func() string {
			defer part.Close()

			ct := part.Header.Get("Content-Type")
			mediaType, params, err := mime.ParseMediaType(ct)
			if err != nil {
				mediaType = ct
			}

			if ct == "" || strings.HasPrefix(mediaType, "text/plain") {
				body, _ := io.ReadAll(part)
				return decodeBody(body, params["charset"])
			}

			if strings.HasPrefix(mediaType, "multipart/") {
				return extractTextFromMultipart(part, params["boundary"])
			}

			return ""
		}()

		if text != "" {
			return text
		}
	}

	return ""
}

func decodeBody(body []byte, charset string) string {
	_ = charset
	return strings.TrimSpace(string(body))
}

type EmailListResponse struct {
	Emails []Email `json:"emails"`
	Total  int     `json:"total"`
	Limit  int     `json:"limit"`
	Offset int     `json:"offset"`
}

type EmailResponse struct {
	Email Email `json:"email"`
}

type SendRequest struct {
	From    string            `json:"from,omitempty"`
	To      string            `json:"to"`
	Subject string            `json:"subject"`
	Text    string            `json:"text,omitempty"`
	HTML    string            `json:"html,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

type SendResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"messageId"`
	Error     string `json:"error,omitempty"`
}

type StatsResponse struct {
	Stats Stats `json:"stats"`
}

type Stats struct {
	Total   int `json:"total"`
	Unread  int `json:"unread"`
	Starred int `json:"starred"`
	Inbox   int `json:"inbox"`
	Trash   int `json:"trash"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Version   string `json:"version"`
}
