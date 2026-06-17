"""
Conversational Cleaning Engine — interactive dialogue-based data cleaning.

The user chats with an AI assistant that:
- Analyzes data and proposes cleaning plans
- Adjusts plans based on user feedback
- Executes plans and reports results
- Continues the conversation for iterative refinement
"""

from __future__ import annotations

import json
import re as _re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import polars as pl

from app.core.config import get_settings
from app.services.cleaner import (
    CleanPlan,
    CleanResult,
    CleanStep,
    ChangeRecord,
    PRESET_OPERATIONS,
    _call_glm,
    _call_anthropic,
    _parse_json_robust,
    execute_clean_plan,
)
from app.services.profiler import ProfileReport


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ChatMessage:
    """A single message in the conversation."""
    role: str  # "user" | "assistant"
    content: str
    response_type: str | None = None  # propose | adjust | confirm | clarify
    plan_steps: list[dict[str, Any]] | None = None
    result_summary: dict[str, Any] | None = None


@dataclass
class Conversation:
    """An interactive cleaning conversation."""
    conversation_id: str
    dataset_id: str
    messages: list[ChatMessage] = field(default_factory=list)
    current_plan: CleanPlan | None = None
    current_df_key: str = ""  # key in _dataframes store
    pre_execution_df_key: str = ""  # key to the DF before last execution (for selective apply)
    last_result: CleanResult | None = None
    last_plan_before_execute: CleanPlan | None = None  # plan that was last executed
    execution_count: int = 0
    version_history: list[dict[str, Any]] = field(default_factory=list)  # [{version, df_key, label, rows, timestamp}]


# In-memory stores
_conversations: dict[str, Conversation] = {}


# ---------------------------------------------------------------------------
# Conversation management
# ---------------------------------------------------------------------------

def get_or_create_conversation(
    conversation_id: str | None,
    dataset_id: str,
) -> Conversation:
    """Get existing or create new conversation."""
    if conversation_id and conversation_id in _conversations:
        return _conversations[conversation_id]

    conv_id = conversation_id or str(uuid.uuid4())
    conv = Conversation(
        conversation_id=conv_id,
        dataset_id=dataset_id,
        current_df_key=dataset_id,
    )
    _conversations[conv_id] = conv
    return conv


def get_conversation(conversation_id: str) -> Conversation | None:
    """Get a conversation by ID."""
    return _conversations.get(conversation_id)


# ---------------------------------------------------------------------------
# Conversational LLM Prompt
# ---------------------------------------------------------------------------

_CHAT_SYSTEM_PROMPT = """You are DataCleanr AI, an expert data cleaning assistant. You help users clean their data through natural conversation.

You can respond with different types:
- "propose": Suggest a new cleaning plan based on user request
- "adjust": Modify an existing plan based on user feedback
- "confirm": Confirm execution results and suggest next steps
- "clarify": Ask the user for more details when their request is vague

## Available Operations
- "dedup": Remove duplicate rows. Config: {"method": "exact"|"subset", "columns": [...], "keep": "first"|"last"}
- "pii_mask": Mask PII. Config: {"entities": ["email","phone","ssn","credit_card","cn_id","cn_phone"], "method": "redact"|"hash", "columns": [...]}
- "missing": Handle missing values. Config: {"strategy": "drop"|"fill_mean"|"fill_median"|"fill_mode"|"fill_value", "columns": [...], "fill_value": ...}
- "outlier": Filter outliers. Config: {"columns": [...], "method": "iqr", "threshold": 1.5}
- "text_clean": Clean text. Config: {"columns": [...], "operations": ["strip","normalize_space","lowercase","remove_special"]}
- "date_standardize": Standardize dates. Config: {"columns": [...], "target_format": "%Y-%m-%d"}

## Rules
1. Always respond with valid JSON only — no markdown fences
2. Be concise but helpful
3. When user says "execute", "run", "do it", "go ahead" etc., respond with type "confirm" and include the current plan steps
4. After execution, suggest logical next steps
5. If user feedback is about specific steps, use "adjust" type and modify only the relevant steps
6. Keep the conversation context in mind — reference previous operations and results"""


_CHAT_USER_PROMPT = """## Dataset Profile
- Total rows: {total_rows}
- Total columns: {total_columns}
- Health score: {health_score}/100
- Duplicate rows: {duplicate_rows} ({duplicate_pct}%)
- Issues: {issues_summary}

## Column Details
{schema_json}

## Sample Data (first 5 rows)
{sample_json}

{current_plan_section}

{last_result_section}

## Conversation History (recent)
{history}

## User's Latest Message
{user_message}

## Instructions
Respond with a JSON object:
{{
  "response_type": "propose" | "adjust" | "confirm" | "clarify",
  "message": "Your helpful reply to the user in their language (if user writes in Chinese, reply in Chinese; if English, reply in English)",
  "reasoning": "Brief technical explanation of your decision",
  "steps": [
    {{
      "step_id": "<unique_id>",
      "operation": "<operation_name>",
      "description": "<what this step does>",
      "config": {{...}}
    }}
  ],
  "suggestions": ["suggested next action 1", "suggested next action 2"]
}}

Rules for "steps":
- For "propose": include the full cleaning plan
- For "adjust": include the modified plan (complete, not just changed steps)
- For "confirm": include the current plan steps to execute (if user says "execute"/"run"/"执行")
- For "clarify": steps can be empty or null
- Order: dedup first, then PII, then format fixes, then outlier removal

Rules for "suggestions":
- 2-3 short suggested next actions the user might want to do
- Examples: "Remove duplicate rows", "Standardize date formats", "Check for outliers"
- Tailor suggestions to the data issues found"""


def _build_chat_prompt(
    profile: ProfileReport,
    df: pl.DataFrame,
    messages: list[ChatMessage],
    user_message: str,
    current_plan: CleanPlan | None,
    last_result: CleanResult | None,
) -> str:
    """Build the full prompt for a chat turn."""
    # Schema info
    schema_info = []
    for col in profile.columns:
        schema_info.append({
            "name": col.name,
            "type": col.inferred_type,
            "null_pct": col.null_pct,
            "unique_pct": col.unique_pct,
            "sample_values": col.sample_values[:3],
            "issues": col.issues,
        })

    sample_rows = df.head(5).to_dicts()
    for row in sample_rows:
        for k, v in row.items():
            if not isinstance(v, (str, int, float, bool, type(None))):
                row[k] = str(v)

    issues_summary = "; ".join(
        f"[{i.severity}] {i.message}" for i in profile.issues[:10]
    )

    # Current plan section
    if current_plan and current_plan.steps:
        plan_steps = []
        for s in current_plan.steps:
            plan_steps.append({
                "step_id": s.step_id,
                "operation": s.operation,
                "description": s.description,
                "config": s.config,
            })
        current_plan_section = (
            f"## Current Pending Plan\n"
            f"Reasoning: {current_plan.reasoning}\n"
            f"Steps:\n{json.dumps(plan_steps, indent=2, ensure_ascii=False)}"
        )
    else:
        current_plan_section = "## Current Pending Plan\nNone"

    # Last result section
    if last_result:
        result_steps = []
        for s in last_result.plan.steps:
            result_steps.append({
                "operation": s.operation,
                "description": s.description,
                "rows_affected": s.rows_affected,
                "status": s.status,
            })
        last_result_section = (
            f"## Last Execution Result\n"
            f"Rows: {last_result.rows_before} → {last_result.rows_after} "
            f"({last_result.rows_before - last_result.rows_after} removed)\n"
            f"Total changes: {last_result.total_changes}\n"
            f"Steps executed: {json.dumps(result_steps, indent=2, ensure_ascii=False)}"
        )
    else:
        last_result_section = "## Last Execution Result\nNone yet"

    # Conversation history
    history_lines = []
    recent = messages[-10:]  # Last 10 messages
    for m in recent:
        prefix = "User" if m.role == "user" else "AI"
        history_lines.append(f"{prefix}: {m.content}")
    history = "\n".join(history_lines) if history_lines else "(no prior messages)"

    return _CHAT_USER_PROMPT.format(
        total_rows=profile.total_rows,
        total_columns=profile.total_columns,
        health_score=profile.health_score,
        duplicate_rows=profile.duplicate_rows,
        duplicate_pct=profile.duplicate_pct,
        issues_summary=issues_summary or "None",
        schema_json=json.dumps(schema_info, indent=2, ensure_ascii=False),
        sample_json=json.dumps(sample_rows, indent=2, ensure_ascii=False, default=str),
        current_plan_section=current_plan_section,
        last_result_section=last_result_section,
        history=history,
        user_message=user_message,
    )


# ---------------------------------------------------------------------------
# Chat LLM call
# ---------------------------------------------------------------------------

async def chat_with_ai(
    profile: ProfileReport,
    df: pl.DataFrame,
    conversation: Conversation,
    user_message: str,
) -> dict[str, Any]:
    """Send a chat message to the AI and get a structured response."""
    settings = get_settings()

    prompt = _build_chat_prompt(
        profile=profile,
        df=df,
        messages=conversation.messages,
        user_message=user_message,
        current_plan=conversation.current_plan,
        last_result=conversation.last_result,
    )

    # Call LLM
    if settings.ai_provider == "glm":
        content = await _call_glm_chat(settings, prompt)
    elif settings.ai_provider == "anthropic":
        content = await _call_anthropic_chat(settings, prompt)
    else:
        raise ValueError(f"Unknown AI provider: {settings.ai_provider}")

    # Parse response
    content = content.strip()

    # Remove markdown fences if present
    md_match = _re.search(r'```(?:json)?\s*\n?(.*?)```', content, _re.DOTALL)
    if md_match:
        content = md_match.group(1).strip()

    if not content:
        raise ValueError("AI returned an empty response. Please try again.")

    parsed = _parse_chat_json(content)

    # Store messages in conversation
    conversation.messages.append(ChatMessage(
        role="user",
        content=user_message,
    ))

    # Extract plan steps if present
    plan_steps = parsed.get("steps") or []

    # If the response type is "confirm" and there are steps, build a CleanPlan
    response_type = parsed.get("response_type", "clarify")

    if response_type in ("propose", "adjust", "confirm") and plan_steps:
        steps = []
        for s in plan_steps:
            steps.append(CleanStep(
                step_id=s.get("step_id", f"step_{len(steps)}"),
                operation=s["operation"],
                description=s.get("description", ""),
                config=s.get("config", {}),
            ))
        conversation.current_plan = CleanPlan(
            steps=steps,
            reasoning=parsed.get("reasoning", ""),
        )

    assistant_msg = ChatMessage(
        role="assistant",
        content=parsed.get("message", ""),
        response_type=response_type,
        plan_steps=plan_steps if plan_steps else None,
    )
    conversation.messages.append(assistant_msg)

    return {
        "response_type": response_type,
        "message": parsed.get("message", ""),
        "reasoning": parsed.get("reasoning", ""),
        "plan_steps": plan_steps,
        "suggestions": parsed.get("suggestions", []),
    }


async def _call_glm_chat(settings, prompt: str) -> str:
    """Call GLM with chat-specific system prompt."""
    if not settings.glm_api_key:
        raise ValueError("GLM_API_KEY is not configured")

    import httpx

    url = f"{settings.glm_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.glm_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.glm_model,
        "messages": [
            {"role": "system", "content": _CHAT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 16384,
        "stream": False,
    }

    last_error = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            message = data["choices"][0]["message"]
            content = message.get("content", "")
            if not content.strip():
                content = message.get("reasoning_content", "")
            if not content.strip():
                raise ValueError("GLM returned empty response")
            return content

        except Exception as e:
            last_error = e
            if attempt == 0:
                import asyncio
                await asyncio.sleep(1)
                continue
            raise ValueError(f"GLM API failed after 2 attempts: {last_error}")


async def _call_anthropic_chat(settings, prompt: str) -> str:
    """Call Anthropic with chat-specific system prompt."""
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is not configured")

    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=_CHAT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    return response.content[0].text


def _parse_chat_json(content: str) -> dict:
    """Parse JSON from LLM chat output, handling various formats."""
    # Try direct parse first
    try:
        result = json.loads(content)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Try to find JSON object
    json_match = _re.search(r'\{[\s\S]*\}', content)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    # Use the robust parser from cleaner module
    return _parse_json_robust(content)


# ---------------------------------------------------------------------------
# Execute plan within conversation
# ---------------------------------------------------------------------------

async def execute_conversation_plan(
    conversation: Conversation,
    df_store: dict[str, Any],
    step_ids: list[str] | None = None,
) -> CleanResult:
    """Execute the current plan in a conversation, updating the working DataFrame."""
    if not conversation.current_plan or not conversation.current_plan.steps:
        raise ValueError("No plan to execute")

    plan = conversation.current_plan

    # Filter steps if step_ids provided
    if step_ids is not None:
        plan = CleanPlan(
            steps=[s for s in plan.steps if s.step_id in step_ids],
            reasoning=plan.reasoning,
        )
        if not plan.steps:
            raise ValueError("No steps to execute")

    # Get current DataFrame
    current_df = df_store.get(conversation.current_df_key)
    if current_df is None:
        raise ValueError("Current dataset not found")

    # Save pre-execution state for selective apply
    conversation.pre_execution_df_key = conversation.current_df_key
    conversation.last_plan_before_execute = CleanPlan(
        steps=[CleanStep(step_id=s.step_id, operation=s.operation, description=s.description, config=s.config) for s in plan.steps],
        reasoning=plan.reasoning,
    )

    # Execute
    result = await execute_clean_plan(current_df, plan)

    # Store cleaned DataFrame
    conversation.execution_count += 1
    new_key = f"{conversation.dataset_id}_conv_{conversation.conversation_id}_v{conversation.execution_count}"
    df_store[new_key] = result.df_clean
    conversation.current_df_key = new_key
    conversation.last_result = result

    # Record version in history
    conversation.version_history.append({
        "version": conversation.execution_count,
        "df_key": new_key,
        "label": f"v{conversation.execution_count}: {', '.join(s.operation for s in plan.steps)}",
        "rows": len(result.df_clean),
        "rows_removed": result.rows_before - result.rows_after,
        "changes": result.total_changes,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })

    # Clear current plan after execution
    conversation.current_plan = None

    # Add execution result message to conversation
    steps_summary = ", ".join(
        f"{s.operation} ({s.rows_affected} changes)" for s in result.plan.steps if s.status == "done"
    )
    conversation.messages.append(ChatMessage(
        role="assistant",
        content=(
            f"Cleaning complete! "
            f"Rows: {result.rows_before} → {result.rows_after} "
            f"({result.rows_before - result.rows_after} removed). "
            f"Total changes: {result.total_changes}. "
            f"Steps: {steps_summary}. "
            f"What else would you like to do?"
        ),
        response_type="confirm",
        result_summary={
            "rows_before": result.rows_before,
            "rows_after": result.rows_after,
            "total_changes": result.total_changes,
            "execution_time_ms": result.execution_time_ms,
            "steps": [
                {
                    "step_id": s.step_id,
                    "operation": s.operation,
                    "description": s.description,
                    "rows_affected": s.rows_affected,
                    "status": s.status,
                    "error": s.error,
                }
                for s in result.plan.steps
            ],
            "changes": [
                {
                    "row_index": c.row_index,
                    "column": c.column,
                    "before": c.before,
                    "after": c.after,
                    "operation": c.operation,
                    "step_id": c.step_id,
                }
                for c in result.changes[:500]
            ],
        },
    ))

    return result


# ---------------------------------------------------------------------------
# Selective apply — re-execute plan with rejected steps skipped
# ---------------------------------------------------------------------------

async def apply_selective_changes(
    conversation: Conversation,
    df_store: dict[str, Any],
    rejected_step_ids: list[str],
) -> CleanResult:
    """
    Re-execute the last plan from the pre-execution DataFrame,
    skipping the rejected steps.
    """
    if not conversation.last_plan_before_execute:
        raise ValueError("No previous execution to selectively apply from")

    if not conversation.pre_execution_df_key:
        raise ValueError("Pre-execution DataFrame not available")

    pre_df = df_store.get(conversation.pre_execution_df_key)
    if pre_df is None:
        raise ValueError("Pre-execution dataset not found")

    # Build plan without rejected steps
    original_plan = conversation.last_plan_before_execute
    kept_steps = [s for s in original_plan.steps if s.step_id not in rejected_step_ids]

    if not kept_steps:
        raise ValueError("All steps were rejected — nothing to apply")

    new_plan = CleanPlan(
        steps=[CleanStep(step_id=s.step_id, operation=s.operation, description=s.description, config=s.config) for s in kept_steps],
        reasoning=original_plan.reasoning,
    )

    # Re-execute from the pre-execution state
    result = await execute_clean_plan(pre_df, new_plan)

    # Store cleaned DataFrame
    conversation.execution_count += 1
    new_key = f"{conversation.dataset_id}_conv_{conversation.conversation_id}_v{conversation.execution_count}"
    df_store[new_key] = result.df_clean
    conversation.current_df_key = new_key
    conversation.last_result = result
    conversation.last_plan_before_execute = CleanPlan(
        steps=[CleanStep(step_id=s.step_id, operation=s.operation, description=s.description, config=s.config) for s in new_plan.steps],
        reasoning=new_plan.reasoning,
    )

    # Add message
    rejected_ops = [s.operation for s in original_plan.steps if s.step_id in rejected_step_ids]
    steps_summary = ", ".join(
        f"{s.operation} ({s.rows_affected} changes)" for s in result.plan.steps if s.status == "done"
    )
    conversation.messages.append(ChatMessage(
        role="assistant",
        content=(
            f"Selective cleaning applied! "
            f"Rejected: {', '.join(rejected_ops)}. "
            f"Rows: {result.rows_before} → {result.rows_after} "
            f"({result.rows_before - result.rows_after} removed). "
            f"Steps: {steps_summary}. "
            f"What else would you like to do?"
        ),
        response_type="confirm",
        result_summary={
            "rows_before": result.rows_before,
            "rows_after": result.rows_after,
            "total_changes": result.total_changes,
            "execution_time_ms": result.execution_time_ms,
            "steps": [
                {
                    "step_id": s.step_id,
                    "operation": s.operation,
                    "description": s.description,
                    "rows_affected": s.rows_affected,
                    "status": s.status,
                    "error": s.error,
                }
                for s in result.plan.steps
            ],
            "changes": [
                {
                    "row_index": c.row_index,
                    "column": c.column,
                    "before": c.before,
                    "after": c.after,
                    "operation": c.operation,
                    "step_id": c.step_id,
                }
                for c in result.changes[:500]
            ],
        },
    ))

    return result


# ---------------------------------------------------------------------------
# Version history & rollback
# ---------------------------------------------------------------------------

def get_version_history(conversation: Conversation) -> list[dict[str, Any]]:
    """Get the version history for a conversation."""
    return conversation.version_history


def rollback_version(
    conversation: Conversation,
    df_store: dict[str, Any],
    target_version: int,
) -> dict[str, Any]:
    """Rollback to a specific version. target_version=0 = original dataset."""
    if target_version == 0:
        conversation.current_df_key = conversation.dataset_id
        conversation.current_plan = None
        conversation.last_result = None
        conversation.last_plan_before_execute = None
        original_df = df_store.get(conversation.dataset_id)
        rows = len(original_df) if original_df else 0
        conversation.messages.append(ChatMessage(
            role="assistant",
            content=f"Rolled back to original dataset ({rows} rows). All changes undone.",
            response_type="confirm",
        ))
        return {"version": 0, "label": "Original", "rows": rows}

    target = None
    for v in conversation.version_history:
        if v["version"] == target_version:
            target = v
            break
    if not target:
        raise ValueError(f"Version {target_version} not found")
    if target["df_key"] not in df_store:
        raise ValueError(f"DataFrame for version {target_version} not available")

    conversation.current_df_key = target["df_key"]
    conversation.current_plan = None
    conversation.last_result = None
    conversation.last_plan_before_execute = None
    conversation.version_history = [v for v in conversation.version_history if v["version"] <= target_version]
    conversation.messages.append(ChatMessage(
        role="assistant",
        content=f"Rolled back to {target['label']} ({target['rows']} rows). Later versions discarded.",
        response_type="confirm",
    ))
    return {"version": target_version, "label": target["label"], "rows": target["rows"]}
