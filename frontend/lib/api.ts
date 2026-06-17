/**
 * DataCleanr API client
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export interface DatasetUploadResponse {
  id: string;
  name: string;
  format: string;
  row_count: number;
  col_count: number;
  file_size_bytes: number;
  status: string;
}

export interface BatchUploadResponse {
  batch_id: string;
  datasets: DatasetUploadResponse[];
}

export interface BatchApplyResult {
  dataset_id: string;
  dataset_name: string;
  status: string;
  rows_before: number;
  rows_after: number;
  total_changes: number;
  error: string | null;
}

export interface BatchApplyRecipeResponse {
  batch_id: string;
  recipe_id: string;
  results: BatchApplyResult[];
}

export interface ColumnProfile {
  name: string;
  inferred_type: string;
  null_count: number;
  null_pct: number;
  unique_count: number;
  unique_pct: number;
  sample_values: string[];
  issues: string[];
  stats: Record<string, any>;
}

export interface Issue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  affected_rows: number;
  affected_column: string | null;
  suggestion: string;
}

export interface ProfileResponse {
  health_score: number;
  total_rows: number;
  total_columns: number;
  file_size_bytes: number;
  duplicate_rows: number;
  duplicate_pct: number;
  columns: ColumnProfile[];
  issues: Issue[];
  preview_rows: Record<string, any>[];
}

export interface CleanStep {
  step_id: string;
  operation: string;
  description: string;
  config: Record<string, any>;
  rows_affected: number;
  status: string;
  error: string | null;
}

export interface ChangeRecord {
  row_index: number;
  column: string;
  before: any;
  after: any;
  operation: string;
  step_id: string;
}

export interface CleanResultResponse {
  job_id: string;
  status: string;
  reasoning: string;
  rows_before: number;
  rows_after: number;
  total_changes: number;
  execution_time_ms: number;
  steps: CleanStep[];
  changes: ChangeRecord[];
}

export interface DiffSummary {
  total_changes: number;
  rows_before: number;
  rows_after: number;
  rows_removed: number;
  rows_added: number;
  values_modified: number;
  changes_by_operation: Record<string, number>;
  changes_by_column: Record<string, number>;
  sample_changes: ChangeRecord[];
}

export interface CleanPlanResponse {
  plan_id: string;
  reasoning: string;
  estimated_row_reduction: number;
  steps: CleanStep[];
}

// --- Chat / Conversation ---

export interface ChatPlanStep {
  step_id: string;
  operation: string;
  description: string;
  config: Record<string, any>;
}

export interface ChatResponse {
  conversation_id: string;
  response_type: 'propose' | 'adjust' | 'confirm' | 'clarify';
  message: string;
  reasoning: string;
  plan: ChatPlanStep[] | null;
  result: CleanResultResponse | null;
  suggestions: string[];
}

export interface SelectiveApplyResponse {
  conversation_id: string;
  rows_before: number;
  rows_after: number;
  total_changes: number;
  execution_time_ms: number;
  steps_applied: string[];
  steps_rejected: string[];
  result: CleanResultResponse;
}

// --- Recipe ---

export interface RecipeStep {
  step_id: string;
  operation: string;
  description: string;
  config: Record<string, any>;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  steps: RecipeStep[];
  tags: string[];
  usage_count: number;
  created_at: string;
  is_public: boolean;
  author: string;
}

// --- LLM Validation ---

export interface LLMValidationError {
  row_index: number;
  field_path: string;
  message: string;
  severity: string;
  fixable: boolean;
}

export interface LLMValidationResult {
  format_type: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  warnings: number;
  avg_tokens: number;
  max_tokens: number;
  token_distribution: Record<string, number>;
  errors: LLMValidationError[];
}

// --- API functions ---

export async function uploadFile(file: File): Promise<DatasetUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/datasets/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(err.detail || err.message || 'Upload failed');
  }

  return res.json();
}

export async function getProfile(datasetId: string): Promise<ProfileResponse> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/profile`);
  if (!res.ok) throw new Error('Failed to get profile');
  return res.json();
}

export async function getPreview(datasetId: string, rows = 50) {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/preview?rows=${rows}`);
  if (!res.ok) throw new Error('Failed to get preview');
  return res.json();
}

export async function runClean(
  datasetId: string,
  params: { instruction?: string; operations?: any[] }
): Promise<CleanResultResponse> {
  const controller = new AbortController();
  const timeout = params.instruction ? 300000 : 30000; // AI calls need more time
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_BASE}/clean/${datasetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Cleaning failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Cleaning request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function generatePlan(
  datasetId: string,
  instruction: string
): Promise<CleanPlanResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${API_BASE}/clean/${datasetId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Plan generation failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Plan generation timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function executePlan(
  datasetId: string,
  planId: string,
  stepIds?: string[]
): Promise<CleanResultResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${API_BASE}/clean/${datasetId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, step_ids: stepIds ?? null }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Plan execution failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Execution timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getDiff(jobId: string): Promise<DiffSummary> {
  const res = await fetch(`${API_BASE}/clean/jobs/${jobId}/diff`);
  if (!res.ok) throw new Error('Failed to get diff');
  return res.json();
}

export function getExportUrl(datasetId: string, format = 'csv'): string {
  return `${API_BASE}/datasets/${datasetId}/export?format=${format}`;
}

export function getCleanExportUrl(jobId: string, format = 'csv'): string {
  return `${API_BASE}/clean/jobs/${jobId}/export?format=${format}`;
}

// --- Chat / Conversation API ---

export async function sendChatMessage(
  datasetId: string,
  message: string,
  conversationId: string | null = null
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${API_BASE}/clean/${datasetId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Chat failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Chat request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeChatPlan(
  conversationId: string,
  stepIds?: string[]
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${API_BASE}/clean/chat/${conversationId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        step_ids: stepIds ?? null,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Execution failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Execution timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getChatExportUrl(conversationId: string, format = 'csv'): string {
  return `${API_BASE}/clean/chat/${conversationId}/export?format=${format}`;
}

export async function applySelective(
  conversationId: string,
  rejectedStepIds: string[]
): Promise<SelectiveApplyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${API_BASE}/clean/chat/${conversationId}/apply-selective`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        rejected_step_ids: rejectedStepIds,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = 'Selective apply failed';
      try {
        const err = await res.json();
        errMsg = err.detail || err.message || errMsg;
      } catch { /* use default */ }
      throw new Error(errMsg);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Selective apply timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- Recipe API ---

export async function getRecipes(): Promise<Recipe[]> {
  const res = await fetch(`${API_BASE}/recipes`);
  if (!res.ok) throw new Error('Failed to fetch recipes');
  return res.json();
}

export async function createRecipe(
  name: string,
  steps: RecipeStep[],
  description: string = '',
  tags: string[] = []
): Promise<Recipe> {
  const res = await fetch(`${API_BASE}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, steps, tags }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create recipe' }));
    throw new Error(err.detail || 'Failed to create recipe');
  }
  return res.json();
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/recipes/${recipeId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete recipe');
}

export async function shareRecipe(recipeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/recipes/${recipeId}/share`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to share recipe');
}

export async function unshareRecipe(recipeId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/recipes/${recipeId}/unshare`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to unshare recipe');
}

export async function searchCommunityRecipes(query: string = '', tag: string = ''): Promise<Recipe[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (tag) params.set('tag', tag);
  const res = await fetch(`${API_BASE}/recipes/community/search?${params}`);
  if (!res.ok) throw new Error('Failed to search community recipes');
  return res.json();
}

export async function applyRecipeToDataset(
  recipeId: string,
  datasetId: string
): Promise<CleanResultResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${API_BASE}/recipes/${recipeId}/apply/${datasetId}`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to apply recipe' }));
      throw new Error(err.detail || 'Failed to apply recipe');
    }
    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Recipe application timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- LLM Validation API ---

export async function validateLLMData(
  datasetId: string,
  formatType?: string
): Promise<LLMValidationResult> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/validate-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format_type: formatType ?? null }),
  });
  if (!res.ok) throw new Error('LLM validation failed');
  return res.json();
}

export async function fixLLMData(
  datasetId: string,
  formatType?: string
): Promise<{ status: string; fix_key: string; valid_rows_after: number; invalid_rows_after: number }> {
  const params = formatType ? `?format_type=${formatType}` : '';
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/fix-llm${params}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('LLM fix failed');
  return res.json();
}

export interface ChunkResult {
  total_chunks: number;
  total_sources: number;
  avg_chunk_size: number;
  avg_tokens: number;
  chunk_key: string;
  preview_chunks: Record<string, any>[];
}

export async function chunkDataset(
  datasetId: string,
  options: {
    textColumn?: string;
    sourceColumn?: string;
    chunkSize?: number;
    overlap?: number;
    strategy?: string;
  } = {}
): Promise<ChunkResult> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text_column: options.textColumn ?? null,
      source_column: options.sourceColumn ?? null,
      chunk_size: options.chunkSize ?? 512,
      overlap: options.overlap ?? 64,
      strategy: options.strategy ?? 'paragraph',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Chunking failed' }));
    throw new Error(err.detail || 'Chunking failed');
  }
  return res.json();
}

export async function uploadBatch(files: File[]): Promise<BatchUploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`${API_BASE}/datasets/upload-batch`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Batch upload failed');
  return res.json();
}

export async function batchApplyRecipe(
  recipeId: string,
  datasetIds: string[]
): Promise<BatchApplyRecipeResponse> {
  const res = await fetch(`${API_BASE}/recipes/batch-apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_id: recipeId, dataset_ids: datasetIds }),
  });
  if (!res.ok) throw new Error('Batch apply failed');
  return res.json();
}

export function getQualityReportUrl(datasetId: string): string {
  return `${API_BASE}/datasets/${datasetId}/report`;
}

// --- Version History ---

export interface VersionInfo {
  version: number;
  label: string;
  rows: number;
  timestamp: string;
  rows_removed?: number;
  changes?: number;
}

export interface VersionHistory {
  conversation_id: string;
  current_version: number;
  versions: VersionInfo[];
}

export async function getVersionHistory(conversationId: string): Promise<VersionHistory> {
  const res = await fetch(`${API_BASE}/clean/chat/${conversationId}/history`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

export async function rollbackVersion(
  conversationId: string,
  targetVersion: number
): Promise<{ message: string }> {
  const res = await fetch(
    `${API_BASE}/clean/chat/${conversationId}/rollback?target_version=${targetVersion}`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Rollback failed' }));
    throw new Error(err.detail || 'Rollback failed');
  }
  return res.json();
}

export interface ColumnDrift {
  column: string;
  col_type: string;
  drift_score: number;
  severity: string;
  details: Record<string, any>;
}

export interface DriftReport {
  conversation_id: string;
  total_columns: number;
  drifted_columns: number;
  columns: ColumnDrift[];
}

export async function getDriftReport(conversationId: string): Promise<DriftReport> {
  const res = await fetch(`${API_BASE}/clean/chat/${conversationId}/drift`);
  if (!res.ok) throw new Error('Failed to get drift report');
  return res.json();
}

// --- Augmentation ---

export interface AugmentExample {
  row_index: number;
  technique: string;
  original: Record<string, any>;
  augmented: Record<string, any>;
  changes: string[];
}

export interface AugmentProgress {
  task_id: string;
  phase: string;
  progress_pct: number;
  processed: number;
  total: number;
  example: AugmentExample | null;
  stats: Record<string, number>;
  message: string;
}

export interface AugmentStartResponse {
  task_id: string;
  dataset_id: string;
  strategy: string;
  target_count: number;
  stream_url: string;
}

export interface AugmentApplyResponse {
  dataset_id: string;
  augmented_key: string;
  total_original: number;
  total_augmented: number;
  new_rows_added: number;
}

export async function startAugmentation(
  datasetId: string,
  options: {
    strategy?: string;
    multiplier?: number;
    targetCount?: number;
    columns?: string[];
  } = {}
): Promise<AugmentStartResponse> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/augment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategy: options.strategy ?? 'auto',
      multiplier: options.multiplier ?? 2.0,
      target_count: options.targetCount ?? null,
      columns: options.columns ?? [],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Augmentation failed' }));
    throw new Error(err.detail || 'Augmentation failed');
  }
  return res.json();
}

export async function applyAugmentation(
  datasetId: string,
  taskId: string
): Promise<AugmentApplyResponse> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/augment/${taskId}/apply`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Apply failed' }));
    throw new Error(err.detail || 'Apply failed');
  }
  return res.json();
}

export async function cancelAugmentation(
  datasetId: string,
  taskId: string
): Promise<void> {
  await fetch(`${API_BASE}/datasets/${datasetId}/augment/${taskId}/cancel`, {
    method: 'POST',
  });
}
