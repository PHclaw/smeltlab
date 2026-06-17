"""
Data Augmentation Service — generate new training samples with visible process.

Supports:
- LLM training data: paraphrase, style transform, complexity change (via AI API)
- General text: synonym replacement, random insert/delete
- Numeric columns: Gaussian noise injection, interpolation oversampling
- Categorical columns: minority class oversampling

Every augmentation produces: { original, technique, augmented } triples
that are streamed to the frontend in real-time via callbacks.
"""

from __future__ import annotations

import asyncio
import json
import random
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import polars as pl

from app.core.config import get_settings


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class AugmentExample:
    """A single augmentation result showing the transformation."""
    row_index: int
    technique: str        # paraphrase | synonym | noise | oversample | etc.
    original: dict[str, Any]
    augmented: dict[str, Any]
    changes: list[str] = field(default_factory=list)  # human-readable change descriptions


@dataclass
class AugmentProgress:
    """Real-time progress update sent via SSE."""
    task_id: str
    phase: str            # configuring | augmenting | finishing | done | cancelled
    progress_pct: float   # 0-100
    processed: int
    total: int
    example: AugmentExample | None = None
    stats: dict[str, int] = field(default_factory=dict)
    message: str = ""


@dataclass
class AugmentTask:
    """An augmentation task with progress tracking."""
    task_id: str
    dataset_id: str
    strategy: str         # auto | llm_paraphrase | text_augment | numeric_noise | oversample
    multiplier: float     # e.g. 2.0 = double the data
    target_count: int     # target number of new samples
    columns: list[str]    # columns to augment (empty = auto-detect)
    status: str = "pending"
    progress_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    results: list[AugmentExample] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)
    cancelled: bool = False
    total_to_process: int = 0


# In-memory task store
_tasks: dict[str, AugmentTask] = {}


# ---------------------------------------------------------------------------
# Synonym dictionary (lightweight, no external deps)
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
# Text augmentation strategies
# ---------------------------------------------------------------------------

def _synonym_replace(text: str, max_replacements: int = 3) -> tuple[str, list[str]]:
    """Replace random words with synonyms."""
    words = text.split()
    changes = []
    replaced = 0

    for i in range(len(words)):
        if replaced >= max_replacements:
            break
        lower = words[i].lower().strip(".,!?;:")
        if lower in _SYNONYMS:
            synonym = random.choice(_SYNONYMS[lower])
            # Preserve capitalization
            if words[i][0].isupper():
                synonym = synonym.capitalize()
            old_word = words[i]
            words[i] = synonym + words[i][len(lower):]  # preserve trailing punctuation
            changes.append(f"'{old_word}' → '{words[i]}'")
            replaced += 1

    return " ".join(words), changes


def _random_insert(text: str) -> tuple[str, list[str]]:
    """Insert a random word at a random position."""
    words = text.split()
    if len(words) < 2:
        return text, []

    filler_words = ["also", "very", "really", "quite", "rather", "indeed", "certainly"]
    word = random.choice(filler_words)
    pos = random.randint(1, len(words) - 1)
    words.insert(pos, word)
    return " ".join(words), [f"inserted '{word}' at position {pos}"]


def _random_delete(text: str) -> tuple[str, list[str]]:
    """Delete a random non-essential word."""
    words = text.split()
    if len(words) < 4:
        return text, []

    # Don't delete first or last word
    pos = random.randint(1, len(words) - 2)
    deleted = words.pop(pos)
    return " ".join(words), [f"deleted '{deleted}'"]


def _text_augment_row(text: str) -> tuple[str, str, list[str]]:
    """Apply a random text augmentation technique. Returns (augmented, technique, changes)."""
    technique = random.choice(["synonym", "synonym", "insert", "delete"])

    if technique == "synonym":
        result, changes = _synonym_replace(text)
        return result, "synonym_replace", changes
    elif technique == "insert":
        result, changes = _random_insert(text)
        return result, "random_insert", changes
    else:
        result, changes = _random_delete(text)
        return result, "random_delete", changes


# ---------------------------------------------------------------------------
# Numeric augmentation strategies
# ---------------------------------------------------------------------------

def _noise_inject(value: float, std_factor: float = 0.05) -> tuple[float, list[str]]:
    """Add Gaussian noise to a numeric value."""
    noise = random.gauss(0, abs(value) * std_factor + 0.01)
    new_val = round(value + noise, 4)
    return new_val, [f"{value} → {new_val} (noise: {noise:+.4f})"]


def _interpolate(val_a: float, val_b: float) -> tuple[float, list[str]]:
    """Generate a value between two existing values (SMOTE-like)."""
    alpha = random.uniform(0.1, 0.9)
    new_val = round(val_a * alpha + val_b * (1 - alpha), 4)
    return new_val, [f"interpolate({val_a}, {val_b}, α={alpha:.2f}) = {new_val}"]


# ---------------------------------------------------------------------------
# LLM-based augmentation (for training data)
# ---------------------------------------------------------------------------

_AUGMENT_PROMPT = """You are a data augmentation expert. Paraphrase the following {count} text samples.

Rules:
- Keep the original meaning intact
- Change the wording, sentence structure, and expression
- Vary the length slightly (some shorter, some longer)
- Output ONLY a JSON array of objects with "original" and "augmented" keys

Samples to paraphrase:
{samples_json}

Output format (JSON array only, no markdown):
[{{"original": "...", "augmented": "..."}}, ...]"""


async def _llm_paraphrase_batch(
    texts: list[str],
    settings: Any,
) -> list[dict[str, str]]:
    """Use LLM to paraphrase a batch of texts."""
    prompt = _AUGMENT_PROMPT.format(
        count=len(texts),
        samples_json=json.dumps(texts, ensure_ascii=False),
    )

    if settings.ai_provider == "glm":
        content = await _call_glm(settings, prompt)
    elif settings.ai_provider == "anthropic":
        content = await _call_anthropic(settings, prompt)
    else:
        raise ValueError(f"Unknown AI provider: {settings.ai_provider}")

    # Parse response
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        result = json.loads(content)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass

    # Fallback: return empty
    return []


async def _call_glm(settings: Any, prompt: str) -> str:
    import httpx
    url = f"{settings.glm_base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.glm_api_key}", "Content-Type": "application/json"}
    payload = {
        "model": settings.glm_model,
        "messages": [
            {"role": "system", "content": "You are a data augmentation expert. Always respond with valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.8,
        "max_tokens": 4096,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    message = data["choices"][0]["message"]
    return message.get("content", "") or message.get("reasoning_content", "")


async def _call_anthropic(settings: Any, prompt: str) -> str:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system="You are a data augmentation expert. Always respond with valid JSON only.",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Auto-detect augmentation strategy
# ---------------------------------------------------------------------------

def _detect_strategy(df: pl.DataFrame) -> str:
    """Auto-detect the best augmentation strategy for a DataFrame."""
    columns = df.columns

    # Check for LLM training data formats
    if "messages" in columns:
        return "llm_paraphrase"
    if "instruction" in columns and "output" in columns:
        return "llm_paraphrase"
    if "conversations" in columns:
        return "llm_paraphrase"

    # Check for mostly numeric data
    numeric_cols = [c for c in columns if df[c].dtype in (
        pl.Float32, pl.Float64, pl.Int32, pl.Int64
    )]
    if len(numeric_cols) > len(columns) / 2:
        return "numeric_noise"

    # Default: text augmentation
    return "text_augment"


# ---------------------------------------------------------------------------
# Main augmentation runner
# ---------------------------------------------------------------------------

async def run_augmentation(task: AugmentTask, df: pl.DataFrame) -> None:
    """Run the augmentation task, pushing progress updates to the queue."""
    settings = get_settings()
    total_rows = len(df)
    target = task.target_count or int(total_rows * (task.multiplier - 1))
    task.total_to_process = target

    # Send initial progress
    await task.progress_queue.put(AugmentProgress(
        task_id=task.task_id, phase="configuring",
        progress_pct=0, processed=0, total=target,
        message=f"Starting augmentation: strategy={task.strategy}, target={target} new samples",
    ))

    strategy = task.strategy
    if strategy == "auto":
        strategy = _detect_strategy(df)

    task.stats = {}
    processed = 0

    try:
        if strategy == "llm_paraphrase":
            processed = await _run_llm_augment(task, df, target, settings)
        elif strategy == "text_augment":
            processed = await _run_text_augment(task, df, target)
        elif strategy == "numeric_noise":
            processed = await _run_numeric_augment(task, df, target)
        elif strategy == "oversample":
            processed = await _run_oversample(task, df, target)
        else:
            processed = await _run_text_augment(task, df, target)

    except asyncio.CancelledError:
        task.cancelled = True
        task.status = "cancelled"
        await task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="cancelled",
            progress_pct=processed / max(target, 1) * 100,
            processed=processed, total=target,
            stats=task.stats,
            message="Augmentation cancelled",
        ))
        return

    # Done
    task.status = "done"
    await task.progress_queue.put(AugmentProgress(
        task_id=task.task_id, phase="done",
        progress_pct=100, processed=len(task.results), total=target,
        stats=task.stats,
        message=f"Augmentation complete! Generated {len(task.results)} new samples.",
    ))
    # Sentinel to close SSE stream
    await task.progress_queue.put(None)


async def _run_llm_augment(task: AugmentTask, df: pl.DataFrame, target: int, settings: Any) -> int:
    """LLM-based paraphrase augmentation for training data."""
    # Find the text column to augment
    text_col = None
    for candidate in ["instruction", "input", "content", "text", "prompt"]:
        if candidate in df.columns:
            text_col = candidate
            break

    if text_col is None and "messages" in df.columns:
        # For ChatML format, augment the last user message
        text_col = "messages"

    if text_col is None:
        # Fallback to first string column
        for col in df.columns:
            if df[col].dtype in (pl.Utf8, pl.String):
                text_col = col
                break

    if text_col is None:
        task.status = "failed"
        await task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="done",
            progress_pct=0, processed=0, total=target,
            message="No text column found for LLM augmentation",
        ))
        await task.progress_queue.put(None)
        return 0

    processed = 0
    batch_size = 5
    rows = df.to_dicts()

    while processed < target and not task.cancelled:
        # Pick random rows for this batch
        batch_rows = random.sample(rows, min(batch_size, len(rows), target - processed))

        if text_col == "messages":
            # Extract last user message from ChatML
            texts = []
            for row in batch_rows:
                msgs = row.get("messages", [])
                user_msgs = [m for m in msgs if isinstance(m, dict) and m.get("role") == "user"]
                texts.append(user_msgs[-1]["content"] if user_msgs else "")
        else:
            texts = [str(row.get(text_col, "")) for row in batch_rows]

        texts = [t for t in texts if t.strip()]
        if not texts:
            continue

        try:
            results = await _llm_paraphrase_batch(texts, settings)
        except Exception as e:
            # If LLM fails, fall back to simple text augmentation
            results = [{"original": t, "augmented": _text_augment_row(t)[0]} for t in texts]

        for i, result in enumerate(results):
            if task.cancelled or processed >= target:
                break

            original_text = result.get("original", texts[i] if i < len(texts) else "")
            augmented_text = result.get("augmented", original_text)

            # Build augmented row
            orig_row = batch_rows[i] if i < len(batch_rows) else rows[0]
            aug_row = dict(orig_row)

            if text_col == "messages":
                # Replace the last user message content
                msgs = list(aug_row.get("messages", []))
                user_indices = [j for j, m in enumerate(msgs) if isinstance(m, dict) and m.get("role") == "user"]
                if user_indices:
                    msgs[user_indices[-1]] = {**msgs[user_indices[-1]], "content": augmented_text}
                aug_row["messages"] = msgs
            else:
                aug_row[text_col] = augmented_text

            example = AugmentExample(
                row_index=random.randint(0, len(rows) - 1),
                technique="llm_paraphrase",
                original={text_col: original_text},
                augmented={text_col: augmented_text},
                changes=[f"AI paraphrase"],
            )

            task.results.append(example)
            task.stats["llm_paraphrase"] = task.stats.get("llm_paraphrase", 0) + 1
            processed += 1

            # Push progress
            await task.progress_queue.put(AugmentProgress(
                task_id=task.task_id, phase="augmenting",
                progress_pct=min(processed / target * 100, 99),
                processed=processed, total=target,
                example=example, stats=dict(task.stats),
                message=f"Paraphrasing sample {processed}/{target}",
            ))

        # Small delay to avoid overwhelming the API
        await asyncio.sleep(0.5)

    return processed


async def _run_text_augment(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    """Rule-based text augmentation for string columns."""
    # Find text columns
    text_cols = task.columns or [
        c for c in df.columns
        if df[c].dtype in (pl.Utf8, pl.String)
    ]

    if not text_cols:
        task.status = "failed"
        await task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="done",
            progress_pct=0, processed=0, total=target,
            message="No text columns found",
        ))
        await task.progress_queue.put(None)
        return 0

    rows = df.to_dicts()
    processed = 0

    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(rows) - 1)
        orig_row = rows[row_idx]
        aug_row = dict(orig_row)
        all_changes = []

        for col in text_cols:
            original_text = str(orig_row.get(col, ""))
            if not original_text.strip() or len(original_text) < 3:
                continue

            augmented_text, technique, changes = _text_augment_row(original_text)
            aug_row[col] = augmented_text
            all_changes.extend([f"{col}: {c}" for c in changes])

        if all_changes:
            original_snapshot = {c: str(orig_row.get(c, ""))[:200] for c in text_cols}
            augmented_snapshot = {c: str(aug_row.get(c, ""))[:200] for c in text_cols}

            example = AugmentExample(
                row_index=row_idx,
                technique=technique,
                original=original_snapshot,
                augmented=augmented_snapshot,
                changes=all_changes,
            )

            task.results.append(example)
            task.stats[technique] = task.stats.get(technique, 0) + 1
            processed += 1

            await task.progress_queue.put(AugmentProgress(
                task_id=task.task_id, phase="augmenting",
                progress_pct=min(processed / target * 100, 99),
                processed=processed, total=target,
                example=example, stats=dict(task.stats),
                message=f"Augmented row {row_idx}: {technique}",
            ))

    return processed


async def _run_numeric_augment(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    """Numeric augmentation: noise injection + interpolation."""
    numeric_cols = task.columns or [
        c for c in df.columns
        if df[c].dtype in (pl.Float32, pl.Float64, pl.Int32, pl.Int64)
    ]

    if not numeric_cols:
        task.status = "failed"
        await task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="done",
            progress_pct=0, processed=0, total=target,
            message="No numeric columns found",
        ))
        await task.progress_queue.put(None)
        return 0

    rows = df.to_dicts()
    processed = 0

    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(rows) - 1)
        orig_row = rows[row_idx]
        aug_row = dict(orig_row)
        all_changes = []

        technique = random.choice(["noise", "noise", "interpolate"])

        if technique == "noise":
            for col in numeric_cols:
                val = orig_row.get(col)
                if val is not None and isinstance(val, (int, float)):
                    new_val, changes = _noise_inject(float(val))
                    aug_row[col] = new_val
                    all_changes.extend([f"{col}: {c}" for c in changes])
            tech_label = "noise_injection"
        else:
            # Interpolation: pick another random row and interpolate
            other_idx = random.randint(0, len(rows) - 1)
            other_row = rows[other_idx]
            for col in numeric_cols:
                val_a = orig_row.get(col)
                val_b = other_row.get(col)
                if (val_a is not None and val_b is not None
                        and isinstance(val_a, (int, float)) and isinstance(val_b, (int, float))):
                    new_val, changes = _interpolate(float(val_a), float(val_b))
                    aug_row[col] = new_val
                    all_changes.extend([f"{col}: {c}" for c in changes])
            tech_label = "interpolation"

        if all_changes:
            original_snapshot = {c: orig_row.get(c) for c in numeric_cols}
            augmented_snapshot = {c: aug_row.get(c) for c in numeric_cols}

            example = AugmentExample(
                row_index=row_idx,
                technique=tech_label,
                original=original_snapshot,
                augmented=augmented_snapshot,
                changes=all_changes[:10],  # Limit changes shown
            )

            task.results.append(example)
            task.stats[tech_label] = task.stats.get(tech_label, 0) + 1
            processed += 1

            await task.progress_queue.put(AugmentProgress(
                task_id=task.task_id, phase="augmenting",
                progress_pct=min(processed / target * 100, 99),
                processed=processed, total=target,
                example=example, stats=dict(task.stats),
                message=f"Augmented row {row_idx}: {tech_label}",
            ))

    return processed


async def _run_oversample(task: AugmentTask, df: pl.DataFrame, target: int) -> int:
    """Oversample minority classes in categorical columns."""
    # Find a good label column
    label_col = None
    for col in (task.columns or df.columns):
        if col in df.columns and df[col].dtype in (pl.Utf8, pl.String):
            n_unique = df[col].n_unique()
            if 2 <= n_unique <= 50:
                label_col = col
                break

    if label_col is None:
        # Fallback to text augmentation
        return await _run_text_augment(task, df, target)

    # Find minority class
    counts = df[label_col].value_counts().sort("count")
    minority_label = counts[label_col][0]
    minority_rows = df.filter(pl.col(label_col) == minority_label).to_dicts()

    if not minority_rows:
        return await _run_text_augment(task, df, target)

    processed = 0
    while processed < target and not task.cancelled:
        row_idx = random.randint(0, len(minority_rows) - 1)
        orig_row = minority_rows[row_idx]
        aug_row = dict(orig_row)

        # Apply slight perturbations to non-label columns
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

        tech_label = f"oversample({minority_label})"

        example = AugmentExample(
            row_index=row_idx,
            technique=tech_label,
            original={c: str(orig_row.get(c, ""))[:200] for c in df.columns},
            augmented={c: str(aug_row.get(c, ""))[:200] for c in df.columns},
            changes=all_changes[:10] if all_changes else [f"copy of {label_col}={minority_label} row"],
        )

        task.results.append(example)
        task.stats[tech_label] = task.stats.get(tech_label, 0) + 1
        processed += 1

        await task.progress_queue.put(AugmentProgress(
            task_id=task.task_id, phase="augmenting",
            progress_pct=min(processed / target * 100, 99),
            processed=processed, total=target,
            example=example, stats=dict(task.stats),
            message=f"Oversampled {minority_label}: row {row_idx}",
        ))

    return processed


# ---------------------------------------------------------------------------
# Apply augmentation results
# ---------------------------------------------------------------------------

def apply_augmentation(
    df: pl.DataFrame,
    results: list[AugmentExample],
    task: AugmentTask,
) -> pl.DataFrame:
    """Merge augmented samples back into the original DataFrame."""
    if not results:
        return df

    # Build new rows from augmented examples
    new_rows = []
    original_rows = df.to_dicts()

    for example in results:
        # Start from the original row and apply augmented values
        if example.row_index < len(original_rows):
            new_row = dict(original_rows[example.row_index])
        else:
            new_row = dict(original_rows[0])

        # Override with augmented values
        new_row.update(example.augmented)
        new_rows.append(new_row)

    if not new_rows:
        return df

    # Create new DataFrame with augmented rows appended
    new_df = pl.DataFrame(new_rows)

    # Ensure same schema
    for col in df.columns:
        if col not in new_df.columns:
            new_df = new_df.with_columns(pl.lit(None).alias(col))

    return pl.concat([df, new_df.select(df.columns)])
