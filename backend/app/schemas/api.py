"""Pydantic schemas for API request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# --- Dataset ---

class DatasetUploadResponse(BaseModel):
    id: str
    name: str
    format: str
    row_count: int
    col_count: int
    file_size_bytes: int
    status: str  # pending | profiling | ready | error


class ColumnProfileSchema(BaseModel):
    name: str
    inferred_type: str
    null_count: int = 0
    null_pct: float = 0.0
    unique_count: int = 0
    unique_pct: float = 0.0
    sample_values: list[str] = []
    issues: list[str] = []
    stats: dict[str, Any] = {}


class IssueSchema(BaseModel):
    severity: str
    category: str
    message: str
    affected_rows: int = 0
    affected_column: str | None = None
    suggestion: str = ""


class ProfileResponse(BaseModel):
    health_score: int
    total_rows: int
    total_columns: int
    file_size_bytes: int = 0
    duplicate_rows: int = 0
    duplicate_pct: float = 0.0
    columns: list[ColumnProfileSchema]
    issues: list[IssueSchema]
    preview_rows: list[dict[str, Any]] = []


class PreviewResponse(BaseModel):
    rows: list[dict[str, Any]]
    total_rows: int
    columns: list[str]


# --- Clean ---

class CleanRequest(BaseModel):
    instruction: str | None = Field(None, description="Natural language cleaning instruction")
    operations: list[dict[str, Any]] | None = Field(None, description="Preset operations to execute")


class GeneratePlanRequest(BaseModel):
    instruction: str = Field(..., description="Natural language cleaning instruction")


class CleanPlanResponse(BaseModel):
    plan_id: str
    reasoning: str = ""
    estimated_row_reduction: int = 0
    steps: list[CleanStepSchema]


class ExecutePlanRequest(BaseModel):
    plan_id: str
    step_ids: list[str] | None = Field(None, description="Step IDs to execute. None = all steps.")


class ChangeRecordSchema(BaseModel):
    row_index: int
    column: str
    before: Any
    after: Any
    operation: str
    step_id: str


class CleanStepSchema(BaseModel):
    step_id: str
    operation: str
    description: str
    config: dict[str, Any] = {}
    rows_affected: int = 0
    status: str = "pending"
    error: str | None = None


class CleanResultResponse(BaseModel):
    job_id: str
    status: str
    reasoning: str = ""
    rows_before: int
    rows_after: int
    total_changes: int
    execution_time_ms: int
    steps: list[CleanStepSchema]
    changes: list[ChangeRecordSchema] = []


class DiffSummaryResponse(BaseModel):
    total_changes: int
    rows_before: int
    rows_after: int
    rows_removed: int
    rows_added: int
    values_modified: int
    changes_by_operation: dict[str, int]
    changes_by_column: dict[str, int]
    sample_changes: list[ChangeRecordSchema]


class ExportResponse(BaseModel):
    download_url: str
    format: str
    row_count: int
    file_size_bytes: int


# --- Chat / Conversation ---

class ChatRequest(BaseModel):
    conversation_id: str | None = Field(None, description="Existing conversation ID, null for new conversation")
    message: str = Field(..., description="User's chat message")


class ChatPlanStepSchema(BaseModel):
    step_id: str
    operation: str
    description: str
    config: dict[str, Any] = {}


class ChatResponse(BaseModel):
    conversation_id: str
    response_type: str  # propose | adjust | confirm | clarify
    message: str
    reasoning: str = ""
    plan: list[ChatPlanStepSchema] | None = None
    result: CleanResultResponse | None = None
    suggestions: list[str] = []


class ExecuteChatRequest(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID")
    step_ids: list[str] | None = Field(None, description="Step IDs to execute. None = all steps.")


class SelectiveApplyRequest(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID")
    rejected_step_ids: list[str] = Field(default_factory=list, description="Step IDs to reject")


class SelectiveApplyResponse(BaseModel):
    conversation_id: str
    rows_before: int
    rows_after: int
    total_changes: int
    execution_time_ms: int
    steps_applied: list[str]
    steps_rejected: list[str]
    result: CleanResultResponse


# --- Recipe ---

class RecipeStepSchema(BaseModel):
    step_id: str
    operation: str
    description: str
    config: dict[str, Any] = {}


class CreateRecipeRequest(BaseModel):
    name: str = Field(..., description="Recipe name")
    description: str = Field("", description="Recipe description")
    steps: list[RecipeStepSchema] = Field(..., description="Cleaning steps")
    tags: list[str] = Field(default_factory=list, description="Tags")


class RecipeResponse(BaseModel):
    id: str
    name: str
    description: str
    steps: list[RecipeStepSchema]
    tags: list[str]
    usage_count: int
    created_at: str


# --- General ---

class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict[str, Any] | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str
