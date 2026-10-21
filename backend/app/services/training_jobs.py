"""训练任务：在工作空间里生成脚本、执行、解析进度与结果。

脚本通过 stdout 上的两个标记与后端通信：
    @@PROGRESS {...}  → 进度、阶段、当前指标
    @@RESULT   {...}  → 最终评估结果与图表数据
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.pi_agent import session_workspace
from app.services.trainer_codegen import build_script

JOB_TIMEOUT_SECONDS = 900
MAX_LOG_LINES = 120


@dataclass
class TrainingJob:
    id: str
    session_id: str
    status: str = "queued"  # queued / running / done / error
    pct: int = 0
    stage: str = "排队中"
    metrics: dict[str, Any] = field(default_factory=dict)
    history: list[list[float]] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    script_name: str = ""
    summary: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    elapsed: float = 0.0


_jobs: dict[str, TrainingJob] = {}
_lock = threading.Lock()


def get_job(job_id: str) -> TrainingJob | None:
    with _lock:
        return _jobs.get(job_id)


def job_payload(job: TrainingJob) -> dict[str, Any]:
    with _lock:
        return {
            "id": job.id,
            "session_id": job.session_id,
            "status": job.status,
            "pct": job.pct,
            "stage": job.stage,
            "metrics": dict(job.metrics),
            "history": list(job.history),
            "logs": list(job.logs[-30:]),
            "result": job.result,
            "error": job.error,
            "script": job.script_name,
            "summary": job.summary,
            "elapsed": round(job.elapsed, 1),
        }


def _update(job: TrainingJob, **changes: Any) -> None:
    with _lock:
        for key, value in changes.items():
            setattr(job, key, value)


def _append_log(job: TrainingJob, line: str) -> None:
    with _lock:
        job.logs.append(line[:400])
        if len(job.logs) > MAX_LOG_LINES:
            del job.logs[: len(job.logs) - MAX_LOG_LINES]


def _safe_file(workspace: Path, file_name: str) -> Path:
    candidate = (workspace / file_name).resolve()
    if workspace.resolve() not in candidate.parents:
        raise ValueError("文件必须位于当前会话工作区内")
    if not candidate.is_file():
        raise ValueError(f"文件不存在：{file_name}")
    return candidate


def create_job(payload: dict[str, Any]) -> TrainingJob:
    session_id = str(payload.get("session_id") or "").strip()
    if not session_id:
        raise ValueError("缺少 session_id")

    file_name = str(payload.get("file") or "").strip()
    target = str(payload.get("target") or "").strip()
    if not file_name or not target:
        raise ValueError("缺少 file 或 target")

    workspace = session_workspace(session_id)
    _safe_file(workspace, file_name)

    model = str(payload.get("model") or "rf")
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise ValueError("params 必须是对象")

    script, summary = build_script(
        file_name=file_name,
        target=target,
        task=str(payload.get("task") or "auto"),
        model=model,
        params=params,
        group=payload.get("group") or None,
        drop=[str(d) for d in (payload.get("drop") or [])],
        test_size=float(payload.get("test_size") or 0.25),
        out_dir=str(workspace),
    )

    script_name = f"train_{summary['slug']}.py"
    (workspace / script_name).write_text(script, encoding="utf-8")

    job = TrainingJob(
        id=uuid.uuid4().hex,
        session_id=session_id,
        script_name=script_name,
        summary=summary,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _update(job, **{})
    with _lock:
        _jobs[job.id] = job

    threading.Thread(target=_run_job, args=(job, workspace, script_name), daemon=True).start()
    return job


def _run_job(job: TrainingJob, workspace: Path, script_name: str) -> None:
    started = time.monotonic()
    _update(job, status="running", stage="启动训练脚本")
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"

    proc = None
    try:
        proc = subprocess.Popen(
            [sys.executable, script_name],
            cwd=str(workspace),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )

        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if line.startswith("@@PROGRESS "):
                try:
                    data = json.loads(line[len("@@PROGRESS "):])
                except json.JSONDecodeError:
                    continue
                metrics = data.get("metrics") or {}
                with _lock:
                    job.pct = max(0, min(int(data.get("pct", job.pct)), 100))
                    job.stage = str(data.get("stage") or job.stage)
                    job.metrics.update(metrics)
                    for name, value in metrics.items():
                        if isinstance(value, (int, float)):
                            job.history.append([int(data.get("step") or len(job.history) + 1), float(value)])
                    job.elapsed = time.monotonic() - started
            elif line.startswith("@@RESULT "):
                try:
                    _update(job, result=json.loads(line[len("@@RESULT "):]))
                except json.JSONDecodeError:
                    _append_log(job, "结果解析失败")
            elif line.startswith("@@ERROR "):
                try:
                    message = json.loads(line[len("@@ERROR "):]).get("message", "训练失败")
                except json.JSONDecodeError:
                    message = "训练失败"
                _update(job, error=message)
            elif line.strip():
                _append_log(job, line)

            if time.monotonic() - started > JOB_TIMEOUT_SECONDS:
                _update(job, error=f"训练超时（超过 {JOB_TIMEOUT_SECONDS} 秒）")
                break

        code = proc.wait(timeout=30)
        elapsed = time.monotonic() - started

        with _lock:
            job.elapsed = elapsed
            if job.error:
                job.status = "error"
                job.stage = "训练失败"
            elif job.result is not None:
                job.status = "done"
                job.pct = 100
                job.stage = "训练完成"
            elif code != 0:
                job.status = "error"
                job.error = job.error or f"训练脚本退出码 {code}"
                job.stage = "训练失败"
            else:
                job.status = "error"
                job.error = "训练脚本没有返回结果"
                job.stage = "训练失败"
    except Exception as exc:  # noqa: BLE001
        _update(job, status="error", error=str(exc), stage="训练失败")
    finally:
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass


def job_file(job: TrainingJob, name: str) -> Path | None:
    """返回任务产物路径（限制在工作区内，防目录穿越）。"""
    workspace = session_workspace(job.session_id)
    candidate = (workspace / name).resolve()
    if workspace.resolve() not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate
