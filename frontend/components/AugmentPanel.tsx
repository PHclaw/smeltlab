'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles, Loader2, XCircle, CheckCircle2, Zap, Play,
  Square, ChevronDown, ChevronUp, ArrowRight, RotateCcw,
  Type, Hash, BarChart3,
} from 'lucide-react';
import {
  startAugmentation, applyAugmentation, cancelAugmentation,
  type AugmentProgress, type AugmentExample,
} from '@/lib/api';
import { formatNumber } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

const STRATEGIES = [
  { value: 'auto', label: 'Auto Detect', desc: 'Choose best strategy based on data type' },
  { value: 'llm_paraphrase', label: 'AI Paraphrase', desc: 'Use LLM to rewrite training data' },
  { value: 'text_augment', label: 'Text Augment', desc: 'Synonym replace, insert, delete' },
  { value: 'numeric_noise', label: 'Numeric Noise', desc: 'Gaussian noise + interpolation' },
  { value: 'oversample', label: 'Oversample', desc: 'Duplicate minority class samples' },
];

const TECH_LABELS: Record<string, { label: string; color: string }> = {
  llm_paraphrase: { label: 'AI Paraphrase', color: 'text-primary-700 bg-primary-50' },
  synonym_replace: { label: 'Synonym', color: 'text-blue-700 bg-blue-50' },
  random_insert: { label: 'Insert', color: 'text-cyan-700 bg-cyan-50' },
  random_delete: { label: 'Delete', color: 'text-orange-700 bg-orange-50' },
  noise_injection: { label: 'Noise', color: 'text-amber-700 bg-amber-50' },
  interpolation: { label: 'Interpolate', color: 'text-purple-700 bg-purple-50' },
};

interface AugmentPanelProps {
  datasetId: string;
  columns: string[];
  onClose: () => void;
  onComplete: (newRowsAdded: number) => void;
}

type Phase = 'config' | 'running' | 'done';

export function AugmentPanel({ datasetId, columns, onClose, onComplete }: AugmentPanelProps) {
  const [phase, setPhase] = useState<Phase>('config');
  const [strategy, setStrategy] = useState('auto');
  const [multiplier, setMultiplier] = useState(2);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [selectedCols, setSelectedCols] = useState<string[]>([]);

  // Runtime state
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [examples, setExamples] = useState<AugmentExample[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAllExamples, setShowAllExamples] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleStart = async () => {
    setPhase('running');
    setProgress(0);
    setProcessed(0);
    setExamples([]);
    setStats({});
    setError(null);

    try {
      const result = await startAugmentation(datasetId, {
        strategy,
        multiplier,
        targetCount: targetCount ?? undefined,
        columns: selectedCols.length > 0 ? selectedCols : undefined,
      });

      setTaskId(result.task_id);
      setTotal(result.target_count);

      // Connect SSE stream
      const es = new EventSource(`${API_BASE}/datasets/${datasetId}/augment/${result.task_id}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data: AugmentProgress = JSON.parse(event.data);

        if (data.phase === 'heartbeat') return;

        setProgress(data.progress_pct);
        setProcessed(data.processed);
        setTotal(data.total);
        setStats(data.stats || {});
        setMessage(data.message || '');

        if (data.example) {
          setExamples((prev) => [data.example!, ...prev].slice(0, 50));
        }

        if (data.phase === 'done' || data.phase === 'cancelled') {
          es.close();
          eventSourceRef.current = null;
          setPhase('done');
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setPhase('done');
      };
    } catch (err: any) {
      setError(err.message || 'Failed to start augmentation');
      setPhase('config');
    }
  };

  const handleCancel = async () => {
    if (taskId) {
      await cancelAugmentation(datasetId, taskId);
      eventSourceRef.current?.close();
      setPhase('done');
    }
  };

  const handleApply = async () => {
    if (!taskId) return;
    try {
      const result = await applyAugmentation(datasetId, taskId);
      onComplete(result.new_rows_added);
    } catch (err: any) {
      setError(err.message || 'Failed to apply augmentation');
    }
  };

  const toggleCol = (col: string) => {
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const totalStats = Object.values(stats).reduce((sum, v) => sum + v, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary-600" />
          <h3 className="text-base font-semibold text-gray-900">Data Augmentation</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <XCircle className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5">
        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Config phase */}
        {phase === 'config' && (
          <div className="space-y-4">
            {/* Strategy */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Strategy</label>
              <div className="grid grid-cols-1 gap-2">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStrategy(s.value)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      strategy === s.value
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-primary-300'
                    }`}
                  >
                    <div className={`h-3 w-3 rounded-full flex-shrink-0 ${
                      strategy === s.value ? 'bg-primary-500' : 'bg-gray-300'
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{s.label}</div>
                      <div className="text-xs text-gray-500">{s.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Multiplier */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Target: {targetCount ? `${targetCount} new samples` : `${multiplier}x data`}
              </label>
              <input
                type="range"
                min={1.5}
                max={10}
                step={0.5}
                value={multiplier}
                onChange={(e) => { setMultiplier(parseFloat(e.target.value)); setTargetCount(null); }}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1.5x</span>
                <span>5x</span>
                <span>10x</span>
              </div>
            </div>

            {/* Column selection */}
            {columns.length > 0 && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Columns to augment <span className="text-gray-400 font-normal">(empty = auto)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((col) => (
                    <button
                      key={col}
                      onClick={() => toggleCol(col)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                        selectedCols.includes(col)
                          ? 'bg-primary-100 text-primary-700 border border-primary-300'
                          : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                      }`}
                    >
                      {col}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleStart} className="btn-primary w-full">
              <Play className="mr-2 h-4 w-4" />
              Start Augmentation
            </button>
          </div>
        )}

        {/* Running phase */}
        {phase === 'running' && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-700">
                  {message || 'Augmenting...'}
                </span>
                <span className="text-sm text-gray-500">
                  {formatNumber(processed)} / {formatNumber(total)} ({progress.toFixed(0)}%)
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Stats bar */}
            {totalStats > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats).map(([tech, count]) => {
                  const info = TECH_LABELS[tech] || { label: tech, color: 'text-gray-700 bg-gray-50' };
                  return (
                    <span key={tech} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${info.color}`}>
                      {info.label}: {formatNumber(count)}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Live example feed */}
            {examples.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary-500" />
                    Live Transformations
                  </span>
                  <button
                    onClick={() => setShowAllExamples(!showAllExamples)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-0.5"
                  >
                    {showAllExamples ? 'Show less' : `Show all (${examples.length})`}
                    {showAllExamples ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {(showAllExamples ? examples : examples.slice(0, 5)).map((ex, i) => (
                    <ExampleCard key={`${ex.row_index}-${i}`} example={ex} isNew={i === 0 && !showAllExamples} />
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleCancel} className="btn-ghost w-full text-red-600 hover:bg-red-50">
              <Square className="mr-2 h-4 w-4" />
              Cancel
            </button>
          </div>
        )}

        {/* Done phase */}
        {phase === 'done' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-semibold text-gray-900">
                  Augmentation Complete
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{formatNumber(totalStats)}</div>
                  <div className="text-[10px] text-gray-500">New Samples</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{Object.keys(stats).length}</div>
                  <div className="text-[10px] text-gray-500">Techniques</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{examples.length}</div>
                  <div className="text-[10px] text-gray-500">Examples</div>
                </div>
              </div>
            </div>

            {/* Stats breakdown */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats).map(([tech, count]) => {
                const info = TECH_LABELS[tech] || { label: tech, color: 'text-gray-700 bg-gray-50' };
                return (
                  <span key={tech} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${info.color}`}>
                    {info.label}: {formatNumber(count)}
                  </span>
                );
              })}
            </div>

            {/* Sample examples */}
            {examples.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Sample Transformations</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {examples.slice(0, 5).map((ex, i) => (
                    <ExampleCard key={`done-${ex.row_index}-${i}`} example={ex} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleApply} className="btn-primary flex-1">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Apply {formatNumber(totalStats)} New Samples
              </button>
              <button onClick={onClose} className="btn-ghost">
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Example Card — shows the transformation process
// ---------------------------------------------------------------------------

function ExampleCard({ example, isNew = false }: { example: AugmentExample; isNew?: boolean }) {
  const info = TECH_LABELS[example.technique] || { label: example.technique, color: 'text-gray-700 bg-gray-100' };
  const originalKeys = Object.keys(example.original);
  const augmentedKeys = Object.keys(example.augmented);
  const allKeys = Array.from(new Set([...originalKeys, ...augmentedKeys]));

  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isNew ? 'border-primary-300 bg-primary-50/30 animate-pulse' : 'border-gray-200 bg-white'
    }`}>
      {/* Technique badge + row index */}
      <div className="flex items-center justify-between mb-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${info.color}`}>
          {info.label}
        </span>
        <span className="text-[10px] text-gray-400">Row #{example.row_index}</span>
      </div>

      {/* Before → After comparison */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
        {/* Original */}
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Original</div>
          {allKeys.map((key) => {
            const val = example.original[key];
            if (val === undefined || val === null) return null;
            const augVal = example.augmented[key];
            const changed = String(val) !== String(augVal);
            return (
              <div key={key} className="text-xs">
                <span className="text-gray-400 font-mono text-[10px]">{key}:</span>
                <p className={`font-mono text-[11px] leading-snug ${changed ? 'text-red-600 bg-red-50 rounded px-1' : 'text-gray-600'}`}>
                  {String(val).slice(0, 120)}{String(val).length > 120 ? '...' : ''}
                </p>
              </div>
            );
          })}
        </div>

        {/* Arrow */}
        <div className="flex flex-col items-center pt-4">
          <ArrowRight className="h-4 w-4 text-primary-500" />
        </div>

        {/* Augmented */}
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Augmented</div>
          {allKeys.map((key) => {
            const val = example.augmented[key];
            if (val === undefined || val === null) return null;
            const origVal = example.original[key];
            const changed = String(val) !== String(origVal);
            return (
              <div key={key} className="text-xs">
                <span className="text-gray-400 font-mono text-[10px]">{key}:</span>
                <p className={`font-mono text-[11px] leading-snug ${changed ? 'text-emerald-700 bg-emerald-50 rounded px-1' : 'text-gray-600'}`}>
                  {String(val).slice(0, 120)}{String(val).length > 120 ? '...' : ''}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Changes description */}
      {example.changes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          {example.changes.slice(0, 3).map((change, i) => (
            <p key={i} className="text-[10px] text-gray-500">
              • {change}
            </p>
          ))}
          {example.changes.length > 3 && (
            <p className="text-[10px] text-gray-400">+{example.changes.length - 3} more changes</p>
          )}
        </div>
      )}
    </div>
  );
}
