"""
Authentication Service — JWT-based user authentication.

MVP implementation with in-memory user store.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import jwt

from app.core import store
from app.core.config import get_settings


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class User:
    id: str
    email: str
    name: str
    password_hash: str
    plan: str = "free"  # free | pro
    avatar_url: str = ""
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "plan": self.plan,
            "avatar_url": self.avatar_url,
            "created_at": self.created_at,
        }


# In-memory user store（写操作会同步落盘，重启后恢复）
_users: dict[str, User] = {}
_users_by_email: dict[str, str] = {}  # email -> user_id


def _persist() -> None:
    store.save("users", [asdict(u) for u in _users.values()])


def _restore() -> None:
    for item in store.load("users", []):
        try:
            user = User(**item)
        except TypeError:
            continue
        _users[user.id] = user
        _users_by_email[user.email] = user.id


_restore()


# ---------------------------------------------------------------------------
# Password hashing (simple SHA-256 + salt for MVP — use bcrypt in production)
# ---------------------------------------------------------------------------

_SALT = "smeltlab-mvp-salt"


def _hash_password(password: str) -> str:
    return hashlib.sha256(f"{_SALT}{password}".encode()).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    return _hash_password(password) == password_hash


# ---------------------------------------------------------------------------
# JWT tokens
# ---------------------------------------------------------------------------

def create_access_token(user_id: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> Optional[str]:
    """Decode JWT and return user_id, or None if invalid."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return payload.get("sub")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

def register_user(email: str, password: str, name: str = "") -> User:
    """Register a new user."""
    email = email.lower().strip()

    if email in _users_by_email:
        raise ValueError("Email already registered")

    user_id = str(uuid.uuid4())
    user = User(
        id=user_id,
        email=email,
        name=name or email.split("@")[0],
        password_hash=_hash_password(password),
    )
    _users[user_id] = user
    _users_by_email[email] = user_id
    _persist()
    return user


def authenticate_user(email: str, password: str) -> User:
    """Authenticate user with email and password."""
    email = email.lower().strip()
    user_id = _users_by_email.get(email)
    if not user_id:
        raise ValueError("Invalid email or password")

    user = _users.get(user_id)
    if not user or not _verify_password(password, user.password_hash):
        raise ValueError("Invalid email or password")

    return user


def get_user(user_id: str) -> Optional[User]:
    """Get user by ID."""
    return _users.get(user_id)
