package auth

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func GetSecret() (string, error) {
	if s := strings.TrimSpace(os.Getenv("MERCURY_API_SECRET")); s != "" {
		return s, nil
	}

	out, err := exec.Command("op", "read", "op://Personal/Mercury Mail API/API_SECRET").Output()
	if err != nil {
		return "", fmt.Errorf("MERCURY_API_SECRET not set and 1Password failed: %w", err)
	}

	secret := strings.TrimSpace(string(out))
	if secret == "" {
		return "", fmt.Errorf("MERCURY_API_SECRET not set and 1Password returned empty value")
	}

	return secret, nil
}
