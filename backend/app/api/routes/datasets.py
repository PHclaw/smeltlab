"""Dataset management endpoints — upload, profile, preview, export."""

from __future__ import annotations

import asyncio
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.middleware.auth import User, get_optional_user
from app.services.apikeys import fire_webhooks
from app.schemas.api import (
    AugmentApplyResponse,
    AugmentRequest,
    AugmentStartResponse,
    BatchUploadResponse,
    ChunkRequest,
    ChunkResponse,
    DatasetUploadResponse,
    PreviewResponse,
    ProfileResponse,
    ValidateRequest,
    ValidationErrorSchema,
    ValidationResultResponse,
)
from app.services.profiler import profile_data, read_file_bytes
from app.services.validator import validate_dataset as validate_llm_data, fix_dataset as fix_llm_data, detect_format
from app.services.chunker import chunk_dataframe
from app.services.streaming import profile_large_file
from app.services.augmenter import AugmentTask, start_augmentation as run_augment_thread, apply_augmentation

# SSE progress store (in-memory for MVP)
_progress: dict[str, dict] = {}

router = APIRouter()
settings = get_settings()

# In-memory store for MVP (replace with DB later)
_datasets: dict[str, dict] = {}
_dataframes: dict[str, object] = {}  # dataset_id -> pl.DataFrame
_profiles: dict[str, dict] = {}
_batches: dict[str, list[str]] = {}  # batch_id -> [dataset_ids]
_augment_tasks: dict[str, object] = {}  # task_id -> AugmentTask


def _detect_format(filename: str) -> str:
    ext = Path(filename).suffix.lstrip(".").lower()
    format_map = {"xls": "xlsx", "ndjson": "jsonl"}
    return format_map.get(ext, ext)


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    project_id: str | None = Form(None),
    user: User | None = Depends(get_optional_user),
):
    """Upload a data file and run automatic profiling."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    if project_id:
        from app.api.routes.projects import _projects

        project = _projects.get(project_id)
        if not project:
            raise HTTPException(404, "Project not found")
        if user and project.user_id != user.id:
            raise HTTPException(403, "Project does not belong to current user")

    file_format = _detect_format(file.filename)
    supported = {"csv", "json", "jsonl", "xlsx", "parquet", "txt", "md"}
    if file_format not in supported:
        raise HTTPException(400, f"Unsupported format: {file_format}. Supported: {supported}")

    # Read file
    content = await file.read()
    file_size = len(content)

    max_size = settings.max_upload_size_mb * 1024 * 1024
    if file_size > max_size:
        raise HTTPException(413, f"File too large. Max: {settings.max_upload_size_mb}MB")

    # Parse into DataFrame
    try:
        if file_format in ("txt", "md"):
            # Text files: single-row DataFrame with full text
            text = content.decode("utf-8", errors="replace")
            import polars as pl
            df = pl.DataFrame({"text": [text], "source": [file.filename]})
        else:
            df = read_file_bytes(content, file_format)
    except Exception as e:
        raise HTTPException(422, f"Failed to parse file: {e}")

    # Store
    dataset_id = str(uuid.uuid4())

    # Also save to local disk
    storage_path = Path(settings.local_storage_path)
    storage_path.mkdir(parents=True, exist_ok=True)
    file_path = storage_path / f"{dataset_id}.{file_format}"
    file_path.write_bytes(content)

    _datasets[dataset_id] = {
        "id": dataset_id,
        "name": file.filename,
        "format": file_format,
        "row_count": len(df),
        "col_count": len(df.columns),
        "file_size_bytes": file_size,
        "status": "ready",
        "file_path": str(file_path),
        "project_id": project_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _dataframes[dataset_id] = df

    # Auto-profile — use streaming for large files
    try:
        if file_size > 50 * 1024 * 1024 and file_format in ("csv", "jsonl", "ndjson", "parquet"):
            # Large file: use streaming profiler
            profile_result = profile_large_file(str(file_path), file_format)
            _profiles[dataset_id] = type("ProfileReport", (), profile_result)()
        else:
            report = profile_data(df, file_size)
            _profiles[dataset_id] = report
    except Exception as e:
        _datasets[dataset_id]["status"] = "error"
        raise HTTPException(500, f"Profiling failed: {e}")

    if user:
        asyncio.create_task(
            fire_webhooks(
                user.id,
                "dataset.uploaded",
                {
                    "dataset_id": dataset_id,
                    "name": file.filename,
                    "rows": len(df),
                    "project_id": project_id,
                },
            )
        )

    return DatasetUploadResponse(
        id=dataset_id,
        name=file.filename,
        format=file_format,
        row_count=len(df),
        col_count=len(df.columns),
        file_size_bytes=file_size,
        status="ready",
    )


def _process_single_upload(file: UploadFile, content: bytes) -> DatasetUploadResponse:
    """Shared logic for processing a single file upload (used by both single and batch)."""
    file_format = _detect_format(file.filename)
    supported = {"csv", "json", "jsonl", "xlsx", "parquet"}
    if file_format not in supported:
        raise HTTPException(400, f"Unsupported format: {file_format}")

    file_size = len(content)
    max_size = settings.max_upload_size_mb * 1024 * 1024
    if file_size > max_size:
        raise HTTPException(413, f"File too large: {file.filename}")

    df = read_file_bytes(content, file_format)
    dataset_id = str(uuid.uuid4())

    storage_path = Path(settings.local_storage_path)
    storage_path.mkdir(parents=True, exist_ok=True)
    file_path = storage_path / f"{dataset_id}.{file_format}"
    file_path.write_bytes(content)

    _datasets[dataset_id] = {
        "id": dataset_id,
        "name": file.filename,
        "format": file_format,
        "row_count": len(df),
        "col_count": len(df.columns),
        "file_size_bytes": file_size,
        "status": "ready",
        "file_path": str(file_path),
    }
    _dataframes[dataset_id] = df

    report = profile_data(df, file_size)
    _profiles[dataset_id] = report

    return DatasetUploadResponse(
        id=dataset_id,
        name=file.filename,
        format=file_format,
        row_count=len(df),
        col_count=len(df.columns),
        file_size_bytes=file_size,
        status="ready",
    )


@router.post("/upload-batch", response_model=BatchUploadResponse)
async def upload_batch(files: List[UploadFile] = File(...)):
    """Upload multiple files at once as a batch. All files get profiled automatically."""
    if not files or len(files) == 0:
        raise HTTPException(400, "No files provided")
    if len(files) > 10:
        raise HTTPException(400, "Maximum 10 files per batch")

    batch_id = str(uuid.uuid4())
    results = []
    dataset_ids = []

    for file in files:
        if not file.filename:
            continue
        content = await file.read()
        try:
            result = _process_single_upload(file, content)
            results.append(result)
            dataset_ids.append(result.id)
        except HTTPException:
            # Skip failed files, continue with others
            continue

    if not results:
        raise HTTPException(422, "All files failed to process")

    _batches[batch_id] = dataset_ids

    return BatchUploadResponse(batch_id=batch_id, datasets=results)


@router.get("/{dataset_id}/profile", response_model=ProfileResponse)
async def get_profile(dataset_id: str):
    """Get the data profiling report for a dataset."""
    if dataset_id not in _profiles:
        raise HTTPException(404, "Dataset not found or not profiled")

    report = _profiles[dataset_id]
    return ProfileResponse(
        health_score=report.health_score,
        total_rows=report.total_rows,
        total_columns=report.total_columns,
        file_size_bytes=report.file_size_bytes,
        duplicate_rows=report.duplicate_rows,
        duplicate_pct=report.duplicate_pct,
        columns=[
            {
                "name": c.name,
                "inferred_type": c.inferred_type,
                "null_count": c.null_count,
                "null_pct": c.null_pct,
                "unique_count": c.unique_count,
                "unique_pct": c.unique_pct,
                "sample_values": c.sample_values,
                "issues": c.issues,
                "stats": c.stats,
            }
            for c in report.columns
        ],
        issues=[
            {
                "severity": i.severity,
                "category": i.category,
                "message": i.message,
                "affected_rows": i.affected_rows,
                "affected_column": i.affected_column,
                "suggestion": i.suggestion,
            }
            for i in report.issues
        ],
        preview_rows=report.preview_rows,
    )


@router.get("/{dataset_id}/preview", response_model=PreviewResponse)
async def get_preview(dataset_id: str, rows: int = 50):
    """Preview the first N rows of a dataset."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]
    rows = min(rows, 100)
    preview = df.head(rows).to_dicts()

    # Serialize
    for row in preview:
        for k, v in row.items():
            if not isinstance(v, (str, int, float, bool, type(None))):
                row[k] = str(v)

    return PreviewResponse(
        rows=preview,
        total_rows=len(df),
        columns=df.columns,
    )


@router.get("/{dataset_id}/export")
async def export_dataset(dataset_id: str, format: str = "csv"):
    """Export a (cleaned) dataset as a downloadable file."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]
    info = _datasets[dataset_id]
    base_name = Path(info["name"]).stem

    if format == "csv":
        buf = io.BytesIO()
        buf.write(df.write_csv().encode("utf-8"))
        buf.seek(0)
        media_type = "text/csv"
        filename = f"{base_name}_clean.csv"
    elif format == "json":
        buf = io.BytesIO()
        buf.write(df.write_json().encode("utf-8"))
        buf.seek(0)
        media_type = "application/json"
        filename = f"{base_name}_clean.json"
    elif format == "jsonl":
        buf = io.BytesIO()
        buf.write(df.write_ndjson().encode("utf-8"))
        buf.seek(0)
        media_type = "application/x-ndjson"
        filename = f"{base_name}_clean.jsonl"
    elif format == "parquet":
        buf = io.BytesIO()
        df.write_parquet(buf)
        buf.seek(0)
        media_type = "application/octet-stream"
        filename = f"{base_name}_clean.parquet"
    else:
        raise HTTPException(400, f"Unsupported export format: {format}")

    return StreamingResponse(
        buf,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# LLM Training Data Validation
# ---------------------------------------------------------------------------

@router.post("/{dataset_id}/validate-llm", response_model=ValidationResultResponse)
async def validate_llm(dataset_id: str, request: ValidateRequest = None):
    """Validate a dataset against LLM training formats (ChatML, Alpaca, ShareGPT)."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]
    req = request or ValidateRequest()

    result = validate_llm_data(df, format_type=req.format_type, max_tokens=req.max_tokens)

    return ValidationResultResponse(
        format_type=result.format_type,
        total_rows=result.total_rows,
        valid_rows=result.valid_rows,
        invalid_rows=result.invalid_rows,
        warnings=result.warnings,
        avg_tokens=result.avg_tokens,
        max_tokens=result.max_tokens,
        token_distribution=result.token_distribution,
        errors=[
            ValidationErrorSchema(
                row_index=e.row_index,
                field_path=e.field_path,
                message=e.message,
                severity=e.severity,
                fixable=e.fixable,
            )
            for e in result.errors
        ],
    )


@router.post("/{dataset_id}/fix-llm")
async def fix_llm(dataset_id: str, format_type: str | None = None):
    """Auto-fix common LLM training data format issues."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]

    if format_type is None:
        format_type = detect_format(df)
    if format_type is None:
        raise HTTPException(400, "Could not detect format. Specify format_type: chatml, alpaca, or sharegpt")

    fixed_df = fix_llm_data(df, format_type)

    # Store fixed DataFrame
    fix_key = f"{dataset_id}_llm_fixed"
    _dataframes[fix_key] = fixed_df

    # Re-validate to show improvements
    result = validate_llm_data(fixed_df, format_type=format_type)

    return {
        "status": "fixed",
        "fix_key": fix_key,
        "rows_fixed": len(fixed_df),
        "valid_rows_after": result.valid_rows,
        "invalid_rows_after": result.invalid_rows,
        "remaining_errors": len(result.errors),
    }


# ---------------------------------------------------------------------------
# RAG Chunking
# ---------------------------------------------------------------------------

@router.post("/{dataset_id}/chunk", response_model=ChunkResponse)
async def chunk_dataset(dataset_id: str, request: ChunkRequest):
    """Chunk text data for RAG pipelines."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]

    # Auto-detect text column
    text_col = request.text_column
    if text_col is None:
        # Look for common text column names
        for candidate in ["text", "content", "body", "document", "description", "paragraph"]:
            if candidate in df.columns:
                text_col = candidate
                break
        if text_col is None:
            # Use first string column
            import polars as pl
            for col in df.columns:
                if df[col].dtype in (pl.Utf8, pl.String):
                    text_col = col
                    break
        if text_col is None:
            raise HTTPException(400, "No text column found. Specify text_column parameter.")

    # Get source column
    source_col = request.source_column
    sources = None
    if source_col and source_col in df.columns:
        sources = df[source_col].to_list()
    elif "source" in df.columns:
        sources = df["source"].to_list()
    elif "filename" in df.columns:
        sources = df["filename"].to_list()

    # Extract texts
    texts = [str(v) if v is not None else "" for v in df[text_col].to_list()]

    # Chunk
    chunks = chunk_dataframe(
        texts=texts,
        sources=sources,
        chunk_size=request.chunk_size,
        overlap=request.overlap,
        strategy=request.strategy,
    )

    if not chunks:
        raise HTTPException(400, "No chunks generated — text data may be empty")

    # Store as DataFrame
    import polars as pl
    chunk_df = pl.DataFrame(chunks)
    chunk_key = f"{dataset_id}_chunks"
    _dataframes[chunk_key] = chunk_df

    # Stats
    avg_size = int(sum(c["char_count"] for c in chunks) / len(chunks))
    avg_tokens = int(sum(c["token_estimate"] for c in chunks) / len(chunks))
    unique_sources = len(set(c["source"] for c in chunks))

    return ChunkResponse(
        total_chunks=len(chunks),
        total_sources=unique_sources,
        avg_chunk_size=avg_size,
        avg_tokens=avg_tokens,
        chunk_key=chunk_key,
        preview_chunks=chunks[:10],
    )


# ---------------------------------------------------------------------------
# Quality Report (HTML/PDF)
# ---------------------------------------------------------------------------

@router.get("/{dataset_id}/report")
async def quality_report(dataset_id: str):
    """Generate a styled HTML quality report for a dataset."""
    if dataset_id not in _profiles:
        raise HTTPException(404, "Dataset not profiled")

    report = _profiles[dataset_id]
    info = _datasets.get(dataset_id, {})
    name = info.get("name", "dataset")

    # Build HTML report
    html = _build_report_html(report, name, dataset_id)

    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html)


def _build_report_html(report, name: str, dataset_id: str) -> str:
    """Build a styled HTML quality report."""
    score = report.health_score
    score_color = "#10b981" if score >= 80 else "#f59e0b" if score >= 60 else "#ef4444"

    issues_html = ""
    for issue in report.issues:
        sev_color = {"critical": "#ef4444", "warning": "#f59e0b", "info": "#3b82f6"}.get(issue.severity, "#6b7280")
        issues_html += f'''
        <tr>
            <td><span style="color:{sev_color};font-weight:600;text-transform:uppercase;font-size:11px">{issue.severity}</span></td>
            <td>{issue.category}</td>
            <td>{issue.message}</td>
            <td style="color:#6b7280;font-size:12px">{issue.suggestion}</td>
        </tr>'''

    columns_html = ""
    for col in report.columns:
        null_color = "#ef4444" if col.null_pct > 20 else "#f59e0b" if col.null_pct > 5 else "#10b981"
        issues_count = len(col.issues)
        columns_html += f'''
        <tr>
            <td style="font-family:monospace;font-weight:600">{col.name}</td>
            <td><span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:12px">{col.inferred_type}</span></td>
            <td style="color:{null_color};font-weight:{'600' if col.null_pct > 5 else '400'}">{col.null_pct}%</td>
            <td>{col.unique_pct}%</td>
            <td>{issues_count if issues_count > 0 else '✅'}</td>
        </tr>'''

    return f'''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Data Quality Report — {name}</title>
<style>
    body {{ font-family: Inter, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #111827; }}
    h1 {{ font-size: 28px; margin-bottom: 4px; }}
    h2 {{ font-size: 20px; margin-top: 32px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }}
    .meta {{ color: #6b7280; font-size: 14px; margin-bottom: 32px; }}
    .score {{ display: inline-flex; align-items: center; gap: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 32px; margin-bottom: 24px; }}
    .score-num {{ font-size: 48px; font-weight: 800; color: {score_color}; }}
    .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }}
    .stat {{ background: #f9fafb; border-radius: 8px; padding: 12px; text-align: center; }}
    .stat-val {{ font-size: 20px; font-weight: 700; }}
    .stat-label {{ font-size: 11px; color: #6b7280; margin-top: 2px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th {{ text-align: left; padding: 8px 12px; background: #f9fafb; font-weight: 600; font-size: 12px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }}
    td {{ padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }}
    .footer {{ margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }}
    @media print {{ body {{ padding: 20px; }} .no-print {{ display: none; }} }}
</style>
</head><body>
    <div class="no-print" style="text-align:right;margin-bottom:16px">
        <button onclick="window.print()" style="background:#4f46e5;color:white;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:14px">
            🖨 Print / Save as PDF
        </button>
    </div>

    <h1>📊 Data Quality Report</h1>
    <div class="meta">{name} · Generated {__import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M")} · ID: {dataset_id[:8]}</div>

    <div class="score">
        <div class="score-num">{score}</div>
        <div>
            <div style="font-size:14px;font-weight:600">Health Score</div>
            <div style="font-size:12px;color:#6b7280">out of 100</div>
        </div>
    </div>

    <div class="stats">
        <div class="stat"><div class="stat-val">{report.total_rows:,}</div><div class="stat-label">Total Rows</div></div>
        <div class="stat"><div class="stat-val">{report.total_columns}</div><div class="stat-label">Columns</div></div>
        <div class="stat"><div class="stat-val">{report.duplicate_pct}%</div><div class="stat-label">Duplicates</div></div>
        <div class="stat"><div class="stat-val">{len(report.issues)}</div><div class="stat-label">Issues</div></div>
    </div>

    <h2>⚠️ Issues ({len(report.issues)})</h2>
    <table>
        <thead><tr><th>Severity</th><th>Category</th><th>Message</th><th>Suggestion</th></tr></thead>
        <tbody>{issues_html if issues_html else '<tr><td colspan="4" style="text-align:center;color:#10b981;padding:20px">No issues found ✅</td></tr>'}</tbody>
    </table>

    <h2>📋 Column Details ({len(report.columns)})</h2>
    <table>
        <thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Issues</th></tr></thead>
        <tbody>{columns_html}</tbody>
    </table>

    <div class="footer">
        Generated by SmeltLab — AI-Powered Data Cleaning Platform
    </div>
</body></html>'''


# ---------------------------------------------------------------------------
# Data Augmentation
# ---------------------------------------------------------------------------

import asyncio
import json as _json
import dataclasses


@router.post("/{dataset_id}/augment", response_model=AugmentStartResponse)
async def start_augmentation(dataset_id: str, request: AugmentRequest):
    """Start a data augmentation task. Returns task_id for SSE streaming."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]
    total_rows = len(df)

    # Calculate target count
    if request.target_count:
        target = request.target_count
    else:
        target = max(1, int(total_rows * (request.multiplier - 1)))

    task_id = str(uuid.uuid4())
    task = AugmentTask(
        task_id=task_id,
        dataset_id=dataset_id,
        strategy=request.strategy,
        multiplier=request.multiplier,
        target_count=target,
        columns=request.columns,
    )
    _augment_tasks[task_id] = task

    # Start augmentation in background thread
    run_augment_thread(task, df)

    return AugmentStartResponse(
        task_id=task_id,
        dataset_id=dataset_id,
        strategy=request.strategy,
        target_count=target,
        stream_url=f"/api/datasets/{dataset_id}/augment/{task_id}/stream",
    )


@router.get("/{dataset_id}/augment/{task_id}/stream")
async def augment_stream(dataset_id: str, task_id: str):
    """SSE stream of augmentation progress with real-time examples."""
    from sse_starlette.sse import EventSourceResponse

    task = _augment_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Augmentation task not found")

    async def event_generator():
        while True:
            # Poll the thread-safe queue from the async context
            try:
                progress = await asyncio.to_thread(task.progress_queue.get, True, 2.0)
            except Exception:
                # Queue empty — send heartbeat
                yield {"event": "heartbeat", "data": _json.dumps({"phase": "heartbeat"})}
                continue

            if progress is None:
                # Sentinel — stream is done
                yield {"event": "message", "data": _json.dumps({"phase": "done", "message": "complete"})}
                break

            data = {
                "task_id": progress.task_id,
                "phase": progress.phase,
                "progress_pct": round(progress.progress_pct, 1),
                "processed": progress.processed,
                "total": progress.total,
                "stats": progress.stats,
                "message": progress.message,
            }

            if progress.example:
                data["example"] = {
                    "row_index": progress.example.row_index,
                    "technique": progress.example.technique,
                    "original": {k: str(v)[:300] for k, v in progress.example.original.items()},
                    "augmented": {k: str(v)[:300] for k, v in progress.example.augmented.items()},
                    "changes": progress.example.changes[:5],
                }

            yield {"event": "message", "data": _json.dumps(data, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


@router.post("/{dataset_id}/augment/{task_id}/apply", response_model=AugmentApplyResponse)
async def apply_augment(dataset_id: str, task_id: str):
    """Apply augmentation results — merge new samples into the dataset."""
    task = _augment_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Augmentation task not found")
    if task.status not in ("done", "cancelled"):
        raise HTTPException(400, f"Task is still {task.status}. Wait for completion.")

    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]
    original_count = len(df)

    # Apply augmentation
    augmented_df = apply_augmentation(df, task.results)

    # Store augmented DataFrame
    aug_key = f"{dataset_id}_augmented_{task_id}"
    _dataframes[aug_key] = augmented_df

    # Also update the main dataframe store
    _dataframes[dataset_id] = augmented_df

    return AugmentApplyResponse(
        dataset_id=dataset_id,
        augmented_key=aug_key,
        total_original=original_count,
        total_augmented=len(augmented_df),
        new_rows_added=len(augmented_df) - original_count,
    )


@router.post("/{dataset_id}/augment/{task_id}/cancel")
async def cancel_augment(dataset_id: str, task_id: str):
    """Cancel a running augmentation task."""
    task = _augment_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Augmentation task not found")

    task.cancelled = True
    task.status = "cancelled"

    return {"status": "cancelled", "task_id": task_id, "results_so_far": len(task.results)}
