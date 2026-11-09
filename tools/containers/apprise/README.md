# Apprise notification bridge (Overleaf CE)

A self-contained Apprise REST API container that gives Overleaf CE
access to 100+ notification channels (Telegram, Discord, Slack, ntfy,
Gotify, Pushover, Nextcloud, Signal, WhatsApp, WeChat, Zoom, Zulip,
webhooks, …) through a single `POST /notify` endpoint.

## Why

Overleaf CE ships no notification channel support. The notifications
module dispatches every notification as an Apprise URL:

```
mailto://jane@example.com        email (SMTP defaults from .env)
tg://bot-token/chat-id           Telegram
discord://webhook/id?token=...   Discord
ntfy://host/topic                ntfy
webpush://<b64url(subscription)> browser push
…
```

## Without this container

Overleaf still works — with two built-in fallbacks:

- **Email** — sent directly by the web process via its own SMTP
  transport (nodemailer).
- **Browser push** — signed and sent by the web process via Node
  `web-push` (VAPID keys are owned by Overleaf, stored in
  `notificationSettings`).

This container adds the **third-party channels** (Telegram, Discord,
…). Without it, those channel types fail with a clear error.

## Setup

```bash
cd tools/containers/apprise
cp .env.example .env    # fill in SMTP credentials (optional)
docker compose up -d --build
```

Then point Overleaf at it. Because the apprise container is in its own
compose project (its own network), Overleaf reaches it through the
Docker host — so Overleaf's compose service needs two things:

```yaml
    # Overleaf service (e.g. overleaf/compose.yaml)
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      NOTIFICATIONS_APPRISDE_API_URL: http://host.docker.internal:8001
```

(`host-gateway` resolves to the Docker host IP from inside Overleaf,
e.g. `172.17.0.1`. Alternatively skip `extra_hosts` and use the gateway
IP directly: `NOTIFICATIONS_APPRISDE_API_URL=http://172.17.0.1:8001`.)

Without any of this, Overleaf still works: email goes out via its own
SMTP transport and browser push via its own Web Push — this container
is only needed for the third-party channels.

## API

| Endpoint | Description |
|---|---|
| `POST /notify` | `{url, title, body, format}` → dispatch one notification |
| `GET /status` | version + loaded plugins |

`format` is `markdown` (default) or `html`. A `format: markdown` body
is rendered to HTML by apprise before delivery.

## Notes

- Port `8001` is bound to all interfaces so the Overleaf container can
  reach it through the Docker host. On a public server, restrict it
  with a firewall or bind to `127.0.0.1:8001` and use the gateway IP
  from Overleaf.
- The container is in its own compose project with its own bridge
  network (`apprise-net`) and volume (`apprise-data`). It does not
  require the Overleaf network.
- `server.py` is a minimal stdlib REST wrapper implementing the
  apprise-api `/notify` contract. The image is based on
  `caronc/apprise` with `apprise==1.13.1` (the 2.x line dropped the
  mailto/SMTP plugin) and `webpush` (for the `webpush://` scheme).
