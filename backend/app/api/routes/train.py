"""自动训练任务接口。

前端「训练配置卡」提交后：后端读取工作区数据集 → 生成训练脚本 → 执行 → 前端轮询进度。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.middleware.auth import User, get_optional_user
from app.services.pi_agent import session_workspace
from app.services.trainer_codegen import dataset_schema
from app.services.training_jobs import (
    create_job,
    get_job,
    job_file,
    job_payload,
)

router = APIRouter()

DATA_SUFFIXES = {".csv", ".xlsx", ".xls", ".json", ".jsonl", ".ndjson", ".parquet"}


class TrainJobRequest(BaseModel):
    session_id: str = Field(..., description="会话 id，用于定位工作区")
    file: str = Field(..., description="工作区内的数据文件名")
    target: str = Field(..., description="目标列")
    task: str = "auto"
    model: str = "rf"
    params: dict = Field(default_factory=dict)
    group: str | None = None
    drop: list[str] = Field(default_factory=list)
    test_size: float = 0.25


def _workspace_file(session_id: str, file_name: str) -> Path:
    workspace = session_workspace(session_id)
    candidate = (workspace / file_name).resolve()
    if workspace.resolve() not in candidate.parents:
        raise HTTPException(status_code=400, detail="文件必须位于当前会话工作区内")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return candidate


@router.get("/datasets")
async def list_datasets(session_id: str):
    """列出会话工作区里的数据文件（供训练对话框选择）。"""
    workspace = session_workspace(session_id)
    items = []
    for path in sorted(workspace.iterdir()):
        if not path.is_file() or path.suffix.lower() not in DATA_SUFFIXES:
            continue
        if path.name.startswith("."):
            continue
        items.append(
            {
                "name": path.name,
                "format": path.suffix.lstrip(".").lower(),
                "size": path.stat().st_size,
            }
        )
        if len(items) >= 20:
            break
    return items


@router.get("/schema")
async def read_dataset_schema(session_id: str, file: str):
    path = _workspace_file(session_id, file)
    try:
        return dataset_schema(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/jobs")
async def create_training_job(
    request: TrainJobRequest,
    user: User | None = Depends(get_optional_user),
):
    try:
        job = create_job(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job_payload(job)


@router.get("/jobs/{job_id}")
async def read_training_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job_payload(job)


@router.get("/jobs/{job_id}/code", response_class=PlainTextResponse)
async def read_training_code(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    path = job_file(job, job.script_name)
    if not path:
        raise HTTPException(status_code=404, detail="脚本不存在")
    return path.read_text(encoding="utf-8")


@router.get("/jobs/{job_id}/files/{name}")
async def download_artifact(job_id: str, name: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    path = job_file(job, name)
    if not path:
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, filename=path.name)
