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
