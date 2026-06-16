"""Dataset management endpoints — upload, profile, preview, export."""

from __future__ import annotations

import io
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.schemas.api import (
    DatasetUploadResponse,
    PreviewResponse,
    ProfileResponse,
)
from app.services.profiler import profile_data, read_file_bytes

router = APIRouter()
settings = get_settings()

# In-memory store for MVP (replace with DB later)
_datasets: dict[str, dict] = {}
_dataframes: dict[str, object] = {}  # dataset_id -> pl.DataFrame
_profiles: dict[str, dict] = {}


def _detect_format(filename: str) -> str:
    ext = Path(filename).suffix.lstrip(".").lower()
    format_map = {"xls": "xlsx", "ndjson": "jsonl"}
    return format_map.get(ext, ext)


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(file: UploadFile = File(...)):
    """Upload a data file and run automatic profiling."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    file_format = _detect_format(file.filename)
    supported = {"csv", "json", "jsonl", "xlsx", "parquet"}
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
    }
    _dataframes[dataset_id] = df

    # Auto-profile
    try:
        report = profile_data(df, file_size)
        _profiles[dataset_id] = report
    except Exception as e:
        _datasets[dataset_id]["status"] = "error"
        raise HTTPException(500, f"Profiling failed: {e}")

    return DatasetUploadResponse(
        id=dataset_id,
        name=file.filename,
        format=file_format,
        row_count=len(df),
        col_count=len(df.columns),
        file_size_bytes=file_size,
        status="ready",
    )


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
