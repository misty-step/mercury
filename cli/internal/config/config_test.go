package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_FileNotExists(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg == nil {
		t.Fatal("Load() returned nil config")
	}
	if cfg.Default != "" {
		t.Fatalf("cfg.Default = %q, want empty", cfg.Default)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("len(cfg.Profiles) = %d, want 0", len(cfg.Profiles))
	}
}

func TestLoad_ValidFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".config", "mercury", "config.toml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	content := `default = "test"

[profiles.test]
email = "test@example.com"
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	originalPath := ConfigPath
	ConfigPath = func() string { return configPath }
	defer func() { ConfigPath = originalPath }()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Default != "test" {
		t.Errorf("Default = %q, want %q", cfg.Default, "test")
	}
	if p, ok := cfg.Profiles["test"]; !ok || p.Email != "test@example.com" {
		t.Errorf("Profiles[test] = %+v, want email=test@example.com", p)
	}
}

func TestLoad_InvalidTOML(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte("invalid toml ["), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	originalPath := ConfigPath
	ConfigPath = func() string { return configPath }
	defer func() { ConfigPath = originalPath }()

	if _, err := Load(); err == nil {
		t.Error("Load() expected error for invalid TOML")
	}
}

func TestSave_WritesFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".config", "mercury", "config.toml")

	originalPath := ConfigPath
	ConfigPath = func() string { return configPath }
	defer func() { ConfigPath = originalPath }()

	cfg := &Config{
		Default: "myprofile",
		Profiles: map[string]Profile{
			"myprofile": {Email: "me@example.com"},
		},
	}

	if err := Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load() after Save() error = %v", err)
	}
	if loaded.Default != cfg.Default {
		t.Errorf("loaded.Default = %q, want %q", loaded.Default, cfg.Default)
	}
}

func TestGetProfile_Found(t *testing.T) {
	cfg := &Config{
		Profiles: map[string]Profile{
			"test": {Email: "test@example.com"},
		},
	}

	p, err := cfg.GetProfile("test")
	if err != nil {
		t.Fatalf("GetProfile() error = %v", err)
	}
	if p.Email != "test@example.com" {
		t.Fatalf("profile email = %q, want %q", p.Email, "test@example.com")
	}
}

func TestGetProfile_NotFound(t *testing.T) {
	cfg := &Config{Profiles: map[string]Profile{}}

	if _, err := cfg.GetProfile("missing"); err == nil {
		t.Fatal("GetProfile() error = nil, want error")
	}
}
