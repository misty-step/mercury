package tui

import "github.com/misty-step/mercury/cli/internal/api"

type EmailsFetched struct {
	Emails []api.Email
	Total  int
}

type EmailFetched struct {
	Email api.Email
}

type EmailMarked struct {
	ID int
}

type EmailDeleted struct {
	ID int
}

type EditorClosed struct {
	TmpFile string
	Err     error
}

type EmailSent struct {
	MessageID string
}

type ErrMsg struct {
	Err error
}

func (e ErrMsg) Error() string {
	if e.Err == nil {
		return ""
	}
	return e.Err.Error()
}
