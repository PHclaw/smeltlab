"""
Data Drift Detection — compare distributions before and after cleaning.

Detects significant distributional shifts per column using:
- Numeric: Kolmogorov-Smirnov-like statistic (max CDF difference)
- Categorical: Population Stability Index (PSI) approximation
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import polars as pl


@dataclass
class ColumnDrift:
    column: str
    col_type: str  # numeric | categorical
    drift_score: float  # 0-1, higher = more drift
    severity: str  # none | low | medium | high
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class DriftReport:
    total_columns: int
    drifted_columns: int
    drift_results: list[ColumnDrift] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Numeric drift — KS-like statistic
# ---------------------------------------------------------------------------

def _numeric_drift(before: pl.Series, after: pl.Series, col: str) -> ColumnDrift:
    """Compute distribution drift for a numeric column."""
    before_clean = before.drop_nulls()
    after_clean = after.drop_nulls()

    if len(before_clean) == 0 or len(after_clean) == 0:
        return ColumnDrift(col, "numeric", 0.0, "none")

    # Compare basic stats
    b_mean = before_clean.mean()
    a_mean = after_clean.mean()
    b_std = before_clean.std()
    a_std = after_clean.std()

    details: dict[str, Any] = {
        "before_mean": round(b_mean, 4) if b_mean else None,
        "after_mean": round(a_mean, 4) if a_mean else None,
        "before_std": round(b_std, 4) if b_std else None,
        "after_std": round(a_std, 4) if a_std else None,
        "before_min": before_clean.min(),
        "after_min": after_clean.min(),
        "before_max": before_clean.max(),
        "after_max": after_clean.max(),
        "before_count": len(before_clean),
        "after_count": len(after_clean),
    }

    # KS-like: compare quantiles
    quantiles = [0.1, 0.25, 0.5, 0.75, 0.9]
    max_diff = 0.0
    total_range = (before_clean.max() or 1) - (before_clean.min() or 0)
    if total_range == 0:
        total_range = 1

    for q in quantiles:
        b_q = before_clean.quantile(q)
        a_q = after_clean.quantile(q)
        if b_q is not None and a_q is not None:
            diff = abs(b_q - a_q) / total_range
            max_diff = max(max_diff, diff)

    # Also factor in row reduction
    row_reduction = abs(len(before_clean) - len(after_clean)) / max(len(before_clean), 1)
    drift_score = min(1.0, max_diff * 0.7 + row_reduction * 0.3)

    if drift_score < 0.1:
        severity = "none"
    elif drift_score < 0.3:
        severity = "low"
    elif drift_score < 0.6:
        severity = "medium"
    else:
        severity = "high"

    return ColumnDrift(col, "numeric", round(drift_score, 4), severity, details)


# ---------------------------------------------------------------------------
# Categorical drift — PSI approximation
# ---------------------------------------------------------------------------

def _categorical_drift(before: pl.Series, after: pl.Series, col: str) -> ColumnDrift:
    """Compute distribution drift for a categorical column using PSI-like metric."""
    before_clean = before.drop_nulls()
    after_clean = after.drop_nulls()

    if len(before_clean) == 0 or len(after_clean) == 0:
        return ColumnDrift(col, "categorical", 0.0, "none")

    # Value frequency distributions
    b_counts = before_clean.value_counts()
    a_counts = after_clean.value_counts()

    # Get all unique values
    b_vals = set(b_counts[b_counts.columns[0]].to_list())
    a_vals = set(a_counts[a_counts.columns[0]].to_list())
    all_vals = b_vals | a_vals

    # Build frequency maps
    b_total = len(before_clean)
    a_total = len(after_clean)

    b_freq = {}
    for row in b_counts.iter_rows(named=True):
        b_freq[row[b_counts.columns[0]]] = row["count"] / b_total

    a_freq = {}
    for row in a_counts.iter_rows(named=True):
        a_freq[row[a_counts.columns[0]]] = row["count"] / a_total

    # PSI calculation
    psi = 0.0
    new_values = []
    removed_values = []

    for val in all_vals:
        bp = b_freq.get(val, 0.0001)  # small epsilon to avoid log(0)
        ap = a_freq.get(val, 0.0001)
        psi += (ap - bp) * (ap / bp if bp > 0 else 10)

        if val in a_vals and val not in b_vals:
            new_values.append(str(val))
        elif val in b_vals and val not in a_vals:
            removed_values.append(str(val))

    # Normalize PSI to 0-1 range
    drift_score = min(1.0, abs(psi) / 2.0)

    details = {
        "before_unique": len(b_vals),
        "after_unique": len(a_vals),
        "new_values": new_values[:10],
        "removed_values": removed_values[:10],
        "psi_raw": round(psi, 4),
    }

    if drift_score < 0.1:
        severity = "none"
    elif drift_score < 0.25:
        severity = "low"
    elif drift_score < 0.5:
        severity = "medium"
    else:
        severity = "high"

    return ColumnDrift(col, "categorical", round(drift_score, 4), severity, details)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def detect_drift(df_before: pl.DataFrame, df_after: pl.DataFrame) -> DriftReport:
    """Compare distributions between before and after DataFrames."""
    results: list[ColumnDrift] = []

    # Only compare columns that exist in both
    common_cols = [c for c in df_before.columns if c in df_after.columns]

    for col in common_cols:
        b_series = df_before[col]
        a_series = df_after[col]

        if b_series.dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.Float32, pl.Float64,
                               pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64):
            results.append(_numeric_drift(b_series, a_series, col))
        elif b_series.dtype in (pl.Utf8, pl.String, pl.Boolean):
            results.append(_categorical_drift(b_series, a_series, col))

    drifted = sum(1 for r in results if r.severity != "none")

    return DriftReport(
        total_columns=len(common_cols),
        drifted_columns=drifted,
        drift_results=results,
    )
