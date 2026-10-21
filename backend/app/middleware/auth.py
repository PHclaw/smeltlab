"""JWT authentication middleware / dependencies for FastAPI."""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.apikeys import validate_api_key
from app.services.auth import decode_access_token, get_user, User

security = HTTPBearer(auto_error=False)


def _resolve_user(token: str) -> Optional[User]:
    """JWT 优先；``dc_`` 开头按 API Key 校验。"""
    if token.startswith("dc_"):
        api_key = validate_api_key(token)
        return get_user(api_key.user_id) if api_key else None

    user_id = decode_access_token(token)
    return get_user(user_id) if user_id else None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    """Require authentication. Raises 401 if not authenticated."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = _resolve_user(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[User]:
    """Optional authentication. Returns None if not authenticated."""
    if not credentials:
        return None

    return _resolve_user(credentials.credentials)
