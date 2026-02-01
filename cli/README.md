# Mercury CLI

Go-based CLI for Mercury Mail servers.

## Installation

### From Source

```bash
git clone https://github.com/misty-step/mercury.git
cd mercury/cli
go build -o mercury
./mercury --help
```

### Legacy Bash CLI

The previous Bash script lives at `cli/mercury-legacy`.

## Configuration

### API Secret

The CLI needs an API secret to authenticate. You have two options:

**Option 1: Environment Variable**

```bash
export MERCURY_API_SECRET="your-secret-here"
```

**Option 2: 1Password Integration**

```bash
# The CLI automatically reads from 1Password if available
# Store your secret at: op://Personal/Mercury Mail API/API_SECRET
eval $(op signin)
mercury inbox  # Works automatically
```

### Server URL

```bash
# Default: https://mail-api.mistystep.io
export MERCURY_API_URL="https://your-mercury-server.com"
```

## Usage

```bash
# Check inbox
mercury inbox           # Latest 20 emails
mercury inbox 50        # Latest 50 emails
mercury inbox 20 40     # 20 emails, offset by 40

# Read email
mercury read 1          # Read email #1

# Send email (interactive)
mercury send

# Send email (scripted)
echo "Hello world" | mercury send me@example.com them@example.com "Subject"

# Reply to email
mercury reply 1

# Delete email
mercury delete 1

# Server health check
mercury health

# Mailbox statistics
mercury stats

# Custom server URL
mercury --api-url https://your-mercury-server.com health
```

## Requirements

- Go 1.22+
- `op` (optional, for 1Password integration)

## Examples

### Check for new mail in a script

```bash
#!/bin/bash
count=$(mercury inbox 1 | grep -c "^●")
if [ "$count" -gt 0 ]; then
  echo "You have unread mail!"
fi
```

### Forward emails matching a pattern

```bash
mercury inbox 100 | grep "Important" | awk '{print $2}' | tr -d '[]' | while read id; do
  mercury read "$id"
done
```

## License

MIT
