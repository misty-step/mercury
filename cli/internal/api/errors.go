// Package api provides HTTP client for Mercury Mail API.
package api

import "fmt"

// APIError represents an error response from the Mercury API.
// It preserves the HTTP status code for programmatic handling
// (e.g., retry on 429, re-auth on 401, report not found on 404).
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("server returned %d: %s", e.StatusCode, e.Message)
}

// IsNotFound returns true if the error is a 404.
func (e *APIError) IsNotFound() bool {
	return e.StatusCode == 404
}

// IsUnauthorized returns true if the error is a 401.
func (e *APIError) IsUnauthorized() bool {
	return e.StatusCode == 401
}

// IsRateLimited returns true if the error is a 429.
func (e *APIError) IsRateLimited() bool {
	return e.StatusCode == 429
}
