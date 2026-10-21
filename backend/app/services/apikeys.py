"""
API Key authentication and webhook service for programmatic access.

Features:
- API key generation and management
- Webhook URL registration
- Batch processing via API
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core import store


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class APIKey:
    id: str
    user_id: str
    key_hash: str  # We store the hash, not the raw key
    name: str = ""
    created_at: str = ""
    last_used: str | None = None
    usage_count: int = 0


@dataclass
class Webhook:
    id: str
    user_id: str
    url: str
    events: list[str] = field(default_factory=list)  # ["clean.completed", "recipe.applied"]
    active: bool = True
    created_at: str = ""
    secret: str = ""  # For signing webhook payloads


# In-memory stores（写操作同步落盘）
_api_keys: dict[str, APIKey] = {}       # key_id -> APIKey
_key_hashes: dict[str, str] = {}        # key_hash -> key_id
_webhooks: dict[str, Webhook] = {}      # webhook_id -> Webhook
_user_webhooks: dict[str, list[str]] = {}  # user_id -> [webhook_ids]
_user_keys: dict[str, list[str]] = {}   # user_id -> [key_ids]


def _persist() -> None:
    store.save(
        "apikeys",
        {
            "keys": [asdict(k) for k in _api_keys.values()],
            "webhooks": [asdict(w) for w in _webhooks.values()],
        },
    )


def _restore() -> None:
    data = store.load("apikeys", {}) or {}
    for item in data.get("keys", []):
        try:
            api_key = APIKey(**item)
        except TypeError:
            continue
        _api_keys[api_key.id] = api_key
        _key_hashes[api_key.key_hash] = api_key.id
        _user_keys.setdefault(api_key.user_id, []).append(api_key.id)

    for item in data.get("webhooks", []):
        try:
            webhook = Webhook(**item)
        except TypeError:
            continue
        _webhooks[webhook.id] = webhook
        _user_webhooks.setdefault(webhook.user_id, []).append(webhook.id)


_restore()


# ---------------------------------------------------------------------------
# API Key management
# ---------------------------------------------------------------------------

def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def create_api_key(user_id: str, name: str = "") -> tuple[str, APIKey]:
    """
    Create a new API key. Returns (raw_key, APIKey).
    The raw key is only shown once — we store the hash.
    """
    raw_key = f"dc_{secrets.token_urlsafe(32)}"
    key_id = str(uuid.uuid4())
    key_hash = _hash_key(raw_key)

    api_key = APIKey(
        id=key_id,
        user_id=user_id,
        key_hash=key_hash,
        name=name or f"API Key {len(_user_keys.get(user_id, [])) + 1}",
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    _api_keys[key_id] = api_key
    _key_hashes[key_hash] = key_id

    if user_id not in _user_keys:
        _user_keys[user_id] = []
    _user_keys[user_id].append(key_id)

    _persist()
    return raw_key, api_key


def validate_api_key(raw_key: str) -> APIKey | None:
    """Validate an API key and return the APIKey object if valid."""
    key_hash = _hash_key(raw_key)
    key_id = _key_hashes.get(key_hash)
    if not key_id:
        return None

    api_key = _api_keys.get(key_id)
    if api_key:
        api_key.last_used = datetime.now(timezone.utc).isoformat()
        api_key.usage_count += 1
        _persist()

    return api_key


def list_api_keys(user_id: str) -> list[APIKey]:
    """List all API keys for a user."""
    key_ids = _user_keys.get(user_id, [])
    return [_api_keys[kid] for kid in key_ids if kid in _api_keys]


def delete_api_key(user_id: str, key_id: str) -> bool:
    """Delete an API key."""
    api_key = _api_keys.get(key_id)
    if not api_key or api_key.user_id != user_id:
        return False

    del _key_hashes[api_key.key_hash]
    del _api_keys[key_id]
    _user_keys[user_id] = [k for k in _user_keys.get(user_id, []) if k != key_id]
    _persist()
    return True


# ---------------------------------------------------------------------------
# Webhook management
# ---------------------------------------------------------------------------

def create_webhook(
    user_id: str,
    url: str,
    events: list[str] | None = None,
) -> Webhook:
    """Register a webhook URL."""
    webhook_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(24)

    webhook = Webhook(
        id=webhook_id,
        user_id=user_id,
        url=url,
        events=events or ["clean.completed"],
        created_at=datetime.now(timezone.utc).isoformat(),
        secret=secret,
    )

    _webhooks[webhook_id] = webhook

    if user_id not in _user_webhooks:
        _user_webhooks[user_id] = []
    _user_webhooks[user_id].append(webhook_id)

    _persist()
    return webhook


def list_webhooks(user_id: str) -> list[Webhook]:
    """List all webhooks for a user."""
    wh_ids = _user_webhooks.get(user_id, [])
    return [_webhooks[wid] for wid in wh_ids if wid in _webhooks]


def delete_webhook(user_id: str, webhook_id: str) -> bool:
    """Delete a webhook."""
    wh = _webhooks.get(webhook_id)
    if not wh or wh.user_id != user_id:
        return False

    del _webhooks[webhook_id]
    _user_webhooks[user_id] = [w for w in _user_webhooks.get(user_id, []) if w != webhook_id]
    _persist()
    return True


async def fire_webhooks(user_id: str, event: str, payload: dict[str, Any]) -> None:
    """Fire all active webhooks for a user matching the event."""
    import hmac
    import json

    user_wh_ids = _user_webhooks.get(user_id, [])
    for wid in user_wh_ids:
        wh = _webhooks.get(wid)
        if not wh or not wh.active or event not in wh.events:
            continue

        body = json.dumps({
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": payload,
        })

        # Sign the payload
        signature = hmac.new(
            wh.secret.encode(), body.encode(), hashlib.sha256
        ).hexdigest()

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    wh.url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-SmeltLab-Signature": f"sha256={signature}",
                        "X-SmeltLab-Event": event,
                    },
                )
        except Exception:
            pass  # Silently fail for MVP — production should log/retry
