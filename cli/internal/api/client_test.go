package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAPIError(t *testing.T) {
	err := &APIError{StatusCode: 404, Message: "not found"}

	if !err.IsNotFound() {
		t.Error("expected IsNotFound to return true for 404")
	}
	if err.IsUnauthorized() {
		t.Error("expected IsUnauthorized to return false for 404")
	}
	if err.Error() != "server returned 404: not found" {
		t.Errorf("unexpected error string: %s", err.Error())
	}
}

func TestClientDoReturnsAPIErrorWithStatusCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid token"})
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	_, err := client.Do(http.MethodGet, "/test", nil)

	if err == nil {
		t.Fatal("expected error")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if !apiErr.IsUnauthorized() {
		t.Errorf("expected 401, got %d", apiErr.StatusCode)
	}
}

func TestClientGetJSONHandlesEmptyBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	var result map[string]interface{}
	err := client.getJSON("/test", &result)

	if err != nil {
		t.Errorf("expected no error for 204, got: %v", err)
	}
}

func TestClientDoContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := client.DoContext(ctx, http.MethodGet, "/test", nil)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestAPIErrorBoundedRead(t *testing.T) {
	largeBody := make([]byte, 2<<20)
	for i := range largeBody {
		largeBody[i] = 'x'
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write(largeBody)
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	_, err := client.Do(http.MethodGet, "/test", nil)

	if err == nil {
		t.Fatal("expected error")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if len(apiErr.Message) > maxErrorBodySize+100 {
		t.Errorf("error message not bounded: %d bytes", len(apiErr.Message))
	}
}

func TestClientUpdateEmail(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("expected PATCH, got %s", r.Method)
		}
		if !strings.HasPrefix(r.URL.Path, "/emails/") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	read := true
	err := client.UpdateEmail(42, EmailUpdate{IsRead: &read})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if receivedBody["is_read"] != true {
		t.Errorf("expected is_read=true, got %v", receivedBody["is_read"])
	}
}

func TestClientMarkAsRead(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/emails/123" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}))
	defer server.Close()

	client := NewClientNoAuth(server.URL)
	err := client.MarkAsRead(123)

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !called {
		t.Error("server was not called")
	}
}
