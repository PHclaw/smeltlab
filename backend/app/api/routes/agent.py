"""Agent 对话接口 —— 本地 piagent 引擎（SSE 流式）。

- ``GET  /api/agent/status``                 运行时就绪状态
- ``POST /api/agent/stream``                 流式对话（SSE）
- ``POST /api/agent/files``                  上传文件到会话工作区
- ``GET  /api/agent/files/{session}/{path}`` 下载工作区产物
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services.pi_agent import (
    list_skills,
    pi_agent_runner,
    session_workspace,
    workspace_root,
)

router = APIRouter()

#: 单个上传文件大小上限，避免一个请求把磁盘塞满
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class AgentChatRequest(BaseModel):
    message: str = Field(..., description="用户输入")
    session_id: str | None = Field(None, description="会话 id，会话工作区与 pi 上下文都按它隔离")
    skills: list[str] | None = Field(None, description="本次启用的技能名")
    system_prompt: str | None = Field(None, description="覆盖默认系统提示词")
    timeout: int | None = Field(None, description="执行超时（秒）")


def _ensure_enabled() -> None:
    if not get_settings().piagent_enabled:
        raise HTTPException(503, "PiAgent 引擎未启用：请在 backend/.env 中设置 PIAGENT_ENABLED=true")


def _normalize_session(session_id: str | None) -> str:
    """会话 id 只保留安全字符，缺省时新建一个。"""
    safe = re.sub(r"[^A-Za-z0-9_-]", "", session_id or "")
    return safe[:64] or uuid.uuid4().hex


@router.get("/status")
async def agent_status() -> dict[str, Any]:
    """探测 piagent 运行时就绪状态（前端据此决定入口是否可用）。"""
    exe = pi_agent_runner.exe
    return {
        "enabled": get_settings().piagent_enabled,
        "available": exe is not None,
        "exe": exe,
        "timeout": pi_agent_runner.timeout,
        "workspace_root": str(workspace_root()),
        "skills": list_skills(),
    }


@router.get("/skills")
async def agent_skills() -> dict[str, Any]:
    """可用技能列表（供前端 "/" 菜单展示）。"""
    return {"skills": list_skills()}


@router.post("/stream")
async def agent_stream(request: AgentChatRequest) -> StreamingResponse:
    """流式对话（SSE）。

    事件类型：``log`` / ``thinking`` / ``text`` / ``tool_call`` / ``progress`` /
    ``done`` / ``error``。``progress`` 携带 ``pct`` 与 ``stage``，用于长任务的进度展示；
    ``done`` 携带最终文本、工作区新增产物与会话 id。
    """
    _ensure_enabled()
    if not (request.message or "").strip():
        raise HTTPException(400, "message 不能为空")

    session_id = _normalize_session(request.session_id)

    async def event_generator():
        try:
            async for event in pi_agent_runner.stream(
                message=request.message,
                session_id=session_id,
                skills=request.skills,
                timeout=request.timeout,
                system_prompt=request.system_prompt,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 - 保证流以 error 事件收尾
            payload = {"type": "error", "content": f"执行失败：{exc}"}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/files")
async def upload_workspace_file(
    file: UploadFile = File(...),
    session_id: str | None = Form(None),
) -> dict[str, Any]:
    """把文件放进会话工作区，模型可直接读取。"""
    _ensure_enabled()
    session = _normalize_session(session_id)

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 限制")

    name = Path(file.filename or "upload.bin").name
    target = session_workspace(session) / name
    target.write_bytes(raw)

    return {
        "session_id": session,
        "name": name,
        "size": len(raw),
        "path": name,
    }


def resolve_workspace_file(workspace: Path, file_path: str) -> Path:
    """把相对路径解析为工作区内的真实文件，越界即拒绝。"""
    workspace = Path(workspace).resolve()
    target = (workspace / file_path).resolve()

    if workspace != target and workspace not in target.parents:
        raise HTTPException(403, "禁止访问工作区之外的文件")
    if not target.is_file():
        raise HTTPException(404, "文件不存在")
    return target


@router.get("/files/{session_id}/{file_path:path}")
async def download_workspace_file(session_id: str, file_path: str) -> FileResponse:
    """下载会话工作区中的产物。"""
    _ensure_enabled()
    session = _normalize_session(session_id)
    target = resolve_workspace_file(session_workspace(session), file_path)

    return FileResponse(
        target,
        filename=target.name,
        media_type="application/octet-stream",
    )
