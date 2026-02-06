package auth

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/misty-step/mercury/cli/internal/config"
)

func TestGetSecretForProfile_DirectKey(t *testing.T) {
	profile := &config.Profile{
		Email:  "test@example.com",
		APIKey: "test-api-key",
	}

	secret, err := GetSecretForProfile(profile)
	if err != nil {
		t.Fatalf("GetSecretForProfile() error = %v", err)
	}
	if secret != "test-api-key" {
		t.Errorf("secret = %q, want %q", secret, "test-api-key")
	}
}

func TestGetSecret_WithEnvVar(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MERCURY_PROFILE", "")
	t.Setenv("MERCURY_API_SECRET", "env-secret")

	secret, err := GetSecret()
	if err != nil {
		t.Fatalf("GetSecret() error = %v", err)
	}
	if secret != "env-secret" {
		t.Errorf("secret = %q, want %q", secret, "env-secret")
	}
}

func TestGetSecretFromEnvWithWhitespace(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MERCURY_PROFILE", "")
	t.Setenv("MERCURY_API_SECRET", "  secret-with-spaces  ")

	secret, err := GetSecret()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if secret != "secret-with-spaces" {
		t.Errorf("expected trimmed secret, got %q", secret)
	}
}

func TestGetSecretEmptyEnvFallsBackTo1Password(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("MERCURY_PROFILE", "")
	t.Setenv("MERCURY_API_SECRET", "")

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
