package api

type Email struct {
	ID         int    `json:"id"`
	MessageID  string `json:"message_id"`
	Sender     string `json:"sender"`
	Recipient  string `json:"recipient"`
	Subject    string `json:"subject"`
	ReceivedAt string `json:"received_at"`
	IsRead     int    `json:"is_read"`
	IsStarred  int    `json:"is_starred"`
	Folder     string `json:"folder"`
	BodyText   string `json:"body_text"`
	BodyHTML   string `json:"body_html"`
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
