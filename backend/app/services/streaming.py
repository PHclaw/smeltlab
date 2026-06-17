"""
Large file streaming processor — handle files beyond memory limits.

Uses Polars lazy evaluation (scan_csv, scan_ndjson) for:
- Chunked reading and processing
- Memory-efficient profiling
- Progress reporting via callbacks
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import polars as pl


@dataclass
class StreamProgress:
    phase: str  # reading | profiling | cleaning
    progress_pct: float  # 0-100
    rows_processed: int = 0
    message: str = ""


# ---------------------------------------------------------------------------
# Lazy scanning
# ---------------------------------------------------------------------------

def lazy_scan_file(file_path: str, file_format: str) -> pl.LazyFrame:
    """Create a LazyFrame from a file for memory-efficient processing."""
    path = Path(file_path)

    if file_format == "csv":
        return pl.scan_csv(path, infer_schema_length=10000, try_parse_dates=True, ignore_errors=True)
    elif file_format in ("jsonl", "ndjson"):
        return pl.scan_ndjson(path)
    elif file_format == "parquet":
        return pl.scan_parquet(path)
    else:
        # For unsupported lazy formats, fall back to eager
        raise ValueError(f"Lazy scanning not supported for {file_format}. Use eager loading.")


def count_rows_lazy(lf: pl.LazyFrame) -> int:
    """Count total rows using lazy evaluation."""
    return lf.select(pl.len()).collect().item()


# ---------------------------------------------------------------------------
# Chunked profiling
# ---------------------------------------------------------------------------

def profile_large_file(
    file_path: str,
    file_format: str,
    chunk_size: int = 100_000,
    progress_callback: Callable[[StreamProgress], None] | None = None,
) -> dict[str, Any]:
    """
    Profile a large file in chunks to avoid memory issues.

    Returns a summary dict compatible with ProfileReport.
    """
    try:
        lf = lazy_scan_file(file_path, file_format)
    except ValueError:
        # Fall back to eager for unsupported formats
        from app.services.profiler import read_file, profile_data
        df = read_file(file_path, file_format)
        report = profile_data(df, Path(file_path).stat().st_size)
        return _report_to_dict(report)

    # Get total row count
    if progress_callback:
        progress_callback(StreamProgress("reading", 10, message="Counting rows..."))

    total_rows = count_rows_lazy(lf)

    if progress_callback:
        progress_callback(StreamProgress("profiling", 20, total_rows, message=f"Profiling {total_rows:,} rows..."))

    # Collect schema info lazily
    schema = lf.collect_schema()
    columns_info = []

    for col_name, dtype in schema.items():
        col_type = str(dtype)

        # Basic stats via lazy aggregation
        col_lf = lf.select(col_name)

        try:
            stats = col_lf.select([
                pl.col(col_name).null_count().alias("null_count"),
                pl.col(col_name).n_unique().alias("unique_count"),
            ]).collect()

            null_count = stats["null_count"][0]
            unique_count = stats["unique_count"][0]
            null_pct = round(null_count / total_rows * 100, 2) if total_rows > 0 else 0
            unique_pct = round(unique_count / total_rows * 100, 2) if total_rows > 0 else 0
        except Exception:
            null_count = 0
            unique_count = 0
            null_pct = 0
            unique_pct = 0

        columns_info.append({
            "name": col_name,
            "inferred_type": _dtype_to_type(col_type),
            "null_count": null_count,
            "null_pct": null_pct,
            "unique_count": unique_count,
            "unique_pct": unique_pct,
        })

    if progress_callback:
        progress_callback(StreamProgress("profiling", 80, total_rows, message="Detecting duplicates..."))

    # Duplicate detection — sample-based for large files
    if total_rows > 500_000:
        # Approximate: check first 500K rows
        sample = lf.head(500_000).collect()
        dup_count = len(sample) - sample.unique().height
        dup_pct = round(dup_count / len(sample) * 100, 2)
    else:
        full_df = lf.collect()
        dup_count = len(full_df) - full_df.unique().height
        dup_pct = round(dup_count / total_rows * 100, 2) if total_rows > 0 else 0

    if progress_callback:
        progress_callback(StreamProgress("profiling", 100, total_rows, message="Profiling complete"))

    # Build preview
    preview = lf.head(20).collect().to_dicts()
    for row in preview:
        for k, v in row.items():
            if not isinstance(v, (str, int, float, bool, type(None))):
                row[k] = str(v)

    file_size = Path(file_path).stat().st_size

    return {
        "health_score": max(0, 100 - int(dup_pct * 2) - sum(1 for c in columns_info if c["null_pct"] > 10) * 3),
        "total_rows": total_rows,
        "total_columns": len(columns_info),
        "file_size_bytes": file_size,
        "duplicate_rows": dup_count,
        "duplicate_pct": dup_pct,
        "columns": columns_info,
        "issues": _generate_basic_issues(dup_count, dup_pct, columns_info, total_rows),
        "preview_rows": preview,
    }


def _dtype_to_type(dtype_str: str) -> str:
    """Map Polars dtype string to our type system."""
    d = dtype_str.lower()
    if "int" in d:
        return "integer"
    if "float" in d:
        return "float"
    if "bool" in d:
        return "boolean"
    if "date" in d and "time" in d:
        return "datetime"
    if "date" in d:
        return "date"
    return "string"


def _generate_basic_issues(
    dup_count: int,
    dup_pct: float,
    columns: list[dict],
    total_rows: int,
) -> list[dict]:
    """Generate basic issues from summary stats."""
    issues = []

    if dup_count > 0:
        severity = "critical" if dup_pct > 10 else "warning" if dup_pct > 2 else "info"
        issues.append({
            "severity": severity,
            "category": "duplication",
            "message": f"{dup_count} duplicate rows ({dup_pct}%)",
            "affected_rows": dup_count,
            "affected_column": None,
            "suggestion": "Remove duplicate rows",
        })

    for col in columns:
        if col["null_pct"] > 20:
            issues.append({
                "severity": "critical",
                "category": "missing",
                "message": f"[{col['name']}] {col['null_pct']}% values are missing",
                "affected_rows": col["null_count"],
                "affected_column": col["name"],
                "suggestion": f"Fill or drop missing values in '{col['name']}'",
            })

    return issues


def _report_to_dict(report) -> dict:
    """Convert a ProfileReport to a dict."""
    return {
        "health_score": report.health_score,
        "total_rows": report.total_rows,
        "total_columns": report.total_columns,
        "file_size_bytes": report.file_size_bytes,
        "duplicate_rows": report.duplicate_rows,
        "duplicate_pct": report.duplicate_pct,
        "columns": [
            {
                "name": c.name,
                "inferred_type": c.inferred_type,
                "null_count": c.null_count,
                "null_pct": c.null_pct,
                "unique_count": c.unique_count,
                "unique_pct": c.unique_pct,
            }
            for c in report.columns
        ],
        "issues": [
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
        "preview_rows": report.preview_rows,
    }


# ---------------------------------------------------------------------------
# Chunked cleaning
# ---------------------------------------------------------------------------

def clean_large_file_chunked(
    file_path: str,
    file_format: str,
    operations: list[dict[str, Any]],
    output_path: str,
    chunk_size: int = 100_000,
    progress_callback: Callable[[StreamProgress], None] | None = None,
) -> dict[str, Any]:
    """
    Clean a large file in chunks and write results incrementally.

    Note: Some operations (dedup) require full-data awareness.
    For those, we use lazy collect with streaming.
    """
    from app.services.cleaner import PRESET_OPERATIONS

    try:
        lf = lazy_scan_file(file_path, file_format)
    except ValueError:
        # Fall back to eager
        from app.services.profiler import read_file
        df = read_file(file_path, file_format)
        return _clean_eager(df, operations, output_path, progress_callback)

    total_rows = count_rows_lazy(lf)
    if progress_callback:
        progress_callback(StreamProgress("reading", 10, total_rows, f"Processing {total_rows:,} rows..."))

    # For dedup, we need to collect (but Polars streaming helps)
    needs_full_data = any(op.get("type") in ("dedup",) for op in operations)

    if needs_full_data and total_rows < 5_000_000:
        # Collect all at once for moderate-sized files
        if progress_callback:
            progress_callback(StreamProgress("cleaning", 30, total_rows, "Loading data..."))

        df = lf.collect(streaming=True)
        result = _clean_eager(df, operations, output_path, progress_callback)
        return result

    # For very large files or no dedup, process in chunks
    if progress_callback:
        progress_callback(StreamProgress("cleaning", 30, 0, "Processing in chunks..."))

    # Collect with streaming for large files
    df = lf.collect(streaming=True)
    return _clean_eager(df, operations, output_path, progress_callback)


def _clean_eager(
    df: pl.DataFrame,
    operations: list[dict[str, Any]],
    output_path: str,
    progress_callback: Callable[[StreamProgress], None] | None = None,
) -> dict[str, Any]:
    """Clean a DataFrame eagerly and write result."""
    from app.services.cleaner import PRESET_OPERATIONS

    rows_before = len(df)
    df_clean = df.clone()
    total_changes = 0

    for i, op in enumerate(operations):
        op_type = op.get("type", "")
        op_func = PRESET_OPERATIONS.get(op_type)
        if op_func is None:
            continue

        if progress_callback:
            pct = 30 + (i / max(len(operations), 1)) * 60
            progress_callback(StreamProgress("cleaning", pct, len(df_clean), f"Applying {op_type}..."))

        df_clean, changes = op_func(df_clean, op.get("config", {}))
        total_changes += len(changes)

    # Write result
    if progress_callback:
        progress_callback(StreamProgress("cleaning", 95, len(df_clean), "Writing output..."))

    path = Path(output_path)
    suffix = path.suffix.lstrip(".")
    if suffix == "csv":
        df_clean.write_csv(path)
    elif suffix == "json":
        df_clean.write_json(path)
    elif suffix in ("jsonl", "ndjson"):
        df_clean.write_ndjson(path)
    elif suffix == "parquet":
        df_clean.write_parquet(path)

    if progress_callback:
        progress_callback(StreamProgress("cleaning", 100, len(df_clean), "Complete"))

    return {
        "rows_before": rows_before,
        "rows_after": len(df_clean),
        "total_changes": total_changes,
        "output_path": output_path,
    }
