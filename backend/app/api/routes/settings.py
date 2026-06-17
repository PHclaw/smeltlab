"""API key management and webhook configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import User, get_current_user
from app.services.apikeys import (
    create_api_key,
    delete_api_key,
    list_api_keys,
    create_webhook,
    delete_webhook,
    list_webhooks,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateAPIKeyRequest(BaseModel):
    name: str = ""


class APIKeyResponse(BaseModel):
    id: str
    name: str
    created_at: str
    last_used: str | None = None
    usage_count: int = 0


class APIKeyCreatedResponse(BaseModel):
    id: str
    name: str
    key: str  # Raw key — shown only once!
    created_at: str


class CreateWebhookRequest(BaseModel):
    url: str = Field(..., description="Webhook URL")
    events: list[str] = Field(
        default_factory=lambda: ["clean.completed"],
        description="Events to subscribe to",
    )


class WebhookResponse(BaseModel):
    id: str
    url: str
    events: list[str]
    active: bool
    created_at: str
    secret: str


# ---------------------------------------------------------------------------
# API Key endpoints
# ---------------------------------------------------------------------------

@router.get("/keys", response_model=list[APIKeyResponse])
async def get_keys(user: User = Depends(get_current_user)):
    """List all API keys for the current user."""
    keys = list_api_keys(user.id)
    return [
        APIKeyResponse(
            id=k.id,
            name=k.name,
            created_at=k.created_at,
            last_used=k.last_used,
            usage_count=k.usage_count,
        )
        for k in keys
    ]


@router.post("/keys", response_model=APIKeyCreatedResponse)
async def create_key(request: CreateAPIKeyRequest, user: User = Depends(get_current_user)):
    """Create a new API key. The raw key is returned only once."""
    raw_key, api_key = create_api_key(user.id, name=request.name)
    return APIKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key=raw_key,
        created_at=api_key.created_at,
    )


@router.delete("/keys/{key_id}")
async def remove_key(key_id: str, user: User = Depends(get_current_user)):
    """Delete an API key."""
    if not delete_api_key(user.id, key_id):
        raise HTTPException(404, "API key not found")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Webhook endpoints
# ---------------------------------------------------------------------------

@router.get("/webhooks", response_model=list[WebhookResponse])
async def get_webhooks(user: User = Depends(get_current_user)):
    """List all webhooks for the current user."""
    whs = list_webhooks(user.id)
    return [
        WebhookResponse(
            id=w.id,
            url=w.url,
            events=w.events,
            active=w.active,
            created_at=w.created_at,
            secret=w.secret,
        )
        for w in whs
    ]


@router.post("/webhooks", response_model=WebhookResponse)
async def register_webhook(request: CreateWebhookRequest, user: User = Depends(get_current_user)):
    """Register a new webhook URL."""
    wh = create_webhook(user.id, url=request.url, events=request.events)
    return WebhookResponse(
        id=wh.id,
        url=wh.url,
        events=wh.events,
        active=wh.active,
        created_at=wh.created_at,
        secret=wh.secret,
    )


@router.delete("/webhooks/{webhook_id}")
async def remove_webhook(webhook_id: str, user: User = Depends(get_current_user)):
    """Delete a webhook."""
    if not delete_webhook(user.id, webhook_id):
        raise HTTPException(404, "Webhook not found")
    return {"status": "deleted"}
