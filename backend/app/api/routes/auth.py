"""Authentication endpoints — register, login, logout, me."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field

from app.middleware.auth import get_current_user
from app.services.auth import (
    User,
    authenticate_user,
    create_access_token,
    register_user,
)

router = APIRouter()


# --- Schemas ---

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    user: dict[str, Any]
    token: str


# --- Endpoints ---

@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest):
    """Register a new user."""
    try:
        user = register_user(request.email, request.password, request.name)
    except ValueError as e:
        raise HTTPException(400, str(e))

    token = create_access_token(user.id)
    return AuthResponse(user=user.to_public(), token=token)


@router.post("/login", response_model=AuthResponse)
async def login(response: Response, request: LoginRequest):
    """Login with email and password."""
    try:
        user = authenticate_user(request.email, request.password)
    except ValueError as e:
        raise HTTPException(401, str(e))

    token = create_access_token(user.id)

    # Set httpOnly cookie
    response.set_cookie(
        key="access_token",
        value=f"Bearer {token}",
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 60 * 60,  # 7 days
    )

    return AuthResponse(user=user.to_public(), token=token)


@router.post("/logout")
async def logout(response: Response):
    """Logout — clear auth cookie."""
    response.delete_cookie("access_token")
    return {"status": "logged_out"}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Get current user info."""
    return user.to_public()
