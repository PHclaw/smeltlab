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


# --- Batch ---

class BatchUploadResponse(BaseModel):
    batch_id: str
    datasets: list[DatasetUploadResponse]


class BatchApplyRecipeRequest(BaseModel):
    recipe_id: str
    dataset_ids: list[str]


class BatchApplyResultSchema(BaseModel):
    dataset_id: str
    dataset_name: str
    status: str  # done | failed
    rows_before: int = 0
    rows_after: int = 0
    total_changes: int = 0
    error: str | None = None


class BatchApplyRecipeResponse(BaseModel):
    batch_id: str
    recipe_id: str
    results: list[BatchApplyResultSchema]


# --- LLM Validation ---

class ValidationErrorSchema(BaseModel):
    row_index: int
    field_path: str
    message: str
    severity: str = "error"
    fixable: bool = False


class ValidationResultResponse(BaseModel):
    format_type: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    warnings: int
    avg_tokens: int = 0
    max_tokens: int = 0
    token_distribution: dict[str, int] = {}
    errors: list[ValidationErrorSchema] = []


class ValidateRequest(BaseModel):
    format_type: str | None = Field(None, description="chatml | alpaca | sharegpt. Auto-detected if null.")
    max_tokens: int = Field(4096, description="Max tokens per sample for flagging")


# --- Augmentation ---

class AugmentRequest(BaseModel):
    strategy: str = Field("auto", description="auto | llm_paraphrase | text_augment | numeric_noise | oversample")
    multiplier: float = Field(2.0, description="Data multiplier (e.g. 2.0 = double the rows)")
    target_count: int | None = Field(None, description="Exact number of new samples to generate")
    columns: list[str] = Field(default_factory=list, description="Columns to augment (empty = auto)")


class AugmentStartResponse(BaseModel):
    task_id: str
    dataset_id: str
    strategy: str
    target_count: int
    stream_url: str


class AugmentApplyResponse(BaseModel):
    dataset_id: str
    augmented_key: str
    total_original: int
    total_augmented: int
    new_rows_added: int


# --- Chunking ---

class ChunkRequest(BaseModel):
    text_column: str | None = Field(None, description="Column containing text to chunk. Auto-detect if null.")
    source_column: str | None = Field(None, description="Column containing source identifiers.")
    chunk_size: int = Field(512, description="Target chunk size in characters")
    overlap: int = Field(64, description="Overlap between chunks in characters")
    strategy: str = Field("paragraph", description="paragraph | heading | character")


class ChunkResponse(BaseModel):
    total_chunks: int
    total_sources: int
    avg_chunk_size: int
    avg_tokens: int
    chunk_key: str  # key to access chunked DataFrame
    preview_chunks: list[dict[str, Any]]


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
    is_public: bool = Field(False, description="Make recipe public for community")


class RecipeResponse(BaseModel):
    id: str
    name: str
    description: str
    steps: list[RecipeStepSchema]
    tags: list[str]
    usage_count: int
    created_at: str
    is_public: bool = False
    author: str = ""


# --- General ---

class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict[str, Any] | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str
