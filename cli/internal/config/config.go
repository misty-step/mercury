package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Profile represents a Mercury account configuration
type Profile struct {
	Email   string `toml:"email"`
	APIKey  string `toml:"api_key,omitempty"`
	OPItem  string `toml:"op_item,omitempty"`
	OPField string `toml:"op_field,omitempty"`
}

// Config represents the Mercury CLI configuration
type Config struct {
	Default  string             `toml:"default"`
	Profiles map[string]Profile `toml:"profiles"`
}

// ConfigPath returns the path to the config file.
var ConfigPath = func() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "mercury", "config.toml")
}

// Load reads the config file, returning empty Config if not exists
func Load() (*Config, error) {
	path := ConfigPath()
	cfg := &Config{Profiles: make(map[string]Profile)}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return cfg, nil
	}

	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.Default != "" {
		if _, ok := cfg.Profiles[cfg.Default]; !ok {
			return nil, fmt.Errorf("default profile %q not found in config", cfg.Default)
		}
	}

	return cfg, nil
}

// Save writes the config file.
func Save(cfg *Config) error {
	path := ConfigPath()

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create config file: %w", err)
	}
	defer f.Close()

	encoder := toml.NewEncoder(f)
	if err := encoder.Encode(cfg); err != nil {
		return fmt.Errorf("encode config: %w", err)
	}

	return nil
}

// GetProfile returns the named profile
func (c *Config) GetProfile(name string) (*Profile, error) {
	if p, ok := c.Profiles[name]; ok {
		return &p, nil
	}
	return nil, fmt.Errorf("profile not found: %s", name)
}

// DefaultProfile returns the default profile
func (c *Config) DefaultProfile() (*Profile, error) {
	if c.Default == "" {
		return nil, fmt.Errorf("no default profile set")
	}
	return c.GetProfile(c.Default)
}
