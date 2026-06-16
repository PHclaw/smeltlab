'use client';

import { useState } from 'react';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
  RotateCcw, Shield, Calendar, Filter, Type, Tag,
} from 'lucide-react';
import type { ChangeRecord, CleanStep } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

const OP_ICONS: Record<string, typeof Shield> = {
  dedup: RotateCcw,
  pii_mask: Shield,
  date_standardize: Calendar,
  outlier: Filter,
  missing: XCircle,
  text_clean: Type,
};

interface DiffReviewProps {
  steps: CleanStep[];
  changes: ChangeRecord[];
  rejectedSteps: Set<string>;
  onToggleStep: (stepId: string) => void;
  onApplySelected: () => void;
  onApplyAll: () => void;
  isApplying: boolean;
}

export function DiffReview({
  steps,
  changes,
  rejectedSteps,
  onToggleStep,
  onApplySelected,
  onApplyAll,
  isApplying,
}: DiffReviewProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  // Group changes by step_id
  const changesByStep = new Map<string, ChangeRecord[]>();
  for (const change of changes) {
    const existing = changesByStep.get(change.step_id) || [];
    existing.push(change);
    changesByStep.set(change.step_id, existing);
  }

  // Stats
  const acceptedCount = steps
    .filter((s) => !rejectedSteps.has(s.step_id))
    .reduce((sum, s) => sum + (changesByStep.get(s.step_id)?.length || 0), 0);
  const rejectedCount = steps
    .filter((s) => rejectedSteps.has(s.step_id))
    .reduce((sum, s) => sum + (changesByStep.get(s.step_id)?.length || 0), 0);
  const hasRejections = rejectedSteps.size > 0;

  return (
    <div className="mt-3 space-y-3">
      {/* Stats bar */}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 text-sm">
        <div className="flex items-center gap-4">
          <span className="text-gray-600">
            <span className="font-medium text-emerald-600">{formatNumber(acceptedCount)}</span> accepted
          </span>
          {hasRejections && (
            <span className="text-gray-600">
              <span className="font-medium text-red-600">{formatNumber(rejectedCount)}</span> rejected
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasRejections && (
            <button
              onClick={onApplySelected}
              disabled={isApplying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Apply Selected
            </button>
          )}
          {hasRejections && (
            <button
              onClick={onApplyAll}
              disabled={isApplying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Apply All
            </button>
          )}
        </div>
      </div>

      {/* Step groups */}
      <div className="space-y-2">
        {steps.map((step) => {
          const stepChanges = changesByStep.get(step.step_id) || [];
          const rejected = rejectedSteps.has(step.step_id);
          const expanded = expandedStep === step.step_id;
          const Icon = OP_ICONS[step.operation] || Tag;

          return (
            <div
              key={step.step_id}
              className={`rounded-lg border transition-all ${
                rejected ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'
              }`}
            >
              {/* Step header */}
              <div className="flex items-center gap-3 p-3">
                {/* Checkbox */}
                <button
                  onClick={() => onToggleStep(step.step_id)}
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors flex-shrink-0 ${
                    rejected
                      ? 'border-red-300 bg-white'
                      : 'border-primary-500 bg-primary-500'
                  }`}
                >
                  {!rejected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </button>

                {/* Icon + info */}
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 ${
                  rejected ? 'bg-red-100 text-red-500' : 'bg-primary-50 text-primary-600'
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className={`flex-1 min-w-0 ${rejected ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{step.operation}</span>
                    <span className="text-xs text-gray-500">{step.description}</span>
                  </div>
                </div>

                {/* Change count */}
                <span className={`text-xs font-medium flex-shrink-0 ${rejected ? 'text-red-500 line-through' : 'text-gray-500'}`}>
                  {formatNumber(stepChanges.length)} changes
                </span>

                {/* Reject indicator */}
                {rejected && (
                  <span className="badge bg-red-100 text-red-700 text-[10px] flex-shrink-0">rejected</span>
                )}

                {/* Expand button */}
                {stepChanges.length > 0 && (
                  <button
                    onClick={() => setExpandedStep(expanded ? null : step.step_id)}
                    className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                  >
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                )}
              </div>

              {/* Expanded changes */}
              {expanded && stepChanges.length > 0 && (
                <div className="border-t border-gray-100 px-3 pb-3">
                  <div className="mt-2 overflow-x-auto max-h-48 overflow-y-auto rounded border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="border-b border-gray-100 text-left">
                          <th className="px-2 py-1.5 font-medium text-gray-500 w-12">Row</th>
                          <th className="px-2 py-1.5 font-medium text-gray-500 w-20">Column</th>
                          <th className="px-2 py-1.5 font-medium text-gray-500">Before</th>
                          <th className="px-2 py-1.5 font-medium text-gray-500 w-6"></th>
                          <th className="px-2 py-1.5 font-medium text-gray-500">After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {stepChanges.slice(0, 30).map((c, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-2 py-1 font-mono text-gray-400">#{c.row_index + 1}</td>
                            <td className="px-2 py-1 font-mono font-medium text-gray-700">{c.column}</td>
                            <td className="px-2 py-1 font-mono text-red-600 max-w-[120px] truncate">
                              {c.before === null ? 'null' : String(c.before)}
                            </td>
                            <td className="px-2 py-1 text-center text-gray-300">→</td>
                            <td className="px-2 py-1 font-mono text-emerald-600 max-w-[120px] truncate">
                              {c.after === null ? 'null' : String(c.after)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {stepChanges.length > 30 && (
                      <p className="text-center text-[10px] text-gray-400 py-1">
                        Showing 30 of {stepChanges.length} changes
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
