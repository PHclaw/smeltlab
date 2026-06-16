'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Sparkles, Loader2, CheckCircle2, XCircle, ArrowRight,
  Download, RotateCcw, Zap, Shield, Calendar, Filter, Type,
  MessageSquare, Play, Send, ChevronDown, ChevronUp, Tag,
} from 'lucide-react';
import {
  getProfile, sendChatMessage, executeChatPlan, getChatExportUrl, applySelective, createRecipe,
  type ProfileResponse, type ChatResponse, type ChatPlanStep,
  type CleanResultResponse, type ChangeRecord, type RecipeStep,
} from '@/lib/api';
import { formatNumber, formatDuration } from '@/lib/utils';
import { DiffReview } from '@/components/DiffReview';

const QUICK_ACTIONS = [
  { label: 'Remove Duplicates', message: 'Remove all duplicate rows' },
  { label: 'Mask PII', message: 'Mask all PII including emails, phones, and IDs' },
  { label: 'Fix Dates', message: 'Standardize all date columns to YYYY-MM-DD format' },
  { label: 'Filter Outliers', message: 'Remove statistical outliers from numeric columns' },
  { label: 'Handle Missing', message: 'Drop rows that have missing values' },
  { label: 'Clean Text', message: 'Strip whitespace and normalize text columns' },
];

const OP_ICONS: Record<string, typeof Shield> = {
  dedup: RotateCcw,
  pii_mask: Shield,
  date_standardize: Calendar,
  outlier: Filter,
  missing: XCircle,
  text_clean: Type,
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: ChatPlanStep[];
  result?: CleanResultResponse;
  suggestions?: string[];
  isTyping?: boolean;
  error?: string;
}

export default function CleanPage() {
  const params = useParams();
  const datasetId = params.id as string;

  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<ChatPlanStep[] | null>(null);
  const [disabledSteps, setDisabledSteps] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load profile
  useEffect(() => {
    if (datasetId) {
      getProfile(datasetId)
        .then(setProfile)
        .catch(() => setProfileError('Failed to load dataset profile'))
        .finally(() => setLoading(false));
    }
  }, [datasetId]);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAiTyping, scrollToBottom]);

  // Send message
  const handleSend = async (text?: string) => {
    const message = (text || inputText).trim();
    if (!message || isAiTyping || isExecuting) return;

    setInputText('');
    setCurrentPlan(null);
    setDisabledSteps(new Set());

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsAiTyping(true);

    try {
      const response = await sendChatMessage(datasetId, message, conversationId);

      setConversationId(response.conversation_id);

      // Add AI response
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        plan: response.plan || undefined,
        suggestions: response.suggestions,
      };

      if (response.plan && response.plan.length > 0) {
        setCurrentPlan(response.plan);
        setDisabledSteps(new Set());
      }

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '',
        error: err.message || 'Something went wrong',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAiTyping(false);
    }
  };

  // Execute plan
  const handleExecute = async () => {
    if (!conversationId || !currentPlan || isExecuting) return;

    setIsExecuting(true);

    const activeStepIds = currentPlan
      .filter((s) => !disabledSteps.has(s.step_id))
      .map((s) => s.step_id);

    if (activeStepIds.length === 0) {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '',
        error: 'No steps selected for execution',
      }]);
      setIsExecuting(false);
      return;
    }

    try {
      const response = await executeChatPlan(conversationId, activeStepIds);

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        result: response.result || undefined,
        suggestions: response.suggestions,
      };

      setMessages((prev) => [...prev, aiMsg]);
      setCurrentPlan(null);
      setDisabledSteps(new Set());

      if (response.result) {
        setLastJobId(response.result.job_id);
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '',
        error: err.message || 'Execution failed',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsExecuting(false);
    }
  };

  // Toggle step
  const toggleStep = (stepId: string) => {
    setDisabledSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // Focus input on suggestion click
  const handleSuggestion = (suggestion: string) => {
    setInputText(suggestion);
    inputRef.current?.focus();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="card max-w-md text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-500" />
          <p className="mt-4 text-gray-700">{profileError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white flex-shrink-0">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">DataCleanr</span>
          </div>
          {profile && (
            <span className="text-sm text-gray-500">
              {formatNumber(profile.total_rows)} rows × {profile.total_columns} cols
              {' · '}
              Score: <span className={
                profile.health_score >= 80 ? 'text-emerald-600 font-medium' :
                profile.health_score >= 60 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'
              }>{profile.health_score}/100</span>
            </span>
          )}
        </div>
      </header>

      {/* Data summary bar */}
      {profile && messages.length === 0 && (
        <div className="mx-auto w-full max-w-4xl px-6 pt-4 flex-shrink-0">
          <div className="flex items-center gap-3 rounded-lg bg-white p-3 border border-gray-200">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
              <Sparkles className="h-4 w-4 text-primary-600" />
            </div>
            <div className="flex-1 text-sm">
              <span className="font-medium text-gray-900">
                Health: {profile.health_score}/100
              </span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-gray-500">
                {profile.issues.length} issues · {profile.duplicate_pct}% duplicates
              </span>
            </div>
            {profile.issues.filter((i) => i.severity === 'critical').length > 0 && (
              <span className="badge-critical text-xs">
                {profile.issues.filter((i) => i.severity === 'critical').length} critical
              </span>
            )}
          </div>
        </div>
      )}

      {/* Welcome message when no messages yet */}
      {messages.length === 0 && (
        <div className="mx-auto w-full max-w-4xl flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100">
              <MessageSquare className="h-8 w-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">AI Cleaning Assistant</h2>
            <p className="mt-2 text-gray-500 max-w-md">
              Tell me what you want to clean, and I'll analyze your data and create a plan. We can refine it together before executing.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleSend(action.message)}
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-all hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                disabledSteps={disabledSteps}
                isExecuting={isExecuting}
                onToggleStep={toggleStep}
                onExecute={handleExecute}
                onSuggestion={handleSuggestion}
                conversationId={conversationId}
                onSelectiveApplied={(newResult) => {
                  // Update the message with the new selective result
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === msg.id ? { ...m, result: newResult, content: `Selective cleaning applied! Rows: ${newResult.rows_before} → ${newResult.rows_after}` } : m
                    )
                  );
                }}
              />
            ))}

            {/* AI typing indicator */}
            {isAiTyping && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                    <Sparkles className="h-3 w-3 text-primary-500" />
                    AI Cleaning Assistant
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary-500" />
                    <span className="text-sm text-gray-500">Analyzing your data...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Executing indicator */}
            {isExecuting && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-primary-200 bg-primary-50 px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                    <span className="text-sm font-medium text-primary-700">
                      Executing cleaning plan...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white flex-shrink-0">
        <div className="mx-auto max-w-4xl px-6 py-3">
          {/* Quick actions when there are messages */}
          {messages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleSend(action.message)}
                  disabled={isAiTyping || isExecuting}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition-all hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Export button when we have results */}
          {(lastJobId || conversationId) && messages.some((m) => m.result) && (
            <div className="mb-2 flex gap-2">
              <span className="text-xs text-gray-500 self-center mr-1">Export:</span>
              {['csv', 'json', 'jsonl'].map((fmt) => (
                <a
                  key={fmt}
                  href={conversationId ? getChatExportUrl(conversationId, fmt) : '#'}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  download
                >
                  <Download className="h-3 w-3" />
                  .{fmt}
                </a>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Describe what you want to clean, or ask a question..."
              disabled={isAiTyping || isExecuting}
              className="input flex-1 disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!inputText.trim() || isAiTyping || isExecuting}
              className="btn-primary px-4"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Bubble Component
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  disabledSteps,
  isExecuting,
  onToggleStep,
  onExecute,
  onSuggestion,
  conversationId,
  onSelectiveApplied,
}: {
  message: ChatMessage;
  disabledSteps: Set<string>;
  isExecuting: boolean;
  onToggleStep: (stepId: string) => void;
  onExecute: () => void;
  onSuggestion: (text: string) => void;
  conversationId: string | null;
  onSelectiveApplied: (newResult: CleanResultResponse) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-600 px-5 py-3 text-white shadow-sm">
          <div className="flex items-center gap-2 text-xs text-primary-200 mb-1">
            <MessageSquare className="h-3 w-3" />
            You
          </div>
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
          <Sparkles className="h-3 w-3 text-primary-500" />
          AI Cleaning Assistant
        </div>

        {/* Error */}
        {message.error && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            {message.error}
          </div>
        )}

        {/* Message text */}
        {message.content && (
          <p className="text-sm text-gray-700 leading-relaxed mb-3 whitespace-pre-line">
            {message.content}
          </p>
        )}

        {/* Plan steps */}
        {message.plan && message.plan.length > 0 && (
          <div className="mb-3 space-y-2">
            {message.plan.map((step, i) => {
              const disabled = disabledSteps.has(step.step_id);
              const Icon = OP_ICONS[step.operation] || Tag;
              return (
                <div
                  key={step.step_id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${
                    disabled
                      ? 'border-gray-100 bg-gray-50 opacity-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    disabled ? 'bg-gray-100 text-gray-400' : 'bg-primary-50 text-primary-600'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className={`flex-1 ${disabled ? 'line-through' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400">Step {i + 1}</span>
                      <span className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
                        {step.operation}
                      </span>
                    </div>
                    <p className={`text-xs ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>
                      {step.description}
                    </p>
                    {Object.keys(step.config).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(step.config).map(([k, v]) => (
                          <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] ${
                            disabled ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onToggleStep(step.step_id)}
                    className={`flex-shrink-0 rounded-lg p-1.5 transition-colors ${
                      disabled
                        ? 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                        : 'text-gray-400 hover:bg-red-50 hover:text-red-500'
                    }`}
                    title={disabled ? 'Re-enable this step' : 'Skip this step'}
                  >
                    {disabled ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })}

            {/* Execute button */}
            {message.id === getLastPlanMessageId(message) && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={onExecute}
                  disabled={isExecuting}
                  className="btn-primary text-sm"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Execute Plan ({message.plan.filter((s) => !disabledSteps.has(s.step_id)).length} steps)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Execution result */}
        {message.result && (
          <ExecutionResult result={message.result} conversationId={conversationId} onSelectiveApplied={onSelectiveApplied} />
        )}

        {/* Suggestions */}
        {message.suggestions && message.suggestions.length > 0 && !message.result && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
            {message.suggestions.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => onSuggestion(suggestion)}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition-all hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execution Result Component
// ---------------------------------------------------------------------------

function ExecutionResult({
  result,
  conversationId,
  onSelectiveApplied,
}: {
  result: CleanResultResponse;
  conversationId: string | null;
  onSelectiveApplied: (newResult: CleanResultResponse) => void;
}) {
  const [rejectedSteps, setRejectedSteps] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSelectively, setAppliedSelectively] = useState(false);
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [recipeDesc, setRecipeDesc] = useState('');
  const [recipeTags, setRecipeTags] = useState('');
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [recipeSaved, setRecipeSaved] = useState(false);

  const toggleRejectStep = (stepId: string) => {
    setRejectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleApplySelected = async () => {
    if (!conversationId || rejectedSteps.size === 0) return;
    setIsApplying(true);
    try {
      const response = await applySelective(conversationId, Array.from(rejectedSteps));
      setAppliedSelectively(true);
      onSelectiveApplied(response.result);
    } catch {
      // Error handled by parent
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyAll = () => {
    setRejectedSteps(new Set());
    setAppliedSelectively(true);
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Before" value={formatNumber(result.rows_before)} />
        <MiniStat label="After" value={formatNumber(result.rows_after)} />
        <MiniStat label="Removed" value={formatNumber(result.rows_before - result.rows_after)} color="red" />
        <MiniStat label="Changes" value={formatNumber(result.total_changes)} color="amber" />
      </div>

      {/* Pipeline */}
      <div className="space-y-1.5">
        {result.steps.map((step, i) => (
          <div
            key={step.step_id}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
              step.status === 'done' ? 'bg-emerald-50' :
              step.status === 'failed' ? 'bg-red-50' : 'bg-gray-50'
            }`}
          >
            {step.status === 'done' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            ) : step.status === 'failed' ? (
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
            )}
            <span className="font-medium text-gray-700">
              {step.operation}
            </span>
            <span className="text-xs text-gray-500">{step.description}</span>
            <span className="ml-auto text-xs text-gray-400">
              {step.rows_affected > 0 && `${formatNumber(step.rows_affected)} affected`}
            </span>
          </div>
        ))}
      </div>

      {/* Duration */}
      <p className="text-xs text-gray-400">
        Completed in {formatDuration(result.execution_time_ms)}
      </p>

      {/* DiffReview — grouped change review */}
      {result.changes.length > 0 && !appliedSelectively && (
        <DiffReview
          steps={result.steps}
          changes={result.changes}
          rejectedSteps={rejectedSteps}
          onToggleStep={toggleRejectStep}
          onApplySelected={handleApplySelected}
          onApplyAll={handleApplyAll}
          isApplying={isApplying}
        />
      )}

      {/* Save as Recipe + Export */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => { setShowRecipeDialog(true); setRecipeName(`${result.steps.map(s => s.operation).join(' + ')} Recipe`); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100"
        >
          💾 Save as Recipe
        </button>
        {conversationId && ['csv', 'json', 'jsonl'].map((fmt) => (
          <a
            key={fmt}
            href={getChatExportUrl(conversationId, fmt)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            download
          >
            <Download className="h-3 w-3" />
            .{fmt}
          </a>
        ))}
      </div>

      {/* Save Recipe Dialog */}
      {showRecipeDialog && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Save as Recipe</h4>
          <input
            type="text"
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            placeholder="Recipe name"
            className="input text-sm"
          />
          <input
            type="text"
            value={recipeDesc}
            onChange={(e) => setRecipeDesc(e.target.value)}
            placeholder="Description (optional)"
            className="input text-sm"
          />
          <input
            type="text"
            value={recipeTags}
            onChange={(e) => setRecipeTags(e.target.value)}
            placeholder="Tags (comma-separated, e.g. dedup, pii, dates)"
            className="input text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!recipeName.trim()) return;
                setIsSavingRecipe(true);
                try {
                  const steps: RecipeStep[] = result.steps.map((s) => ({
                    step_id: s.step_id,
                    operation: s.operation,
                    description: s.description,
                    config: s.config,
                  }));
                  const tags = recipeTags.split(',').map((t) => t.trim()).filter(Boolean);
                  await createRecipe(recipeName.trim(), steps, recipeDesc.trim(), tags);
                  setRecipeSaved(true);
                  setShowRecipeDialog(false);
                } catch {
                  // Error handled silently
                } finally {
                  setIsSavingRecipe(false);
                }
              }}
              disabled={!recipeName.trim() || isSavingRecipe}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {isSavingRecipe ? 'Saving...' : 'Save Recipe'}
            </button>
            <button onClick={() => setShowRecipeDialog(false)} className="btn-ghost text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {recipeSaved && (
        <p className="text-xs text-emerald-600 font-medium">✅ Recipe saved successfully!</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  const textColor = color === 'red' ? 'text-red-600' : color === 'amber' ? 'text-amber-600' : 'text-gray-900';
  return (
    <div className="rounded-lg bg-gray-50 p-2 text-center">
      <div className={`text-lg font-bold ${textColor}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function getLastPlanMessageId(msg: ChatMessage): string {
  // This helper is used to show the execute button only on the latest plan message
  // We just return the message's own id so the execute button shows
  return msg.id;
}
