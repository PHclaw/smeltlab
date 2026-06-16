"""Cleaning endpoints — run AI or preset cleaning operations."""

from __future__ import annotations

import dataclasses
import uuid

from fastapi import APIRouter, HTTPException

from app.api.routes.datasets import _dataframes, _profiles
from app.schemas.api import (
    ChangeRecordSchema,
    ChatRequest,
    ChatResponse,
    ChatPlanStepSchema,
    CleanPlanResponse,
    CleanRequest,
    CleanResultResponse,
    CleanStepSchema,
    DiffSummaryResponse,
    ExecuteChatRequest,
    ExecutePlanRequest,
    GeneratePlanRequest,
    SelectiveApplyRequest,
    SelectiveApplyResponse,
)
from app.services.cleaner import (
    CleanPlan,
    CleanResult,
    clean_with_instruction,
    clean_with_presets,
    execute_clean_plan,
    generate_clean_plan,
)
from app.services.conversation import (
    Conversation,
    apply_selective_changes,
    chat_with_ai,
    execute_conversation_plan,
    get_conversation,
    get_or_create_conversation,
)

router = APIRouter()

# Store clean results in memory for MVP
_clean_results: dict[str, object] = {}

# Store generated plans in memory for MVP
_clean_plans: dict[str, CleanPlan] = {}
_plan_dataset_map: dict[str, str] = {}  # plan_id → dataset_id


@router.post("/{dataset_id}/plan", response_model=CleanPlanResponse)
async def generate_plan(dataset_id: str, request: GeneratePlanRequest):
    """Generate a cleaning plan without executing it."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")
    if dataset_id not in _profiles:
        raise HTTPException(400, "Dataset not profiled yet. Run profiling first.")

    df = _dataframes[dataset_id]
    profile = _profiles[dataset_id]

    try:
        plan = await generate_clean_plan(df, profile, request.instruction)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"AI plan generation failed: {e}")

    plan_id = str(uuid.uuid4())
    _clean_plans[plan_id] = plan
    _plan_dataset_map[plan_id] = dataset_id

    return CleanPlanResponse(
        plan_id=plan_id,
        reasoning=plan.reasoning,
        estimated_row_reduction=plan.estimated_row_reduction,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=0,
                status="pending",
                error=None,
            )
            for s in plan.steps
        ],
    )


@router.post("/{dataset_id}/execute", response_model=CleanResultResponse)
async def execute_plan(dataset_id: str, request: ExecutePlanRequest):
    """Execute a previously generated plan."""
    if request.plan_id not in _clean_plans:
        raise HTTPException(404, "Plan not found or expired")
    if _plan_dataset_map.get(request.plan_id) != dataset_id:
        raise HTTPException(400, "Plan does not belong to this dataset")
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    plan = _clean_plans.pop(request.plan_id)
    _plan_dataset_map.pop(request.plan_id, None)

    # Filter steps if step_ids provided
    if request.step_ids is not None:
        plan.steps = [s for s in plan.steps if s.step_id in request.step_ids]
        if not plan.steps:
            raise HTTPException(400, "No steps to execute")

    df = _dataframes[dataset_id]

    try:
        result = await execute_clean_plan(df, plan)
    except Exception as e:
        raise HTTPException(500, f"Plan execution failed: {e}")

    job_id = str(uuid.uuid4())
    _clean_results[job_id] = result
    _dataframes[f"{dataset_id}_clean_{job_id}"] = result.df_clean

    return CleanResultResponse(
        job_id=job_id,
        status="completed",
        reasoning=result.plan.reasoning,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=s.rows_affected,
                status=s.status,
                error=s.error,
            )
            for s in result.plan.steps
        ],
        changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:500]
        ],
    )


@router.post("/{dataset_id}", response_model=CleanResultResponse)
async def run_clean(dataset_id: str, request: CleanRequest):
    """
    Run a cleaning job on a dataset.

    Provide either:
    - `instruction`: natural language description (uses AI)
    - `operations`: list of preset operations (no AI needed)
    """
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    df = _dataframes[dataset_id]

    if request.instruction:
        # AI-powered cleaning
        if dataset_id not in _profiles:
            raise HTTPException(400, "Dataset not profiled yet. Run profiling first.")

        profile = _profiles[dataset_id]

        try:
            result = await clean_with_instruction(df, profile, request.instruction)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(500, f"AI cleaning failed: {e}")

    elif request.operations:
        # Preset cleaning
        try:
            result = clean_with_presets(df, request.operations)
        except Exception as e:
            raise HTTPException(500, f"Cleaning failed: {e}")
    else:
        raise HTTPException(400, "Provide either 'instruction' or 'operations'")

    # Store result
    job_id = str(uuid.uuid4())
    _clean_results[job_id] = result

    # Also update the dataframe store with cleaned version
    _dataframes[f"{dataset_id}_clean_{job_id}"] = result.df_clean

    return CleanResultResponse(
        job_id=job_id,
        status="completed",
        reasoning=result.plan.reasoning,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=s.rows_affected,
                status=s.status,
                error=s.error,
            )
            for s in result.plan.steps
        ],
        changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:500]  # Limit to 500 changes in response
        ],
    )


@router.get("/jobs/{job_id}/diff", response_model=DiffSummaryResponse)
async def get_diff_summary(job_id: str):
    """Get a summary of all changes made in a cleaning job."""
    if job_id not in _clean_results:
        raise HTTPException(404, "Job not found")

    result = _clean_results[job_id]

    # Aggregate changes
    by_operation: dict[str, int] = {}
    by_column: dict[str, int] = {}
    rows_removed = 0
    values_modified = 0

    for c in result.changes:
        by_operation[c.operation] = by_operation.get(c.operation, 0) + 1
        by_column[c.column] = by_column.get(c.column, 0) + 1

        if c.column == "__row__" and c.after == "removed":
            rows_removed += 1
        else:
            values_modified += 1

    return DiffSummaryResponse(
        total_changes=result.total_changes,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        rows_removed=rows_removed,
        rows_added=0,
        values_modified=values_modified,
        changes_by_operation=by_operation,
        changes_by_column=by_column,
        sample_changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:50]
        ],
    )


@router.get("/jobs/{job_id}/export")
async def export_cleaned(job_id: str, format: str = "csv"):
    """Export the cleaned dataset from a specific job."""
    if job_id not in _clean_results:
        raise HTTPException(404, "Job not found")

    result = _clean_results[job_id]
    df = result.df_clean

    import io
    from fastapi.responses import StreamingResponse

    if format == "csv":
        buf = io.BytesIO()
        buf.write(df.write_csv().encode("utf-8"))
        buf.seek(0)
        media_type = "text/csv"
        filename = f"cleaned_{job_id[:8]}.csv"
    elif format == "json":
        buf = io.BytesIO()
        buf.write(df.write_json().encode("utf-8"))
        buf.seek(0)
        media_type = "application/json"
        filename = f"cleaned_{job_id[:8]}.json"
    elif format == "jsonl":
        buf = io.BytesIO()
        buf.write(df.write_ndjson().encode("utf-8"))
        buf.seek(0)
        media_type = "application/x-ndjson"
        filename = f"cleaned_{job_id[:8]}.jsonl"
    else:
        raise HTTPException(400, f"Unsupported format: {format}")

    return StreamingResponse(
        buf,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Conversational cleaning endpoints
# ---------------------------------------------------------------------------

@router.post("/{dataset_id}/chat", response_model=ChatResponse)
async def chat_clean(dataset_id: str, request: ChatRequest):
    """
    Interactive conversational cleaning endpoint.

    Send a message and get an AI response that may include:
    - A proposed cleaning plan (response_type: "propose" | "adjust")
    - Execution confirmation (response_type: "confirm")
    - Clarification request (response_type: "clarify")
    """
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")
    if dataset_id not in _profiles:
        raise HTTPException(400, "Dataset not profiled yet. Run profiling first.")

    profile = _profiles[dataset_id]
    conversation = get_or_create_conversation(request.conversation_id, dataset_id)

    # Get the current working DataFrame
    current_df = _dataframes.get(conversation.current_df_key)
    if current_df is None:
        raise HTTPException(404, "Current dataset state not found")

    try:
        ai_response = await chat_with_ai(profile, current_df, conversation, request.message)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"AI chat failed: {e}")

    # Build response
    plan_steps = None
    if ai_response.get("plan_steps"):
        plan_steps = [
            ChatPlanStepSchema(
                step_id=s.get("step_id", f"step_{i}"),
                operation=s["operation"],
                description=s.get("description", ""),
                config=s.get("config", {}),
            )
            for i, s in enumerate(ai_response["plan_steps"])
        ]

    return ChatResponse(
        conversation_id=conversation.conversation_id,
        response_type=ai_response["response_type"],
        message=ai_response["message"],
        reasoning=ai_response.get("reasoning", ""),
        plan=plan_steps,
        result=None,
        suggestions=ai_response.get("suggestions", []),
    )


@router.post("/chat/{conversation_id}/execute", response_model=ChatResponse)
async def execute_chat_plan(conversation_id: str, request: ExecuteChatRequest):
    """Execute the current plan within a conversation."""
    conversation = get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")
    if not conversation.current_plan:
        raise HTTPException(400, "No plan to execute. Send a chat message first to propose a plan.")

    try:
        result = await execute_conversation_plan(
            conversation,
            _dataframes,
            step_ids=request.step_ids,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Plan execution failed: {e}")

    # Build result response
    result_response = CleanResultResponse(
        job_id=f"conv_{conversation_id}_{conversation.execution_count}",
        status="completed",
        reasoning=result.plan.reasoning,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=s.rows_affected,
                status=s.status,
                error=s.error,
            )
            for s in result.plan.steps
        ],
        changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:500]
        ],
    )

    # Get the last assistant message (the execution confirmation)
    last_msg = ""
    for msg in reversed(conversation.messages):
        if msg.role == "assistant" and msg.response_type == "confirm":
            last_msg = msg.content
            break

    return ChatResponse(
        conversation_id=conversation_id,
        response_type="confirm",
        message=last_msg or f"Cleaning complete! Rows: {result.rows_before} → {result.rows_after}",
        reasoning="",
        plan=None,
        result=result_response,
        suggestions=["Export cleaned data", "Check for remaining issues", "Apply another cleaning operation"],
    )


@router.get("/chat/{conversation_id}/export")
async def export_conversation_data(conversation_id: str, format: str = "csv"):
    """Export the current (cleaned) data from a conversation."""
    conversation = get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")

    df = _dataframes.get(conversation.current_df_key)
    if df is None:
        raise HTTPException(404, "Dataset not found")

    import io
    from fastapi.responses import StreamingResponse

    if format == "csv":
        buf = io.BytesIO()
        buf.write(df.write_csv().encode("utf-8"))
        buf.seek(0)
        media_type = "text/csv"
        filename = f"cleaned_{conversation_id[:8]}.csv"
    elif format == "json":
        buf = io.BytesIO()
        buf.write(df.write_json().encode("utf-8"))
        buf.seek(0)
        media_type = "application/json"
        filename = f"cleaned_{conversation_id[:8]}.json"
    elif format == "jsonl":
        buf = io.BytesIO()
        buf.write(df.write_ndjson().encode("utf-8"))
        buf.seek(0)
        media_type = "application/x-ndjson"
        filename = f"cleaned_{conversation_id[:8]}.jsonl"
    else:
        raise HTTPException(400, f"Unsupported format: {format}")

    return StreamingResponse(
        buf,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/chat/{conversation_id}/apply-selective", response_model=SelectiveApplyResponse)
async def apply_selective(conversation_id: str, request: SelectiveApplyRequest):
    """
    Selectively apply changes from the last execution.

    Re-executes the plan from the pre-execution state, skipping rejected steps.
    """
    conversation = get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")

    try:
        result = await apply_selective_changes(
            conversation,
            _dataframes,
            rejected_step_ids=request.rejected_step_ids,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Selective apply failed: {e}")

    applied_ops = [s.operation for s in result.plan.steps if s.status == "done"]

    result_response = CleanResultResponse(
        job_id=f"conv_{conversation_id}_selective_{conversation.execution_count}",
        status="completed",
        reasoning=result.plan.reasoning,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=s.rows_affected,
                status=s.status,
                error=s.error,
            )
            for s in result.plan.steps
        ],
        changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:500]
        ],
    )

    return SelectiveApplyResponse(
        conversation_id=conversation_id,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps_applied=applied_ops,
        steps_rejected=request.rejected_step_ids,
        result=result_response,
    )
