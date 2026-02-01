# Mercury CLI

A command-line client for Mercury Mail servers.

## Installation

### Quick Install

```bash
# Copy to your PATH
sudo cp cli/mercury /usr/local/bin/
# or
cp cli/mercury ~/.local/bin/
```

### From Source

```bash
git clone https://github.com/misty-step/mercury.git
cd mercury
chmod +x cli/mercury
./cli/mercury help
```

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
```

## Requirements

- `bash` (4.0+)
- `curl`
- `jq`
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
