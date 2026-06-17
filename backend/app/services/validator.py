"""
LLM Training Data Validator — validate and fix data formats for fine-tuning.

Supports:
- ChatML format (OpenAI chat completions)
- Alpaca format (instruction/input/output)
- ShareGPT format (conversations array)

Features:
- Schema validation per format
- Token counting (approximate)
- Auto-fix common issues
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import polars as pl


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ValidationError:
    row_index: int
    field_path: str
    message: str
    severity: str = "error"  # error | warning
    fixable: bool = False


@dataclass
class ValidationResult:
    format_type: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    warnings: int
    errors: list[ValidationError] = field(default_factory=list)
    avg_tokens: int = 0
    max_tokens: int = 0
    token_distribution: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Token counting (approximate — ~4 chars per token for English)
# ---------------------------------------------------------------------------

def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English, ~2 for CJK."""
    if not text:
        return 0
    cjk_count = sum(1 for c in text if '一' <= c <= '鿿')
    other_count = len(text) - cjk_count
    return max(1, (other_count // 4) + (cjk_count // 2))


# ---------------------------------------------------------------------------
# Format validators
# ---------------------------------------------------------------------------

def _validate_chatml(row: dict, idx: int) -> list[ValidationError]:
    """Validate ChatML / OpenAI chat completions format.
    Expected: {"messages": [{"role": "system"|"user"|"assistant", "content": "..."}]}
    """
    errors = []

    if "messages" not in row:
        errors.append(ValidationError(idx, "messages", "Missing 'messages' field", fixable=False))
        return errors

    messages = row["messages"]
    if not isinstance(messages, list):
        errors.append(ValidationError(idx, "messages", "'messages' must be a list", fixable=False))
        return errors

    if len(messages) == 0:
        errors.append(ValidationError(idx, "messages", "'messages' is empty", fixable=False))
        return errors

    has_assistant = False
    for i, msg in enumerate(messages):
        if not isinstance(msg, dict):
            errors.append(ValidationError(idx, f"messages[{i}]", "Each message must be a dict"))
            continue

        if "role" not in msg:
            errors.append(ValidationError(idx, f"messages[{i}].role", "Missing 'role'", fixable=True))
        elif msg["role"] not in ("system", "user", "assistant", "function", "tool"):
            # Try to fix common typos
            role = str(msg["role"]).lower().strip()
            if role in ("human", "input"):
                errors.append(ValidationError(idx, f"messages[{i}].role",
                    f"Role '{msg['role']}' should be 'user'", severity="warning", fixable=True))
            elif role in ("ai", "bot", "output"):
                errors.append(ValidationError(idx, f"messages[{i}].role",
                    f"Role '{msg['role']}' should be 'assistant'", severity="warning", fixable=True))
            else:
                errors.append(ValidationError(idx, f"messages[{i}].role",
                    f"Invalid role: '{msg['role']}'", fixable=True))

        if "content" not in msg:
            errors.append(ValidationError(idx, f"messages[{i}].content", "Missing 'content'", fixable=True))
        elif not isinstance(msg["content"], str):
            errors.append(ValidationError(idx, f"messages[{i}].content", "'content' must be a string", fixable=True))
        elif not msg["content"].strip():
            errors.append(ValidationError(idx, f"messages[{i}].content", "Empty content", severity="warning", fixable=True))

        if msg.get("role") == "assistant":
            has_assistant = True

    if not has_assistant:
        errors.append(ValidationError(idx, "messages", "No 'assistant' message found — model needs at least one assistant response", severity="warning"))

    return errors


def _validate_alpaca(row: dict, idx: int) -> list[ValidationError]:
    """Validate Alpaca / Stanford format.
    Expected: {"instruction": "...", "input": "...", "output": "..."}
    """
    errors = []

    if "instruction" not in row:
        errors.append(ValidationError(idx, "instruction", "Missing 'instruction' field", fixable=False))
    elif not isinstance(row["instruction"], str) or not row["instruction"].strip():
        errors.append(ValidationError(idx, "instruction", "'instruction' must be a non-empty string", severity="warning"))

    if "output" not in row:
        errors.append(ValidationError(idx, "output", "Missing 'output' field", fixable=False))
    elif not isinstance(row["output"], str) or not row["output"].strip():
        errors.append(ValidationError(idx, "output", "'output' must be a non-empty string"))

    # "input" is optional
    if "input" in row and row["input"] is not None:
        if not isinstance(row["input"], str):
            errors.append(ValidationError(idx, "input", "'input' must be a string or null", fixable=True))

    # Check for common field name variations
    for alt in ("prompt", "question", "query"):
        if alt in row and "instruction" not in row:
            errors.append(ValidationError(idx, "instruction",
                f"Found '{alt}' instead of 'instruction' — rename to 'instruction'", severity="warning", fixable=True))

    for alt in ("response", "answer", "completion", "target"):
        if alt in row and "output" not in row:
            errors.append(ValidationError(idx, "output",
                f"Found '{alt}' instead of 'output' — rename to 'output'", severity="warning", fixable=True))

    return errors


def _validate_sharegpt(row: dict, idx: int) -> list[ValidationError]:
    """Validate ShareGPT format.
    Expected: {"conversations": [{"from": "human"|"gpt"|"system", "value": "..."}]}
    """
    errors = []

    if "conversations" not in row:
        errors.append(ValidationError(idx, "conversations", "Missing 'conversations' field", fixable=False))
        return errors

    convs = row["conversations"]
    if not isinstance(convs, list):
        errors.append(ValidationError(idx, "conversations", "'conversations' must be a list", fixable=False))
        return errors

    if len(convs) == 0:
        errors.append(ValidationError(idx, "conversations", "'conversations' is empty", fixable=False))
        return errors

    for i, conv in enumerate(convs):
        if not isinstance(conv, dict):
            errors.append(ValidationError(idx, f"conversations[{i}]", "Each conversation must be a dict"))
            continue

        if "from" not in conv:
            errors.append(ValidationError(idx, f"conversations[{i}].from", "Missing 'from' field", fixable=True))
        elif conv["from"] not in ("human", "gpt", "system", "user", "assistant"):
            errors.append(ValidationError(idx, f"conversations[{i}].from",
                f"Unusual 'from' value: '{conv['from']}'", severity="warning"))

        if "value" not in conv:
            errors.append(ValidationError(idx, f"conversations[{i}].value", "Missing 'value' field", fixable=True))

    return errors


# Map format types to validators
_VALIDATORS = {
    "chatml": _validate_chatml,
    "alpaca": _validate_alpaca,
    "sharegpt": _validate_sharegpt,
}


# ---------------------------------------------------------------------------
# Auto-detect format
# ---------------------------------------------------------------------------

def detect_format(df: pl.DataFrame) -> str | None:
    """Auto-detect the LLM training data format from a DataFrame."""
    columns = set(df.columns)

    if "messages" in columns:
        return "chatml"
    if "conversations" in columns:
        return "sharegpt"
    if "instruction" in columns and "output" in columns:
        return "alpaca"
    if "prompt" in columns and ("response" in columns or "completion" in columns):
        return "alpaca"

    return None


# ---------------------------------------------------------------------------
# Main validation entry point
# ---------------------------------------------------------------------------

def validate_dataset(
    df: pl.DataFrame,
    format_type: str | None = None,
    max_tokens: int = 4096,
) -> ValidationResult:
    """Validate a dataset against an LLM training format."""

    # Auto-detect format if not specified
    if format_type is None:
        format_type = detect_format(df)

    if format_type is None or format_type not in _VALIDATORS:
        return ValidationResult(
            format_type="unknown",
            total_rows=len(df),
            valid_rows=0,
            invalid_rows=len(df),
            warnings=0,
            errors=[ValidationError(0, "", "Could not detect format. Supported: chatml, alpaca, sharegpt")],
        )

    validator = _VALIDATORS[format_type]
    all_errors: list[ValidationError] = []
    valid_count = 0
    token_counts: list[int] = []

    # Convert to dicts for validation
    rows = df.head(5000).to_dicts()  # Limit to 5000 rows for performance

    for idx, row in enumerate(rows):
        row_errors = validator(row, idx)
        if not any(e.severity == "error" for e in row_errors):
            valid_count += 1
        all_errors.extend(row_errors)

        # Token counting
        row_text = json.dumps(row, ensure_ascii=False, default=str)
        tokens = _estimate_tokens(row_text)
        token_counts.append(tokens)

    # Token stats
    avg_tokens = int(sum(token_counts) / len(token_counts)) if token_counts else 0
    max_tok = max(token_counts) if token_counts else 0

    # Token distribution buckets
    token_dist: dict[str, int] = {"0-512": 0, "512-1024": 0, "1024-2048": 0, "2048-4096": 0, "4096+": 0}
    for t in token_counts:
        if t <= 512:
            token_dist["0-512"] += 1
        elif t <= 1024:
            token_dist["512-1024"] += 1
        elif t <= 2048:
            token_dist["1024-2048"] += 1
        elif t <= 4096:
            token_dist["2048-4096"] += 1
        else:
            token_dist["4096+"] += 1

    error_count = sum(1 for e in all_errors if e.severity == "error")
    warning_count = sum(1 for e in all_errors if e.severity == "warning")
    invalid_rows = len(rows) - valid_count

    return ValidationResult(
        format_type=format_type,
        total_rows=len(df),
        valid_rows=valid_count,
        invalid_rows=invalid_rows,
        warnings=warning_count,
        errors=all_errors[:200],  # Limit to 200 errors in response
        avg_tokens=avg_tokens,
        max_tokens=max_tok,
        token_distribution=token_dist,
    )


# ---------------------------------------------------------------------------
# Auto-fix
# ---------------------------------------------------------------------------

ROLE_FIXES = {
    "human": "user", "input": "user", "prompt": "user",
    "ai": "assistant", "bot": "assistant", "output": "assistant", "response": "assistant",
}


def fix_chatml_row(row: dict) -> dict:
    """Fix common issues in a ChatML row."""
    if "messages" not in row or not isinstance(row.get("messages"), list):
        return row

    fixed_messages = []
    for msg in row["messages"]:
        if not isinstance(msg, dict):
            continue

        fixed = dict(msg)

        # Fix role
        role = str(fixed.get("role", "")).lower().strip()
        if role in ROLE_FIXES:
            fixed["role"] = ROLE_FIXES[role]

        # Fix content
        if "content" not in fixed:
            fixed["content"] = ""
        elif not isinstance(fixed["content"], str):
            fixed["content"] = str(fixed["content"])

        fixed_messages.append(fixed)

    row = dict(row)
    row["messages"] = fixed_messages
    return row


def fix_alpaca_row(row: dict) -> dict:
    """Fix common issues in an Alpaca row."""
    fixed = dict(row)

    # Rename common alternatives
    for alt in ("prompt", "question", "query"):
        if alt in fixed and "instruction" not in fixed:
            fixed["instruction"] = fixed.pop(alt)

    for alt in ("response", "answer", "completion", "target"):
        if alt in fixed and "output" not in fixed:
            fixed["output"] = fixed.pop(alt)

    # Ensure fields are strings
    for key in ("instruction", "input", "output"):
        if key in fixed and fixed[key] is not None and not isinstance(fixed[key], str):
            fixed[key] = str(fixed[key])

    return fixed


def fix_dataset(df: pl.DataFrame, format_type: str) -> pl.DataFrame:
    """Apply auto-fixes to a dataset."""
    rows = df.to_dicts()

    if format_type == "chatml":
        rows = [fix_chatml_row(r) for r in rows]
    elif format_type == "alpaca":
        rows = [fix_alpaca_row(r) for r in rows]
    # sharegpt fixes are minimal for now

    return pl.DataFrame(rows)
