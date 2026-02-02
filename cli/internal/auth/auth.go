package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/misty-step/mercury/cli/internal/config"
)

// opTimeout is the maximum time to wait for 1Password CLI.
const opTimeout = 10 * time.Second

// GetSecret retrieves the Mercury API secret, checking profile first.
func GetSecret() (string, error) {
	if s := envSecret(); s != "" {
		return s, nil
	}

	profileName := strings.TrimSpace(os.Getenv("MERCURY_PROFILE"))
	if profileName != "" {
		cfg, err := config.Load()
		if err != nil {
			return "", fmt.Errorf("load config: %w", err)
		}
		profile, err := cfg.GetProfile(profileName)
		if err != nil {
			return "", err
		}
		return GetSecretForProfile(profile)
	}

	cfg, err := config.Load()
	if err == nil && cfg.Default != "" {
		if profile, err := cfg.DefaultProfile(); err == nil {
			if secret, err := GetSecretForProfile(profile); err == nil {
				return secret, nil
			}
		}
	}

	return getSecretFrom1Password()
}

// GetSecretForProfile retrieves the API secret for a specific profile.
func GetSecretForProfile(profile *config.Profile) (string, error) {
	if profile.APIKey != "" {
		return profile.APIKey, nil
	}

	if profile.OPItem != "" && profile.OPField != "" {
		return getSecretFromProfile1Password(profile.OPItem, profile.OPField)
	}

	if s := envSecret(); s != "" {
		return s, nil
	}

	return getSecretFrom1Password()
}

func envSecret() string {
	return strings.TrimSpace(os.Getenv("MERCURY_API_SECRET"))
}

func getSecretFromProfile1Password(item, field string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	ref := fmt.Sprintf("op://Personal/%s/%s", item, field)
	cmd := exec.CommandContext(ctx, "op", "read", ref)
	out, err := cmd.Output()
	if err != nil {
		return "", formatAuthError(err)
	}

	secret := strings.TrimSpace(string(out))
	if secret == "" {
		return "", fmt.Errorf("1Password returned empty secret for %s/%s", item, field)
	}

	return secret, nil
}

func getSecretFrom1Password() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "op", "read", "op://Personal/Mercury Mail API/API_SECRET")
	out, err := cmd.Output()
	if err != nil {
		return "", formatAuthError(err)
	}

	secret := strings.TrimSpace(string(out))
	if secret == "" {
		return "", fmt.Errorf("1Password returned empty secret\n\nSet MERCURY_API_SECRET environment variable or check your 1Password vault")
	}

	return secret, nil
}

func formatAuthError(err error) error {
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("1Password CLI not found\n\nTo authenticate, either:\n  - Set MERCURY_API_SECRET environment variable\n  - Install 1Password CLI: brew install 1password-cli")
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("1Password CLI timed out\n\nTry running: op signin")
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		stderr := strings.TrimSpace(string(exitErr.Stderr))
		if strings.Contains(stderr, "not signed in") || strings.Contains(stderr, "session expired") {
			return fmt.Errorf("1Password session expired\n\nRun: op signin")
		}
		if stderr != "" {
			return fmt.Errorf("1Password error: %s\n\nAlternatively, set MERCURY_API_SECRET environment variable", stderr)
		}
	}

	return fmt.Errorf("failed to get secret from 1Password: %w\n\nSet MERCURY_API_SECRET environment variable instead", err)
}
