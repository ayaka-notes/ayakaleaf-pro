#!/usr/bin/env python3
"""Minimal Apprise REST API (stdlib only; apprise lib comes from the base image).

Contract-compatible with caronc/appprise-api for the pieces Overleaf uses:

  GET  /status              -> {"status": "ok", ...}
  POST /notify              -> JSON: {"url": "...", "title": "...",
                                      "body": "...", "format": "text|html|markdown",
                                      "type": "info|success|warning|error"}
    -> 200 {"status": 1, "success": N, "error": 0}
    -> 200 {"status": 0, "success": 0, "error": N, "message": "..."}
    -> 400/422 on bad input

SMTP defaults: the `APPRISDE_SMTP_*` env vars (compose .env) are merged into
any `mailto:` URL that does not already set the corresponding parameter, so a
bare `mailto:addr@example.com` sends through the stack's SMTP server. Per-URL
query params always win.
"""

import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit, urlunsplit

import apprise

PORT = int(os.environ.get("APPRISDE_PORT", "8001"))
HOST = os.environ.get("APPRISDE_HOST", "0.0.0.0")

# apprise mailto plugin URL parameters (this apprise build's names) ->
# the compose .env defaults holding their values. Per-URL query params win.
SMTP_DEFAULTS = {
    "smtp": os.environ.get("APPRISDE_SMTP_SERVER", ""),
    "port": os.environ.get("APPRISDE_SMTP_PORT", ""),
    "from": os.environ.get("APPRISDE_SMTP_FROM", ""),
    "user": os.environ.get("APPRISDE_SMTP_USER", ""),
    "pass": os.environ.get("APPRISDE_SMTP_PASS", ""),
    "mode": os.environ.get("APPRISDE_SMTP_MODE", ""),
    "reply": os.environ.get("APPRISDE_SMTP_REPLY", ""),
    "timeout": os.environ.get("APPRISDE_SMTP_TIMEOUT", "30"),
}

log = logging.getLogger("apprise-rest")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# quiet the apprise library's per-attachment logging
logging.getLogger("apprise").setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# Web Push (browser popups). apprise 1.13.1 ships no webpush plugin, so the
# `webpush://` scheme is handled here directly with py-vapid.
#
# URL format:  webpush://<base64url(pushSubscription JSON)>
#   The Overleaf side stores the browser's PushSubscription per user and
#   builds this URL at dispatch time.
#
# Payload: the `body` of /notify is a JSON string
#   {"title": "...", "body": "...", "click_url": "..."}
# which becomes the push payload delivered to the service worker.
#
# VAPID keys: generated once at first start, persisted to APPRISDE_VAPID_FILE
# (a docker volume) so container recreation does not break subscriptions.
# GET /vapid exposes both keys (internal network only) so Overleaf can serve
# the public key to browsers for PushManager.subscribe().
# ---------------------------------------------------------------------------
import base64

VAPID_FILE = os.environ.get("APPRISDE_VAPID_FILE", "/data/vapid.json")
VAPID_SUB = os.environ.get("APPRISDE_VAPID_SUB", "overleaf-notifications")
VAPID_NAME = "Overleaf"


def _load_or_create_vapid():
    """(app_server_key, private_b64, public_b64) — generated once, persisted."""
    from webpush import VAPID

    try:
        with open(VAPID_FILE) as f:
            data = json.load(f)
        if data.get("app_server_key") and data.get("private") and data.get("public"):
            return data["app_server_key"], data["private"], data["public"]
    except Exception:
        pass
    private, public, app_server_key = VAPID.generate_keys()
    out = {
        "app_server_key": app_server_key,
        "private": base64.b64encode(bytes(private)).decode(),
        "public": base64.b64encode(bytes(public)).decode(),
    }
    try:
        os.makedirs(os.path.dirname(VAPID_FILE) or ".", exist_ok=True)
        with open(VAPID_FILE, "w") as f:
            json.dump(out, f)
        os.chmod(VAPID_FILE, 0o600)
    except Exception as e:  # noqa: BLE001
        log.warning("could not persist VAPID keys to %s: %s", VAPID_FILE, e)
    return app_server_key, out["private"], out["public"]


try:
    VAPID_PUBLIC, VAPID_PRIVATE, VAPID_PUBLIC_RAW = _load_or_create_vapid()
    log.info("webpush enabled (VAPID keys %s)", VAPID_FILE)
except Exception as e:  # noqa: BLE001
    VAPID_PUBLIC = VAPID_PRIVATE = VAPID_PUBLIC_RAW = None
    log.warning("webpush disabled (webpush lib unavailable: %s)", e)


def send_webpush(sub_b64, title, body):
    """Deliver one Web Push notification. Raises on failure."""
    import requests
    from webpush import WebPush
    from webpush.types import WebPushSubscription

    if not VAPID_PRIVATE:
        raise RuntimeError("webpush is not enabled on this apprise container")

    # decode the stored PushSubscription (base64url, padding optional)
    padded = sub_b64 + "=" * (-len(sub_b64) % 4)
    raw = json.loads(base64.urlsafe_b64decode(padded))
    if not raw.get("endpoint"):
        raise ValueError("push subscription has no endpoint")
    sub = WebPushSubscription(
        endpoint=raw["endpoint"],
        keys={"p256dh": raw["keys"]["p256dh"], "auth": raw["keys"]["auth"]},
    )

    # build the push payload from the (JSON) body
    payload = {"title": title, "body": body}
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            for key in ("title", "body", "tag", "icon"):
                if key in parsed:
                    payload[key] = parsed[key]
            if parsed.get("click_url"):
                payload["url"] = parsed["click_url"]
    except Exception:
        pass  # plain-text body: keep as-is

    private = base64.b64decode(VAPID_PRIVATE)
    public = base64.b64decode(VAPID_PUBLIC_RAW)
    w = WebPush(private, public)
    msg = w.get(json.dumps(payload), sub, subscriber=VAPID_SUB, ttl=120)
    resp = requests.post(
        sub.endpoint,
        data=msg.encrypted,
        headers={
            "Content-Encoding": "aes128gcm",
            "Content-Length": str(len(msg.encrypted)),
            "TTL": "120",
            "Authorization": msg.headers["authorization"],
        },
        timeout=15,
    )
    if resp.status_code in (404, 410):
        raise RuntimeError("push subscription expired or was revoked")
    if resp.status_code >= 400:
        raise RuntimeError(f"push service rejected the notification (HTTP {resp.status_code})")

# serialize notify() — the SMTP connection pool is small; concurrent
# sends of long bodies can exceed provider limits
NOTIFY_LOCK = threading.Lock()


def _apply_smtp_defaults(url):
    """Merge APPRISDE_SMTP_* into mailto: URLs (existing params win)."""
    # apprise >= 2 (and this 1.13.1-2026 build) requires the double-slash form
    if url.startswith("mailto:") and not url.startswith("mailto://"):
        url = "mailto://" + url[len("mailto:"):]
    parts = urlsplit(url)
    if not parts.scheme.lower().startswith("mailto"):
        return url
    existing = {k.lower() for k, _ in parse_qs(parts.query).items()}
    merged = list(parse_qsl_keep(parts.query))
    for name, value in SMTP_DEFAULTS.items():
        if value and name not in existing:
            merged.append((name, value))
    if not merged:
        return url
    from urllib.parse import urlencode

    parts = parts._replace(query=urlencode(merged))
    return urlunsplit(parts)


def parse_qsl_keep(query):
    from urllib.parse import parse_qsl

    return parse_qsl(query, keep_blank_values=True)


def send(urls, title, body, fmt, ntype):
    """Returns (success_count, error_count, error_messages)."""
    urls = [u.strip() for u in urls.split(",") if u.strip()]

    # webpush:// targets are handled directly (no apprise plugin for them);
    # everything else goes through apprise with the SMTP defaults applied.
    webpush_urls = [u for u in urls if u.lower().startswith("webpush://")]
    apprise_urls = [_apply_smtp_defaults(u) for u in urls if not u.lower().startswith("webpush://")]

    success = 0
    errors = 0
    messages = []

    for wurl in webpush_urls:
        sub_b64 = wurl[len("webpush://"):].split("?", 1)[0]
        try:
            send_webpush(sub_b64, title, body)
            success += 1
        except Exception as err:  # noqa: BLE001
            errors += 1
            messages.append(f"webpush: {err}")

    if apprise_urls:
        az = apprise.Apprise()
        added = 0
        for url in apprise_urls:
            if az.add(url):
                added += 1
        if added == 0:
            errors += len(apprise_urls)
            messages.append("no valid notification URLs were accepted")
        else:
            fmt = "text"
            ok = False
            with NOTIFY_LOCK:
                try:
                    try:
                        ok = az.notify(
                            body=body,
                            title=title,
                            notify_type=ntype if ntype in ("info", "success", "warning", "error") else "info",
                            body_format=fmt,
                        )
                    except TypeError:
                        # apprise 2.x style: format goes through override
                        ok = az.notify(
                            body=body,
                            title=title,
                            notify_type=ntype if ntype in ("info", "success", "warning", "error") else "info",
                            override={"body_format": fmt},
                        )
                except Exception as err:  # noqa: BLE001 - report to caller
                    errors += added
                    messages.append(str(err))

            if ok:
                success += added
            else:
                errors += added
                err_fn = getattr(az, "error", None)
                messages.extend(str(e) for e in (err_fn() if callable(err_fn) else [])) or messages.append(
                    "notification failed (no details from apprise)"
                )

    if success == 0:
        errors = max(errors, 1)
    return success, errors, messages


class Handler(BaseHTTPRequestHandler):
    server_version = "apprise-rest/1.0"

    def _send(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path in ("/status", "/health", "/health_check"):
            self._send(200, {
                "status": "ok",
                "service": "apprise-rest",
                "apprise": apprise.__version__,
                "webpush": bool(VAPID_PRIVATE),
            })
        elif path == "/vapid":
            # VAPID key pair for Web Push. INTERNAL network only: the private
            # key signs pushes and must never be exposed publicly. Overleaf
            # stores the app-server key to serve to browsers for subscribe().
            if not VAPID_PRIVATE:
                return self._send(503, {"error": "webpush not enabled"})
            self._send(200, {"app_server_key": VAPID_PUBLIC, "private": VAPID_PRIVATE})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path != "/notify":
            return self._send(404, {"error": "not found"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("body must be a JSON object")
        except Exception:
            return self._send(400, {"error": "invalid JSON body"})

        urls = data.get("url") or ""
        if not isinstance(urls, str) or not urls.strip():
            return self._send(400, {"error": "'url' (non-empty string) is required"})

        title = str(data.get("title") or "")
        body = data.get("body")
        body = "" if body is None else (body if isinstance(body, str) else json.dumps(body))
        fmt = data.get("format") or "text"
        if fmt not in ("text", "html", "markdown", "json"):
            fmt = "text"
        ntype = data.get("type") or "info"

        log.info("notify urls=%r title=%r bodylen=%d format=%s", urls, title[:80], len(body), fmt)
        success, errors, messages = send(urls, title, body, fmt, ntype)
        log.info("notify result success=%d errors=%d messages=%s", success, errors, messages)

        if success:
            self._send(200, {"status": 1, "success": success, "error": 0})
        else:
            self._send(200, {
                "status": 0,
                "success": 0,
                "error": errors,
                "message": "; ".join(messages),
            })

    def log_message(self, fmt, *args):  # quieter access log
        log.debug("%s " + fmt, self.address_string(), *args)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("apprise-rest listening on %s:%d (apprise %s)", HOST, PORT, apprise.__version__)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
