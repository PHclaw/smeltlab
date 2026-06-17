"""
Smart Sampler — intelligent data sampling strategies.

Supports:
- Random sampling
- Stratified sampling (preserves class distribution)
- Head/tail sampling
- Cluster-based sampling (diverse representative)
"""

from __future__ import annotations

from typing import Any

import polars as pl


def sample_data(
    df: pl.DataFrame,
    strategy: str = "random",
    n: int | None = None,
    fraction: float | None = None,
    stratify_column: str | None = None,
    seed: int = 42,
) -> pl.DataFrame:
    """
    Sample data using the specified strategy.

    Args:
        df: Input DataFrame
        strategy: random | stratified | head | tail | diverse
        n: Target number of rows (mutually exclusive with fraction)
        fraction: Target fraction 0-1 (mutually exclusive with n)
        stratify_column: Column to stratify by (for stratified strategy)
        seed: Random seed for reproducibility
    """
    total = len(df)
    if total == 0:
        return df

    # Determine target size
    if n is not None:
        target = min(n, total)
    elif fraction is not None:
        target = max(1, int(total * fraction))
    else:
        target = min(10000, total)  # Default: 10K or all

    if target >= total:
        return df

    if strategy == "head":
        return df.head(target)

    if strategy == "tail":
        return df.tail(target)

    if strategy == "random":
        return _random_sample(df, target, seed)

    if strategy == "stratified":
        if stratify_column is None:
            # Auto-detect: find low-cardinality string/int column
            stratify_column = _auto_detect_stratify_col(df)
        if stratify_column is None:
            return _random_sample(df, target, seed)
        return _stratified_sample(df, target, stratify_column, seed)

    if strategy == "diverse":
        return _diverse_sample(df, target, seed)

    # Fallback
    return _random_sample(df, target, seed)


def _random_sample(df: pl.DataFrame, n: int, seed: int) -> pl.DataFrame:
    """Simple random sampling."""
    return df.sample(n=n, seed=seed, shuffle=True)


def _stratified_sample(
    df: pl.DataFrame,
    n: int,
    col: str,
    seed: int,
) -> pl.DataFrame:
    """Stratified sampling — preserve class proportions."""
    if col not in df.columns:
        return _random_sample(df, n, seed)

    total = len(df)
    groups = df.group_by(col)

    # Calculate per-group sample sizes proportional to group size
    group_counts = groups.len().sort(col)
    sampled_parts = []

    for row in group_counts.iter_rows(named=True):
        group_val = row[col]
        group_size = row["len"]
        # Proportional allocation
        group_n = max(1, round(group_size / total * n))
        group_n = min(group_n, group_size)

        group_df = df.filter(pl.col(col) == group_val)
        sampled_parts.append(group_df.sample(n=group_n, seed=seed, shuffle=True))

    if not sampled_parts:
        return df.head(n)

    result = pl.concat(sampled_parts)

    # Adjust if we overshot or undershot
    if len(result) > n:
        result = result.sample(n=n, seed=seed)
    elif len(result) < n and len(result) < total:
        # Fill remaining from underrepresented groups
        remaining = n - len(result)
        already_indices = set()  # We can't easily track indices, so just sample more
        extra = df.sample(n=min(remaining + 100, total), seed=seed + 1, shuffle=True)
        result = pl.concat([result, extra]).unique().head(n)

    return result


def _diverse_sample(df: pl.DataFrame, n: int, seed: int) -> pl.DataFrame:
    """
    Diverse sampling — try to get representative rows from different parts of the data.
    Combines head, middle, tail, and random samples.
    """
    total = len(df)
    if n >= total:
        return df

    # Split into segments
    quarter = n // 4
    remainder = n - quarter * 3

    parts = [
        df.head(quarter),                                    # Beginning
        df.slice(total // 4, quarter),                       # Quarter point
        df.slice(total // 2, quarter),                       # Middle
        df.tail(quarter + remainder),                        # End
    ]

    result = pl.concat(parts)
    if len(result) > n:
        result = result.sample(n=n, seed=seed)

    return result


def _auto_detect_stratify_col(df: pl.DataFrame) -> str | None:
    """Find the best column for stratification (low cardinality, non-unique)."""
    best_col = None
    best_score = -1

    for col in df.columns:
        n_unique = df[col].n_unique()
        total = len(df)

        if n_unique < 2 or n_unique > 50:
            continue

        # Prefer columns with 2-20 unique values and moderate cardinality
        unique_pct = n_unique / total * 100
        if unique_pct > 10:
            continue

        score = 1.0 / (abs(n_unique - 5) + 1)  # Prefer ~5 categories
        if score > best_score:
            best_score = score
            best_col = col

    return best_col
