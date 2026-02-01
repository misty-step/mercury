# Mercury Mail Vision: Sovereignty Roadmap

Path to maximum email sovereignty. Direct. Technical. Tradeoffs explicit.

## 1. Current State: 80% Sovereign

| You own                         | You depend on            |
| ------------------------------- | ------------------------ |
| Domain + DNS zone               | Registrar                |
| Email addresses + routing rules | Cloudflare Workers       |
| Email data (exportable SQLite)  | Cloudflare D1            |
| Code + deployment config        | Cloudflare Email Routing |
| API surface + auth              | Resend (outbound SMTP)   |

Risk assessment

- Infra vendors rarely ban for content. Risk low, not zero.
- Higher risk: abuse complaints, deliverability throttling, ToS drift.
- Single points: registrar, Cloudflare account, Resend key.

## 2. Phase 2: Self-Hosted SMTP Sending

Goal: remove Resend. Own outbound SMTP on VPS.

Requirements

- VPS with port 25 outbound open.
- DNS: SPF, DKIM, DMARC.
- PTR (reverse DNS) set by VPS provider.
- IP warm-up plan. Monitor bounces + blocklists.

Tech options
| MTA | Language | Ops load | Notes |
| --- | --- | --- | --- |
| Maddy | Go | Low | All-in-one, modern defaults |
| Stalwart | Rust | Medium | Fast, feature-rich, active dev |
| Postfix | C | Medium | Battle-tested, more manual wiring |

DNS records (example)

```
; zone: example.com
@   TXT  "v=spf1 ip4:203.0.113.10 -all"
dkim._domainkey TXT "v=DKIM1; k=rsa; p=REPLACE_WITH_PUBLIC_KEY"
_dmarc TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; ruf=mailto:dmarc@example.com; fo=1"
```

## 3. Phase 3: Self-Hosted SMTP Receiving

Goal: remove Cloudflare Email Routing. Own MX server.

Challenge: inbound port 25. Many clouds block it.

Providers known to allow inbound 25
| Provider | Notes |
| --- | --- |
| Hetzner | Usually open, still abuse-sensitive |
| OVH | Often open, reputation matters |
| Vultr | Sometimes open, may need approval |

Spam filtering required

- Rspamd or built-in filters.
- Greylisting + rate limits.
- Quarantine flow, not hard rejects.

## 4. Phase 4: Registrar Independence

Domain = single point of failure.

Registrar options
| Registrar | Strengths | Risks |
| --- | --- | --- |
| Njalla | Privacy, proxy ownership | Smaller org, opaque |
| 1984 Hosting | Privacy + policy stance | Limited support footprint |
| Gandi | Established, stable | Policy changes possible |

Backup domain strategy

- Keep a secondary domain warm (DNS + SPF/DKIM ready).
- Mirror MX + API config.
- Document fast cutover steps.

## 5. Decision Framework

| If you are…                                 | Do this         |
| ------------------------------------------- | --------------- |
| Low volume, want zero ops, $0/month matters | Stay at 80%     |
| High volume, need delivery control          | Move to Phase 2 |
| Need independence from routing providers    | Move to Phase 3 |
| Sovereignty non-negotiable                  | Full self-host  |

## 6. Technology Reference

Recommended full self-host stack

- VPS: primary + standby. Separate regions.
- MTA: Stalwart or Maddy.
- Spam: Rspamd.
- TLS: Let’s Encrypt.
- Monitoring: SMTP queue depth, bounce rate, blocklist checks.
- Backups: D1 export + MTA configs + DKIM keys.

DNS records required (summary)
| Record | Purpose |
| --- | --- |
| MX | Mail exchanger for inbound |
| SPF | Authorized outbound IPs |
| DKIM | Message signing |
| DMARC | Policy + reporting |
| PTR | Reverse DNS for sending IP |

### Maddy quick start (outline)

```
# /etc/maddy/maddy.conf (outline, verify for your version)
hostname example.com
tls {
  cert /etc/letsencrypt/live/mx.example.com/fullchain.pem
  key  /etc/letsencrypt/live/mx.example.com/privkey.pem
}

smtp tcp://0.0.0.0:25 {
  dkim example.com {
    selector maddy
    key /etc/maddy/dkim.key
  }
  default_source {
    deliver_to &remote_queue
  }
}

target.remote_queue {
  # outbound only
}
```

### Stalwart quick start (outline)

```
# /etc/stalwart/smtp.toml (outline, verify for your version)
[server]
hostname = "example.com"
listen = ["0.0.0.0:25"]

[tls]
cert = "/etc/letsencrypt/live/mx.example.com/fullchain.pem"
key  = "/etc/letsencrypt/live/mx.example.com/privkey.pem"

[dkim]
domain = "example.com"
selector = "stalwart"
key_path = "/etc/stalwart/dkim.key"

[outbound]
queue = true
```

Full self-host = full responsibility: abuse handling, uptime, patching, deliverability.
