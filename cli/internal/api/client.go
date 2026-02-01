package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/misty-step/mercury/cli/internal/auth"
)

const defaultBaseURL = "https://mail-api.mistystep.io"
const maxErrorBodySize = 1 << 20 // 1MB

type Client struct {
	BaseURL string
	Secret  string
	HTTP    *http.Client
}

func BaseURLFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("MERCURY_API_URL")); v != "" {
		return v
	}
	return defaultBaseURL
}

func NewClient(baseURL string) (*Client, error) {
	secret, err := auth.GetSecret()
	if err != nil {
		return nil, err
	}
	return newClient(baseURL, secret), nil
}

func NewClientNoAuth(baseURL string) *Client {
	return newClient(baseURL, "")
}

func newClient(baseURL, secret string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = BaseURLFromEnv()
	}
	baseURL = strings.TrimRight(baseURL, "/")

	if secret != "" && !strings.HasPrefix(baseURL, "https://") {
		if !strings.Contains(baseURL, "localhost") && !strings.Contains(baseURL, "127.0.0.1") {
			fmt.Fprintf(os.Stderr, "Warning: API secret will be sent over insecure connection to %s\n", baseURL)
		}
	}

	return &Client{
		BaseURL: baseURL,
		Secret:  secret,
		HTTP: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *Client) Do(method, path string, body interface{}) (*http.Response, error) {
	return c.DoContext(context.Background(), method, path, body)
}

func (c *Client) DoContext(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	fullURL := c.BaseURL + path

	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, reader)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	if c.Secret != "" {
		req.Header.Set("Authorization", "Bearer "+c.Secret)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		return nil, apiError(resp)
	}

	return resp, nil
}

func (c *Client) ListEmails(limit, offset int, folder string) (*EmailListResponse, error) {
	values := url.Values{}
	values.Set("limit", strconv.Itoa(limit))
	values.Set("offset", strconv.Itoa(offset))
	if strings.TrimSpace(folder) != "" {
		values.Set("folder", folder)
	}

	path := "/emails?" + values.Encode()
	var resp EmailListResponse
	if err := c.getJSON(path, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) GetEmail(id int) (*Email, error) {
	path := fmt.Sprintf("/emails/%d", id)
	var resp EmailResponse
	if err := c.getJSON(path, &resp); err != nil {
		return nil, err
	}
	return &resp.Email, nil
}

func (c *Client) SendEmail(req *SendRequest) (*SendResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("send request required")
	}

	resp, err := c.Do(http.MethodPost, "/send", req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var payload SendResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &payload, nil
}

func (c *Client) DeleteEmail(id int, permanent bool) error {
	path := fmt.Sprintf("/emails/%d", id)
	if permanent {
		path += "?permanent=true"
	}

	resp, err := c.Do(http.MethodDelete, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// UpdateEmail updates an email's metadata (read status, star, folder).
func (c *Client) UpdateEmail(id int, updates EmailUpdate) error {
	path := fmt.Sprintf("/emails/%d", id)
	resp, err := c.Do(http.MethodPatch, path, updates)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// MarkAsRead marks an email as read.
func (c *Client) MarkAsRead(id int) error {
	read := true
	return c.UpdateEmail(id, EmailUpdate{IsRead: &read})
}

func (c *Client) GetStats() (*Stats, error) {
	var resp StatsResponse
	if err := c.getJSON("/stats", &resp); err != nil {
		return nil, err
	}
	return &resp.Stats, nil
}

func (c *Client) Health() (*HealthResponse, error) {
	var resp HealthResponse
	if err := c.getJSON("/health", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) getJSON(path string, out interface{}) error {
	resp, err := c.Do(http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent || resp.ContentLength == 0 {
		return nil
	}

	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		if err == io.EOF {
			return nil
		}
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func apiError(resp *http.Response) *APIError {
	limited := io.LimitReader(resp.Body, maxErrorBodySize)
	body, _ := io.ReadAll(limited)
	message := strings.TrimSpace(string(body))

	if len(body) > 0 {
		var payload struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(body, &payload); err == nil {
			if payload.Error != "" {
				message = payload.Error
			} else if payload.Message != "" {
				message = payload.Message
			}
		}
	}

	if message == "" {
		message = http.StatusText(resp.StatusCode)
	}

	return &APIError{StatusCode: resp.StatusCode, Message: message}
}
