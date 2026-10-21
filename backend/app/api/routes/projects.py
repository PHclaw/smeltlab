"""Project management endpoints."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import store
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


# In-memory store（写操作同步落盘）
_projects: dict[str, Project] = {}
_projects_by_user: dict[str, list[str]] = {}  # user_id -> [project_ids]


def _persist() -> None:
    store.save(
        "projects",
        {
            "projects": [asdict(p) for p in _projects.values()],
            "by_user": _projects_by_user,
        },
    )


def _restore() -> None:
    data = store.load("projects", {}) or {}
    for item in data.get("projects", []):
        try:
            project = Project(**item)
        except TypeError:
            continue
        _projects[project.id] = project
    for user_id, ids in (data.get("by_user") or {}).items():
        _projects_by_user[user_id] = [pid for pid in ids if pid in _projects]


_restore()


def _dataset_count(project_id: str) -> int:
    """实时统计项目下的数据集数量。"""
    from app.api.routes.datasets import _datasets

    return sum(1 for d in _datasets.values() if d.get("project_id") == project_id)


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
            dataset_count=_dataset_count(p.id),
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
    _persist()

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        dataset_count=0,
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
        dataset_count=_dataset_count(project.id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/{project_id}/datasets")
async def list_project_datasets(project_id: str, user: User = Depends(get_current_user)):
    """List datasets attached to a project."""
    project = _projects.get(project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(404, "Project not found")

    from app.api.routes.datasets import _datasets

    items = [d for d in _datasets.values() if d.get("project_id") == project_id]
    items.sort(key=lambda d: str(d.get("created_at", "")), reverse=True)
    return [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "format": d.get("format"),
            "row_count": d.get("row_count", 0),
            "col_count": d.get("col_count", 0),
            "file_size_bytes": d.get("file_size_bytes", 0),
            "status": d.get("status", "ready"),
            "created_at": d.get("created_at", ""),
        }
        for d in items
    ]


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
    _persist()

    return {"status": "deleted"}
