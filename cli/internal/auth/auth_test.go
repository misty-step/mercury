package auth

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestGetSecretFromEnv(t *testing.T) {
	original := os.Getenv("MERCURY_API_SECRET")
	defer os.Setenv("MERCURY_API_SECRET", original)

	os.Setenv("MERCURY_API_SECRET", "test-secret-123")

	secret, err := GetSecret()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if secret != "test-secret-123" {
		t.Errorf("expected 'test-secret-123', got %q", secret)
	}
}

func TestGetSecretFromEnvWithWhitespace(t *testing.T) {
	original := os.Getenv("MERCURY_API_SECRET")
	defer os.Setenv("MERCURY_API_SECRET", original)

	os.Setenv("MERCURY_API_SECRET", "  secret-with-spaces  ")

	secret, err := GetSecret()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if secret != "secret-with-spaces" {
		t.Errorf("expected trimmed secret, got %q", secret)
	}
}

func TestGetSecretEmptyEnvFallsBackTo1Password(t *testing.T) {
	original := os.Getenv("MERCURY_API_SECRET")
	defer os.Setenv("MERCURY_API_SECRET", original)

	os.Setenv("MERCURY_API_SECRET", "")

	_, err := GetSecret()
	if err == nil {
		t.Skip("1Password available in test environment")
	}

	errMsg := err.Error()
	if !strings.Contains(errMsg, "MERCURY_API_SECRET") {
		t.Errorf("error should mention MERCURY_API_SECRET env var: %v", err)
	}
}

func TestFormatAuthErrorNotFound(t *testing.T) {
	err := formatAuthError(ErrNotFoundStub)
	errMsg := err.Error()

	if !strings.Contains(errMsg, "1Password CLI not found") {
		t.Errorf("expected 'not found' message, got: %s", errMsg)
	}
	if !strings.Contains(errMsg, "brew install") {
		t.Errorf("expected install instructions, got: %s", errMsg)
	}
}

var ErrNotFoundStub = exec.ErrNotFound
