"""Project management endpoints."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import User, get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Project:
    id: str
    user_id: str
    name: str
    description: str = ""
    dataset_count: int = 0
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()
        if not self.updated_at:
            self.updated_at = self.created_at


# In-memory store
_projects: dict[str, Project] = {}
_projects_by_user: dict[str, list[str]] = {}  # user_id -> [project_ids]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str
    dataset_count: int
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProjectResponse])
async def list_projects(user: User = Depends(get_current_user)):
    """List all projects for the current user."""
    project_ids = _projects_by_user.get(user.id, [])
    projects = [_projects[pid] for pid in project_ids if pid in _projects]
    projects.sort(key=lambda p: p.created_at, reverse=True)
    return [
        ProjectResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            dataset_count=p.dataset_count,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in projects
    ]


@router.post("", response_model=ProjectResponse)
async def create_project(request: CreateProjectRequest, user: User = Depends(get_current_user)):
    """Create a new project."""
    project_id = str(uuid.uuid4())
    project = Project(
        id=project_id,
        user_id=user.id,
        name=request.name,
        description=request.description,
    )
    _projects[project_id] = project

    if user.id not in _projects_by_user:
        _projects_by_user[user.id] = []
    _projects_by_user[user.id].append(project_id)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        dataset_count=project.dataset_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, user: User = Depends(get_current_user)):
    """Get a project by ID."""
    project = _projects.get(project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(404, "Project not found")

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        dataset_count=project.dataset_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: User = Depends(get_current_user)):
    """Delete a project."""
    project = _projects.get(project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(404, "Project not found")

    del _projects[project_id]
    if user.id in _projects_by_user:
        _projects_by_user[user.id] = [
            pid for pid in _projects_by_user[user.id] if pid != project_id
        ]

    return {"status": "deleted"}
