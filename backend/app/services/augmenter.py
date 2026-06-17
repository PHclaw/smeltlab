"""
Data Augmentation Service — generate new samples with visible process.

Runs CPU-bound augmentation in a SEPARATE THREAD to avoid blocking
the asyncio event loop (which serves HTTP/SSE requests).

Uses a thread-safe queue.Queue for progress updates that the SSE
endpoint polls via asyncio.to_thread.
"""

from __future__ import annotations

import asyncio
import json
import queue
import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import polars as pl


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class AugmentExample:
    row_index: int
    technique: str
    original: dict[str, Any]
    augmented: dict[str, Any]
    changes: list[str] = field(default_factory=list)


@dataclass
class AugmentProgress:
    task_id: str
    phase: str
    progress_pct: float
    processed: int
    total: int
    example: AugmentExample | None = None
    stats: dict[str, int] = field(default_factory=dict)
    message: str = ""


@dataclass
class AugmentTask:
    task_id: str
    dataset_id: str
    strategy: str
    multiplier: float
    target_count: int
    columns: list[str]
    status: str = "pending"
    # Thread-safe queue — producer (thread) puts, consumer (SSE) gets
    progress_queue: queue.Queue = field(default_factory=queue.Queue)
    results: list[AugmentExample] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)
    cancelled: bool = False


_tasks: dict[str, AugmentTask] = {}


# ---------------------------------------------------------------------------
# Synonym dictionary
# ---------------------------------------------------------------------------

_SYNONYMS = {
    "good": ["great", "excellent", "fine", "wonderful", "nice"],
    "bad": ["poor", "terrible", "awful", "horrible", "dreadful"],
    "big": ["large", "huge", "enormous", "massive", "substantial"],
    "small": ["tiny", "little", "miniature", "compact", "modest"],
    "fast": ["quick", "rapid", "swift", "speedy", "prompt"],
    "slow": ["sluggish", "gradual", "unhurried", "leisurely"],
    "happy": ["glad", "joyful", "pleased", "delighted", "content"],
    "sad": ["unhappy", "sorrowful", "gloomy", "melancholy", "dejected"],
    "important": ["crucial", "vital", "essential", "significant", "critical"],
    "easy": ["simple", "straightforward", "effortless", "uncomplicated"],
    "hard": ["difficult", "challenging", "tough", "demanding", "arduous"],
    "beautiful": ["gorgeous", "stunning", "attractive", "lovely", "elegant"],
    "old": ["ancient", "aged", "vintage", "elderly", "antique"],
    "new": ["fresh", "novel", "recent", "modern", "latest"],
    "said": ["stated", "mentioned", "remarked", "expressed", "noted"],
    "show": ["demonstrate", "display", "reveal", "present", "illustrate"],
    "help": ["assist", "aid", "support", "facilitate"],
    "use": ["utilize", "employ", "apply", "leverage"],
    "make": ["create", "produce", "build", "construct", "generate"],
    "get": ["obtain", "acquire", "receive", "gain", "fetch"],
}


# ---------------------------------------------------------------------------
# Text augmentation (synchronous — runs in thread)
# ---------------------------------------------------------------------------

def _synonym_replace(text: str, max_replacements: int = 3) -> tuple[str, list[str]]:
    words = text.split()
    changes = []
    replaced = 0
    for i in range(len(words)):
        if replaced >= max_replacements:
            break
        lower = words[i].lower().strip(".,!?;:")
        if lower in _SYNONYMS:
            synonym = random.choice(_SYNONYMS[lower])
            if words[i][0].isupper():
                synonym = synonym.capitalize()
            old_word = words[i]
            words[i] = synonym + words[i][len(lower):]
            changes.append(f"'{old_word}' -> '{words[i]}'")
            replaced += 1
    return " ".join(words), changes


def _random_insert(text: str) -> tuple[str, list[str]]:
    words = text.split()
    if len(words) < 2:
        return text, []
    filler = random.choice(["also", "very", "really", "quite", "indeed", "certainly"])
    pos = random.randint(1, len(words) - 1)
    words.insert(pos, filler)
    return " ".join(words), [f"inserted '{filler}' at pos {pos}"]


def _random_delete(text: str) -> tuple[str, list[str]]:
    words = text.split()
    if len(words) < 4:
        return text, []
    pos = random.randint(1, len(words) - 2)
    deleted = words.pop(pos)
    return " ".join(words), [f"deleted '{deleted}'"]


def _text_augment_row(text: str) -> tuple[str, str, list[str]]:
    technique = random.choice(["synonym", "synonym", "insert", "delete", "char_swap"])
    if technique == "synonym":
        result, changes = _synonym_replace(text)
        if changes:
            return result, "synonym_replace", changes
        # Fallback to char_swap if no synonyms found
        return _char_perturb(text)
    elif technique == "insert":
        result, changes = _random_insert(text)
        if changes:
            return result, "random_insert", changes
        return _char_perturb(text)
    elif technique == "delete":
        result, changes = _random_delete(text)
        if changes:
            return result, "random_delete", changes
        return _char_perturb(text)
    else:
        return _char_perturb(text)


def _char_perturb(text: str) -> tuple[str, str, list[str]]:
    """Character-level perturbation: swap adjacent chars, add punctuation, etc."""
    if len(text) < 2:
        return text, "char_perturb", []

    chars = list(text)
    op = random.choice(["swap", "dup_char", "case_flip", "add_space"])

    if op == "swap" and len(chars) >= 3:
        i = random.randint(1, len(chars) - 2)
        chars[i], chars[i-1] = chars[i-1], chars[i]
        change = f"swapped chars at pos {i-1},{i}"
    elif op == "dup_char" and len(chars) >= 2:
        i = random.randint(0, len(chars) - 1)
        chars.insert(i, chars[i])
        change = f"duplicated char '{chars[i]}' at pos {i}"
    elif op == "case_flip":
        i = random.randint(0, len(chars) - 1)
        if chars[i].isalpha():
            chars[i] = chars[i].swapcase()
            change = f"flipped case of '{chars[i]}' at pos {i}"
        else:
            return text, "char_perturb", []
    elif op == "add_space" and len(chars) >= 3:
        i = random.randint(1, len(chars) - 1)
        chars.insert(i, " ")
        change = f"added space at pos {i}"
    else:
        return text, "char_perturb", []

    return "".join(chars), "char_perturb", [change]


# ---------------------------------------------------------------------------
# Numeric augmentation (synchronous)
# ---------------------------------------------------------------------------

def _noise_inject(value: float, std_factor: float = 0.05) -> tuple[float, list[str]]:
    noise = random.gauss(0, abs(value) * std_factor + 0.01)
    new_val = round(value + noise, 4)
    return new_val, [f"{value} -> {new_val} (noise: {noise:+.4f})"]


def _interpolate(val_a: float, val_b: float) -> tuple[float, list[str]]:
    alpha = random.uniform(0.1, 0.9)
    new_val = round(val_a * alpha + val_b * (1 - alpha), 4)
    return new_val, [f"interpolate({val_a}, {val_b}, a={alpha:.2f}) = {new_val}"]


# ---------------------------------------------------------------------------
# Strategy detection
# ---------------------------------------------------------------------------

def _detect_strategy(df: pl.DataFrame) -> str:
    columns = df.columns
    if "messages" in columns or ("instruction" in columns and "output" in columns):
        return "llm_paraphrase"
    if "conversations" in columns:
        return "llm_paraphrase"
    numeric_cols = [c for c in columns if df[c].dtype in (pl.Float32, pl.Float64, pl.Int32, pl.Int64)]
    if len(numeric_cols) > len(columns) / 2:
        return "numeric_noise"
    return "text_augment"


# ---------------------------------------------------------------------------
# Thread-based augmentation runner
# ---------------------------------------------------------------------------

def _run_in_thread(task: AugmentTask, df: pl.DataFrame) -> None:
    """
    Run augmentation in a separate thread.
    Puts AugmentProgress objects into the thread-safe queue.
    """
    target = task.target_count
    strategy = task.strategy
    if strategy == "auto":
        strategy = _detect_strategy(df)

    # Initial progress
    task.progress_queue.put(AugmentProgress(
        task_id=task.task_id, phase="configuring",
        progress_pct=0, processed=0, total=target,
        message=f"Starting: strategy={strategy}, target={target} samples",
    ))

    processed = 0

    try:
        if strategy == "llm_paraphrase":
            processed = _run_llm_augment_sync(task, df, target)
        elif strategy == "numeric_noise":
            processed = _run_numeric_augment_sync(task, df, target)
        elif strategy == "oversample":
            processed = _run_oversample_sync(task, df, target)
        else:
            processed = _run_text_augment_sync(task, df, target)
    except Exception as e:
        task.status = "failed"
        task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="done",
            progress_pct=processed / max(target, 1) * 100,
            processed=processed, total=target,
            stats=dict(task.stats),
            message=f"Error: {str(e)}",
        ))
        task.progress_queue.put(None)  # sentinel
        return

    if task.cancelled:
        task.status = "cancelled"
        task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="cancelled",
            progress_pct=processed / max(target, 1) * 100,
            processed=processed, total=target,
            stats=dict(task.stats),
            message="Cancelled",
        ))
    else:
        task.status = "done"
        task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="done",
            progress_pct=100, processed=len(task.results), total=target,
            stats=dict(task.stats),
            message=f"Complete! Generated {len(task.results)} new samples.",
        ))

    task.progress_queue.put(None)  # sentinel to close SSE stream


def _run_text_augment_sync(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    text_cols = task.columns or [
        c for c in df.columns if df[c].dtype in (pl.Utf8, pl.String)
    ]
    if not text_cols:
        return 0

    rows = df.to_dicts()
    processed = 0

    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(rows) - 1)
        orig_row = rows[row_idx]
        aug_row = dict(orig_row)
        all_changes = []
        technique = ""

        for col in text_cols:
            original_text = str(orig_row.get(col, ""))
            if not original_text.strip() or len(original_text) < 2:
                continue
            augmented_text, tech, changes = _text_augment_row(original_text)
            aug_row[col] = augmented_text
            technique = tech
            all_changes.extend([f"{col}: {c}" for c in changes])

        if all_changes:
            example = AugmentExample(
                row_index=row_idx,
                technique=technique,
                original={c: str(orig_row.get(c, ""))[:200] for c in text_cols},
                augmented={c: str(aug_row.get(c, ""))[:200] for c in text_cols},
                changes=all_changes,
            )
            task.results.append(example)
            task.stats[technique] = task.stats.get(technique, 0) + 1
            processed += 1

            task.progress_queue.put(AugmentProgress(
                task_id=task.task_id, phase="augmenting",
                progress_pct=min(processed / target * 100, 99),
                processed=processed, total=target,
                example=example, stats=dict(task.stats),
                message=f"Row {row_idx}: {technique}",
            ))

        # Small sleep to avoid busy-waiting
        time.sleep(0.02)

    return processed


def _run_numeric_augment_sync(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    numeric_cols = task.columns or [
        c for c in df.columns if df[c].dtype in (pl.Float32, pl.Float64, pl.Int32, pl.Int64)
    ]
    if not numeric_cols:
        return 0

    rows = df.to_dicts()
    processed = 0

    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(rows) - 1)
        orig_row = rows[row_idx]
        aug_row = dict(orig_row)
        all_changes = []
        tech = random.choice(["noise", "noise", "interpolate"])

        if tech == "noise":
            for col in numeric_cols:
                val = orig_row.get(col)
                if val is not None and isinstance(val, (int, float)):
                    new_val, changes = _noise_inject(float(val))
                    aug_row[col] = new_val
                    all_changes.extend([f"{col}: {c}" for c in changes])
            tech_label = "noise_injection"
        else:
            other_idx = random.randint(0, len(rows) - 1)
            other_row = rows[other_idx]
            for col in numeric_cols:
                a = orig_row.get(col)
                b = other_row.get(col)
                if a is not None and b is not None and isinstance(a, (int, float)) and isinstance(b, (int, float)):
                    new_val, changes = _interpolate(float(a), float(b))
                    aug_row[col] = new_val
                    all_changes.extend([f"{col}: {c}" for c in changes])
            tech_label = "interpolation"

        if all_changes:
            example = AugmentExample(
                row_index=row_idx, technique=tech_label,
                original={c: orig_row.get(c) for c in numeric_cols},
                augmented={c: aug_row.get(c) for c in numeric_cols},
                changes=all_changes[:10],
            )
            task.results.append(example)
            task.stats[tech_label] = task.stats.get(tech_label, 0) + 1
            processed += 1

            task.progress_queue.put(AugmentProgress(
                task_id=task.task_id, phase="augmenting",
                progress_pct=min(processed / target * 100, 99),
                processed=processed, total=target,
                example=example, stats=dict(task.stats),
                message=f"Row {row_idx}: {tech_label}",
            ))

        time.sleep(0.02)

    return processed


def _run_oversample_sync(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    label_col = None
    for col in (task.columns or df.columns):
        if col in df.columns and df[col].dtype in (pl.Utf8, pl.String):
            if 2 <= df[col].n_unique() <= 50:
                label_col = col
                break
    if label_col is None:
        return _run_text_augment_sync(task, df, target)

    counts = df[label_col].value_counts().sort("count")
    minority = counts[label_col][0]
    minority_rows = df.filter(pl.col(label_col) == minority).to_dicts()
    if not minority_rows:
        return _run_text_augment_sync(task, df, target)

    processed = 0
    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(minority_rows) - 1)
        orig_row = minority_rows[row_idx]
        aug_row = dict(orig_row)
        all_changes = []

        for col in df.columns:
            if col == label_col:
                continue
            val = orig_row.get(col)
            if isinstance(val, str) and len(val) > 3:
                aug_text, tech, changes = _text_augment_row(val)
                aug_row[col] = aug_text
                all_changes.extend([f"{col}: {c}" for c in changes])
            elif isinstance(val, (int, float)):
                new_val, changes = _noise_inject(float(val))
                aug_row[col] = new_val
                all_changes.extend([f"{col}: {c}" for c in changes])

        tech_label = f"oversample({minority})"
        example = AugmentExample(
            row_index=row_idx, technique=tech_label,
            original={c: str(orig_row.get(c, ""))[:200] for c in df.columns},
            augmented={c: str(aug_row.get(c, ""))[:200] for c in df.columns},
            changes=all_changes[:10] if all_changes else [f"copy of {label_col}={minority}"],
        )
        task.results.append(example)
        task.stats[tech_label] = task.stats.get(tech_label, 0) + 1
        processed += 1

        task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="augmenting",
            progress_pct=min(processed / target * 100, 99),
            processed=processed, total=target,
            example=example, stats=dict(task.stats),
            message=f"Oversample {minority}: row {row_idx}",
        ))

        time.sleep(0.02)

    return processed


def _run_llm_augment_sync(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    """LLM-based paraphrase — falls back to text augment if API fails."""
    text_col = None
    for candidate in ["instruction", "input", "content", "text", "prompt"]:
        if candidate in df.columns:
            text_col = candidate
            break
    if text_col is None and "messages" in df.columns:
        text_col = "messages"
    if text_col is None:
        for col in df.columns:
            if df[col].dtype in (pl.Utf8, pl.String):
                text_col = col
                break
    if text_col is None:
        return 0

    # For MVP, use text augment as the LLM fallback
    # (actual LLM calls would need async, handled separately)
    return _run_text_augment_sync(task, df, target)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def start_augmentation(task: AugmentTask, df: pl.DataFrame) -> None:
    """Start augmentation in a background thread."""
    thread = threading.Thread(target=_run_in_thread, args=(task, df), daemon=True)
    thread.start()


def apply_augmentation(df: pl.DataFrame, results: list[AugmentExample]) -> pl.DataFrame:
    """Merge augmented samples back into the original DataFrame."""
    if not results:
        return df

    rows = df.to_dicts()
    new_rows = []
    for example in results:
        if example.row_index < len(rows):
            new_row = dict(rows[example.row_index])
        else:
            new_row = dict(rows[0])
        new_row.update(example.augmented)
        new_rows.append(new_row)

    if not new_rows:
        return df

    new_df = pl.DataFrame(new_rows)
    for col in df.columns:
        if col not in new_df.columns:
            new_df = new_df.with_columns(pl.lit(None).alias(col))

    return pl.concat([df, new_df.select(df.columns)])
