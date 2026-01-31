#!/bin/bash
# Cloudflare Mailbox Sync Script
# Syncs emails from Cloudflare D1 to local maildir format
#
# Usage: ./sync.sh
# Requires: MAILBOX_API_URL and MAILBOX_API_SECRET environment variables

set -euo pipefail

# Configuration
MAILDIR="${MAILBOX_MAILDIR:-$HOME/.mail/inbox}"
API_URL="${MAILBOX_API_URL:?Please set MAILBOX_API_URL}"
API_SECRET="${MAILBOX_API_SECRET:?Please set MAILBOX_API_SECRET}"
STATE_FILE="${MAILBOX_STATE_FILE:-$HOME/.config/cloudflare-mailbox/sync-state.json}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Ensure directories exist
mkdir -p "$MAILDIR"/{cur,new,tmp}
mkdir -p "$(dirname "$STATE_FILE")"

# Initialize state file if needed
if [[ ! -f "$STATE_FILE" ]]; then
  echo '{"last_sync": "1970-01-01T00:00:00Z"}' > "$STATE_FILE"
fi

# Get last sync time
LAST_SYNC=$(jq -r '.last_sync // "1970-01-01T00:00:00Z"' "$STATE_FILE")
log_info "Last sync: $LAST_SYNC"

# Fetch unsynced emails
log_info "Fetching new emails..."
RESPONSE=$(curl -sf -X GET "${API_URL}/emails?unsynced=true&limit=100" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json") || {
    log_error "Failed to fetch emails from API"
    exit 1
  }

EMAIL_COUNT=$(echo "$RESPONSE" | jq '.emails | length')
log_info "Found $EMAIL_COUNT new email(s)"

if [[ "$EMAIL_COUNT" -eq 0 ]]; then
  log_info "No new emails to sync"
  exit 0
fi

# Process each email
SYNCED=0
echo "$RESPONSE" | jq -c '.emails[]' | while read -r email; do
  ID=$(echo "$email" | jq -r '.id')
  MESSAGE_ID=$(echo "$email" | jq -r '.message_id')
  SUBJECT=$(echo "$email" | jq -r '.subject')
  
  log_info "Syncing: $SUBJECT"
  
  # Fetch full email content
  FULL_EMAIL=$(curl -sf -X GET "${API_URL}/emails/${ID}" \
    -H "Authorization: Bearer $API_SECRET" \
    -H "Content-Type: application/json") || {
      log_warn "Failed to fetch email $ID, skipping"
      continue
    }
  
  # Generate maildir filename
  # Format: timestamp.unique.hostname:2,flags
  TIMESTAMP=$(date +%s)
  UNIQUE=$(echo "$MESSAGE_ID" | md5sum | cut -c1-16)
  HOSTNAME=$(hostname -s)
  FLAGS=""
  
  IS_READ=$(echo "$email" | jq -r '.is_read')
  IS_STARRED=$(echo "$email" | jq -r '.is_starred')
  [[ "$IS_READ" == "1" ]] && FLAGS+="S"
  [[ "$IS_STARRED" == "1" ]] && FLAGS+="F"
  
  if [[ -n "$FLAGS" ]]; then
    FILENAME="${TIMESTAMP}.${UNIQUE}.${HOSTNAME}:2,${FLAGS}"
    DEST_DIR="$MAILDIR/cur"
  else
    FILENAME="${TIMESTAMP}.${UNIQUE}.${HOSTNAME}"
    DEST_DIR="$MAILDIR/new"
  fi
  
  # Write to maildir
  echo "$FULL_EMAIL" | jq -r '.email.raw_email' > "$DEST_DIR/$FILENAME"
  
  # Mark as synced in API
  curl -sf -X PATCH "${API_URL}/emails/${ID}" \
    -H "Authorization: Bearer $API_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"mark_synced": true}' > /dev/null || {
      log_warn "Failed to mark email $ID as synced"
    }
  
  ((SYNCED++)) || true
done

# Update state
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"last_sync\": \"$NOW\"}" > "$STATE_FILE"

log_info "Sync complete! Synced $EMAIL_COUNT email(s)"
