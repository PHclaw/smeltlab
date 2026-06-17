"""
Data Profiler Engine — Automatic data health analysis.

Upload a CSV/JSON/JSONL/Excel file and get a comprehensive health report:
- Schema inference (column types)
- Missing value detection
- Duplicate detection
- Outlier detection
- Quality score (0-100)
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ColumnProfile:
    name: str
    inferred_type: str  # string | integer | float | boolean | date | datetime | email | phone | url
    null_count: int = 0
    null_pct: float = 0.0
    unique_count: int = 0
    unique_pct: float = 0.0
    sample_values: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


@dataclass
class Issue:
    severity: str  # critical | warning | info
    category: str  # duplication | missing | format | outlier | consistency
    message: str
    affected_rows: int = 0
    affected_column: str | None = None
    suggestion: str = ""


@dataclass
class ProfileReport:
    health_score: int = 100
    total_rows: int = 0
    total_columns: int = 0
    file_size_bytes: int = 0
    duplicate_rows: int = 0
    duplicate_pct: float = 0.0
    columns: list[ColumnProfile] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Type inference
# ---------------------------------------------------------------------------

import re

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
_PHONE_RE = re.compile(r"^[\+]?[\d\s\-\(\)]{7,20}$")
_URL_RE = re.compile(r"^https?://")
_DATE_FORMATS = [
    "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d",
    "%d-%m-%Y", "%m-%d-%Y", "%Y.%m.%d", "%d.%m.%Y",
    "%Y年%m月%d日", "%B %d, %Y", "%b %d, %Y",
]


def _infer_semantic_type(series: pl.Series) -> str:
    """Infer semantic type from non-null string values."""
    sample = series.drop_nulls().head(100).to_list()
    if not sample:
        return "string"

    str_sample = [str(v) for v in sample]

    # Check email
    email_matches = sum(1 for v in str_sample if _EMAIL_RE.match(v))
    if email_matches / len(str_sample) > 0.8:
        return "email"

    # Check URL
    url_matches = sum(1 for v in str_sample if _URL_RE.match(v))
    if url_matches / len(str_sample) > 0.8:
        return "url"

    # Check phone
    phone_matches = sum(1 for v in str_sample if _PHONE_RE.match(v))
    if phone_matches / len(str_sample) > 0.8:
        return "phone"

    # Check date (string dates)
    from datetime import datetime
    for fmt in _DATE_FORMATS:
        try:
            matches = sum(1 for v in str_sample if _try_parse_date(v, fmt))
            if matches / len(str_sample) > 0.7:
                return "date"
        except Exception:
            continue

    return "string"


def _try_parse_date(value: str, fmt: str) -> bool:
    from datetime import datetime
    try:
        datetime.strptime(value.strip(), fmt)
        return True
    except (ValueError, AttributeError):
        return False


def _infer_column_type(series: pl.Series) -> str:
    """Infer the logical type of a column."""
    dtype = series.dtype

    if dtype in (pl.Boolean,):
        return "boolean"
    if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64):
        return "integer"
    if dtype in (pl.Float32, pl.Float64):
        return "float"
    if dtype in (pl.Date,):
        return "date"
    if dtype in (pl.Datetime,):
        return "datetime"

    # For string columns, do semantic inference
    if dtype in (pl.Utf8, pl.String):
        return _infer_semantic_type(series)

    return "string"


# ---------------------------------------------------------------------------
# Distribution data (histogram / top values)
# ---------------------------------------------------------------------------

def _build_histogram(series: pl.Series, num_bins: int = 10) -> list[dict[str, Any]]:
    """Build histogram bins for a numeric series."""
    non_null = series.drop_nulls()
    if len(non_null) == 0:
        return []

    try:
        min_val = non_null.min()
        max_val = non_null.max()
        if min_val is None or max_val is None:
            return []
        if min_val == max_val:
            return [{"bin": str(min_val), "count": len(non_null)}]

        bin_width = (max_val - min_val) / num_bins
        bins = []
        for i in range(num_bins):
            low = min_val + i * bin_width
            high = min_val + (i + 1) * bin_width if i < num_bins - 1 else max_val + 1e-9
            count = non_null.filter((non_null >= low) & (non_null < high)).len()
            # Label
            if bin_width >= 1:
                label = f"{round(low, 1)}-{round(high, 1)}"
            else:
                label = f"{low:.2f}-{high:.2f}"
            bins.append({"bin": label, "count": count})
        return bins
    except Exception:
        return []


def _build_top_values(series: pl.Series, top_n: int = 10) -> list[dict[str, Any]]:
    """Get top N most frequent values for a categorical/string series."""
    non_null = series.drop_nulls()
    if len(non_null) == 0:
        return []

    try:
        # Value counts
        counts = non_null.value_counts()
        # Sort by count descending, take top N
        counts = counts.sort("count", descending=True).head(top_n)
        col_name = non_null.name
        result = []
        for row in counts.iter_rows(named=True):
            value = row.get(col_name, row.get("value", ""))
            count = row.get("count", 0)
            result.append({"value": str(value)[:50], "count": count})
        return result
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Column profiling
# ---------------------------------------------------------------------------

def _profile_column(df: pl.DataFrame, col_name: str) -> ColumnProfile:
    """Profile a single column."""
    series = df[col_name]
    total = len(series)
    null_count = series.null_count()
    unique_count = series.n_unique()

    inferred_type = _infer_column_type(series)

    # Sample values (non-null, up to 5)
    non_null = series.drop_nulls().head(5).to_list()
    sample_values = [str(v) for v in non_null]

    profile = ColumnProfile(
        name=col_name,
        inferred_type=inferred_type,
        null_count=null_count,
        null_pct=round(null_count / total * 100, 2) if total > 0 else 0,
        unique_count=unique_count,
        unique_pct=round(unique_count / total * 100, 2) if total > 0 else 0,
        sample_values=sample_values,
    )

    # Numeric stats
    if inferred_type in ("integer", "float"):
        try:
            profile.stats = {
                "min": series.min(),
                "max": series.max(),
                "mean": round(series.mean(), 4) if series.mean() is not None else None,
                "median": series.median(),
                "std": round(series.std(), 4) if series.std() is not None else None,
            }
            # Generate histogram for numeric columns
            profile.stats["histogram"] = _build_histogram(series)
        except Exception:
            pass

    # Top values for categorical / string / boolean columns
    if inferred_type in ("string", "email", "phone", "url", "boolean", "date"):
        profile.stats["top_values"] = _build_top_values(series)

    # Detect issues for this column
    _detect_column_issues(series, profile, total)

    return profile


def _detect_column_issues(series: pl.Series, profile: ColumnProfile, total: int) -> None:
    """Detect issues specific to a column."""
    # High missing rate
    if profile.null_pct > 20:
        profile.issues.append(f"{profile.null_pct}% values are missing")
    elif profile.null_pct > 5:
        profile.issues.append(f"{profile.null_pct}% values are missing")

    # All same value
    if profile.unique_count == 1 and total > 1:
        profile.issues.append("All values are identical (constant column)")

    # High cardinality for categorical-like columns
    if profile.inferred_type == "string" and profile.unique_pct > 95 and total > 100:
        profile.issues.append("Very high cardinality — may be an ID field")

    # Label inconsistency — detect case variations in low-cardinality string columns
    if profile.inferred_type == "string" and 2 <= profile.unique_count <= 100 and total > 10:
        _check_label_inconsistency(series, profile)

    # Format inconsistency for dates
    if profile.inferred_type == "date":
        _check_date_format_consistency(series, profile)

    # Email format validation
    if profile.inferred_type == "email":
        non_null = series.drop_nulls().head(500)
        invalid = sum(1 for v in non_null.to_list() if not _EMAIL_RE.match(str(v)))
        if invalid > 0:
            pct = round(invalid / len(non_null) * 100, 1)
            profile.issues.append(f"~{pct}% of values have invalid email format")

    # Outlier detection for numeric
    if profile.inferred_type in ("integer", "float") and profile.stats:
        _check_outliers(series, profile)


def _check_date_format_consistency(series: pl.Series, profile: ColumnProfile) -> None:
    """Check if date column has mixed formats."""
    from datetime import datetime
    sample = series.drop_nulls().head(200).to_list()
    str_sample = [str(v) for v in sample]

    format_counts: dict[str, int] = {}
    for fmt in _DATE_FORMATS:
        count = sum(1 for v in str_sample if _try_parse_date(v, fmt))
        if count > 0:
            format_counts[fmt] = count

    if len(format_counts) > 1:
        formats_str = ", ".join(format_counts.keys())
        profile.issues.append(f"Mixed date formats detected: {formats_str}")


def _check_outliers(series: pl.Series, profile: ColumnProfile) -> None:
    """Simple IQR-based outlier detection."""
    try:
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        if q1 is not None and q3 is not None:
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            outliers = series.filter((series < lower) | (series > upper))
            outlier_count = len(outliers)
            if outlier_count > 0:
                pct = round(outlier_count / len(series) * 100, 1)
                profile.issues.append(f"{outlier_count} outlier values ({pct}%)")
                profile.stats["outlier_count"] = outlier_count
    except Exception:
        pass


def _check_label_inconsistency(series: pl.Series, profile: ColumnProfile) -> None:
    """Detect case variations and whitespace issues in label-like columns."""
    try:
        values = series.drop_nulls().to_list()
        if not values:
            return

        str_values = [str(v) for v in values]

        # Check for case variations: "Positive" vs "positive" vs "POSITIVE"
        lower_map: dict[str, set[str]] = {}
        for v in str_values:
            key = v.strip().lower()
            if key not in lower_map:
                lower_map[key] = set()
            lower_map[key].add(v)

        inconsistent_groups = {k: v for k, v in lower_map.items() if len(v) > 1}

        if inconsistent_groups:
            examples = []
            for key, variants in list(inconsistent_groups.items())[:3]:
                examples.append(f"'{' / '.join(sorted(variants))}'")
            profile.issues.append(
                f"Inconsistent label casing: {', '.join(examples)} — consider normalizing"
            )
            profile.stats["label_inconsistencies"] = len(inconsistent_groups)

        # Check for leading/trailing whitespace
        whitespace_count = sum(1 for v in str_values if v != v.strip())
        if whitespace_count > 0:
            pct = round(whitespace_count / len(str_values) * 100, 1)
            profile.issues.append(f"{whitespace_count} values with extra whitespace ({pct}%)")

    except Exception:
        pass


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

def _detect_duplicates(df: pl.DataFrame) -> tuple[int, float]:
    """Detect exact duplicate rows."""
    total = len(df)
    if total == 0:
        return 0, 0.0

    # Count exact duplicates
    unique_count = df.unique().height
    dup_count = total - unique_count
    dup_pct = round(dup_count / total * 100, 2) if total > 0 else 0.0
    return dup_count, dup_pct


# ---------------------------------------------------------------------------
# Health score
# ---------------------------------------------------------------------------

def _compute_health_score(
    total_rows: int,
    dup_pct: float,
    columns: list[ColumnProfile],
) -> int:
    """Compute overall data health score (0-100)."""
    if total_rows == 0:
        return 0

    score = 100.0

    # Deduct for duplicates (max -30)
    score -= min(dup_pct * 2, 30)

    # Deduct for missing values (average across columns, max -30)
    if columns:
        avg_missing = sum(c.null_pct for c in columns) / len(columns)
        score -= min(avg_missing * 1.5, 30)

    # Deduct for column issues (max -30)
    total_issues = sum(len(c.issues) for c in columns)
    score -= min(total_issues * 3, 30)

    # Deduct for constant columns (max -10)
    constant_cols = sum(1 for c in columns if c.unique_count == 1 and total_rows > 1)
    score -= min(constant_cols * 5, 10)

    return max(0, min(100, round(score)))


# ---------------------------------------------------------------------------
# Issue generation
# ---------------------------------------------------------------------------

def _generate_issues(
    dup_count: int,
    dup_pct: float,
    columns: list[ColumnProfile],
    total_rows: int,
) -> list[Issue]:
    """Generate global issue list."""
    issues: list[Issue] = []

    # Duplicate issue
    if dup_count > 0:
        severity = "critical" if dup_pct > 10 else "warning" if dup_pct > 2 else "info"
        issues.append(Issue(
            severity=severity,
            category="duplication",
            message=f"{dup_count} duplicate rows ({dup_pct}%)",
            affected_rows=dup_count,
            suggestion="Remove exact and near-duplicate rows",
        ))

    # Column-level issues
    for col in columns:
        for issue_msg in col.issues:
            severity = _classify_issue_severity(issue_msg, col.null_pct)
            category = _classify_issue_category(issue_msg)
            issues.append(Issue(
                severity=severity,
                category=category,
                message=f"[{col.name}] {issue_msg}",
                affected_column=col.name,
                affected_rows=col.null_count if "missing" in issue_msg.lower() else 0,
                suggestion=_suggest_fix(category, col),
            ))

    # Sort: critical first
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: severity_order.get(i.severity, 3))

    return issues


def _classify_issue_severity(msg: str, null_pct: float) -> str:
    msg_lower = msg.lower()
    if "missing" in msg_lower and null_pct > 20:
        return "critical"
    if "missing" in msg_lower:
        return "warning"
    if "duplicate" in msg_lower or "identical" in msg_lower:
        return "critical"
    if "outlier" in msg_lower:
        return "warning"
    if "invalid" in msg_lower or "mixed" in msg_lower:
        return "warning"
    if "high cardinality" in msg_lower:
        return "info"
    return "info"


def _classify_issue_category(msg: str) -> str:
    msg_lower = msg.lower()
    if "missing" in msg_lower:
        return "missing"
    if "duplicate" in msg_lower or "identical" in msg_lower:
        return "duplication"
    if "outlier" in msg_lower:
        return "outlier"
    if "format" in msg_lower or "invalid" in msg_lower or "mixed" in msg_lower:
        return "format"
    if "cardinality" in msg_lower:
        return "consistency"
    return "consistency"


def _suggest_fix(category: str, col: ColumnProfile) -> str:
    suggestions = {
        "missing": f"Fill missing values in '{col.name}' using mean/median/mode or drop rows",
        "duplication": "Remove duplicate rows",
        "outlier": f"Review and filter outlier values in '{col.name}'",
        "format": f"Standardize format for '{col.name}' column",
        "consistency": f"Review consistency of '{col.name}' values",
    }
    return suggestions.get(category, f"Review '{col.name}' column")


# ---------------------------------------------------------------------------
# File readers
# ---------------------------------------------------------------------------

def read_file(file_path: str | Path, file_format: str | None = None) -> pl.DataFrame:
    """Read a file into a Polars DataFrame."""
    path = Path(file_path)

    if file_format is None:
        file_format = path.suffix.lstrip(".").lower()

    readers = {
        "csv": lambda p: pl.read_csv(p, infer_schema_length=10000, try_parse_dates=True, ignore_errors=True),
        "json": lambda p: pl.read_json(p),
        "jsonl": lambda p: pl.read_ndjson(p),
        "ndjson": lambda p: pl.read_ndjson(p),
        "xlsx": lambda p: pl.read_excel(p),
        "xls": lambda p: pl.read_excel(p),
        "parquet": lambda p: pl.read_parquet(p),
    }

    reader = readers.get(file_format)
    if reader is None:
        raise ValueError(f"Unsupported file format: {file_format}. Supported: {list(readers.keys())}")

    return reader(path)


def read_file_bytes(data: bytes, file_format: str) -> pl.DataFrame:
    """Read file from bytes."""
    readers = {
        "csv": lambda d: pl.read_csv(io.BytesIO(d), infer_schema_length=10000, try_parse_dates=True, ignore_errors=True),
        "json": lambda d: pl.read_json(io.BytesIO(d)),
        "jsonl": lambda d: pl.read_ndjson(io.BytesIO(d)),
        "ndjson": lambda d: pl.read_ndjson(io.BytesIO(d)),
        "xlsx": lambda d: pl.read_excel(io.BytesIO(d)),
        "parquet": lambda d: pl.read_parquet(io.BytesIO(d)),
    }

    reader = readers.get(file_format)
    if reader is None:
        raise ValueError(f"Unsupported file format: {file_format}")

    return reader(data)


# ---------------------------------------------------------------------------
# Main profiling entry point
# ---------------------------------------------------------------------------

def profile_data(df: pl.DataFrame, file_size_bytes: int = 0) -> ProfileReport:
    """
    Run full data profiling on a DataFrame.

    Returns a ProfileReport with health score, column profiles, issues, and preview.
    """
    total_rows = len(df)
    total_columns = len(df.columns)

    if total_rows == 0:
        return ProfileReport(
            health_score=0,
            issues=[Issue(
                severity="critical",
                category="consistency",
                message="Dataset is empty",
                suggestion="Upload a dataset with at least 1 row",
            )],
        )

    # Profile each column
    columns = [_profile_column(df, col) for col in df.columns]

    # Detect duplicates
    dup_count, dup_pct = _detect_duplicates(df)

    # Compute health score
    health_score = _compute_health_score(total_rows, dup_pct, columns)

    # Generate issues
    issues = _generate_issues(dup_count, dup_pct, columns, total_rows)

    # Preview rows (first 20)
    preview = df.head(20).to_dicts()
    # Convert non-serializable types
    for row in preview:
        for k, v in row.items():
            if not isinstance(v, (str, int, float, bool, type(None))):
                row[k] = str(v)

    return ProfileReport(
        health_score=health_score,
        total_rows=total_rows,
        total_columns=total_columns,
        file_size_bytes=file_size_bytes,
        duplicate_rows=dup_count,
        duplicate_pct=dup_pct,
        columns=columns,
        issues=issues,
        preview_rows=preview,
    )


def profile_file(file_path: str | Path, file_format: str | None = None) -> ProfileReport:
    """Profile a file directly from disk."""
    path = Path(file_path)
    file_size = path.stat().st_size
    df = read_file(path, file_format)
    return profile_data(df, file_size)
