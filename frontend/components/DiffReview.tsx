'use client';

import { useState } from 'react';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
  RotateCcw, Shield, Calendar, Filter, Type, Tag, Check,
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

import { OP_LABELS } from '@/lib/op-labels';

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

  // 按步骤聚合变更明细
  const changesByStep = new Map<string, ChangeRecord[]>();
  for (const change of changes) {
    const existing = changesByStep.get(change.step_id) || [];
    existing.push(change);
    changesByStep.set(change.step_id, existing);
  }

  const acceptedCount = steps
    .filter((s) => !rejectedSteps.has(s.step_id))
    .reduce((sum, s) => sum + (changesByStep.get(s.step_id)?.length || 0), 0);
  const rejectedCount = steps
    .filter((s) => rejectedSteps.has(s.step_id))
    .reduce((sum, s) => sum + (changesByStep.get(s.step_id)?.length || 0), 0);
  const hasRejections = rejectedSteps.size > 0;

  return (
    <div className="mt-3 space-y-2.5">
      {/* 汇总条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-4 text-[12.5px] text-gray-500">
          <span>
            <span className="font-semibold text-emerald-600">{formatNumber(acceptedCount)}</span> 条生效
          </span>
          {hasRejections && (
            <span>
              <span className="font-semibold text-red-500">{formatNumber(rejectedCount)}</span> 条被拒
            </span>
          )}
        </div>
        {hasRejections && (
          <div className="flex gap-2">
            <button onClick={onApplySelected} disabled={isApplying} className="btn-quiet h-8 px-3">
              <CheckCircle2 size={13} />
              应用已选
            </button>
            <button onClick={onApplyAll} disabled={isApplying} className="btn-solid h-8 px-3">
              全部应用
            </button>
          </div>
        )}
      </div>

      {/* 步骤分组 */}
      <div className="space-y-2">
        {steps.map((step) => {
          const stepChanges = changesByStep.get(step.step_id) || [];
          const rejected = rejectedSteps.has(step.step_id);
          const expanded = expandedStep === step.step_id;
          const Icon = OP_ICONS[step.operation] || Tag;

          return (
            <div
              key={step.step_id}
              className={`overflow-hidden rounded-xl border transition ${
                rejected ? 'border-gray-100 bg-gray-50/60' : 'border-gray-100 bg-white'
              }`}
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  onClick={() => onToggleStep(step.step_id)}
                  aria-label={rejected ? '恢复该步骤' : '拒收该步骤'}
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
                    rejected
                      ? 'border-gray-300 bg-white text-transparent hover:border-gray-400'
                      : 'border-gray-900 bg-gray-900 text-white'
                  }`}
                >
                  <Check size={12} strokeWidth={3} />
                </button>

                <div
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                    rejected ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  <Icon size={14} />
                </div>

                <div className={`min-w-0 flex-1 ${rejected ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-gray-900">
                      {OP_LABELS[step.operation] || step.operation}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-gray-400">{step.description}</p>
                </div>

                <span
                  className={`shrink-0 text-[11.5px] ${
                    rejected ? 'text-gray-400 line-through' : 'text-gray-500'
                  }`}
                >
                  {formatNumber(stepChanges.length)} 处
                </span>

                {rejected && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] text-gray-500">
                    已拒收
                  </span>
                )}

                {stepChanges.length > 0 && (
                  <button
                    onClick={() => setExpandedStep(expanded ? null : step.step_id)}
                    aria-label={expanded ? '收起明细' : '展开明细'}
                    className="shrink-0 rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>

              {expanded && stepChanges.length > 0 && (
                <div className="border-t border-gray-100 px-3 pb-3">
                  <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-100">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-left text-gray-500">
                          <th className="w-12 px-2 py-1.5 font-medium">行</th>
                          <th className="w-24 px-2 py-1.5 font-medium">列</th>
                          <th className="px-2 py-1.5 font-medium">修改前</th>
                          <th className="w-6 px-2 py-1.5"></th>
                          <th className="px-2 py-1.5 font-medium">修改后</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {stepChanges.slice(0, 30).map((c, i) => (
                          <tr key={i} className="transition hover:bg-gray-50">
                            <td className="px-2 py-1 font-mono text-gray-400">#{c.row_index + 1}</td>
                            <td className="max-w-[120px] truncate px-2 py-1 font-mono text-gray-700">
                              {c.column}
                            </td>
                            <td className="max-w-[140px] truncate px-2 py-1 font-mono text-red-500">
                              {c.before === null ? 'null' : String(c.before)}
                            </td>
                            <td className="px-2 py-1 text-center text-gray-300">→</td>
                            <td className="max-w-[140px] truncate px-2 py-1 font-mono text-emerald-600">
                              {c.after === null ? 'null' : String(c.after)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {stepChanges.length > 30 && (
                      <p className="py-1 text-center text-[10.5px] text-gray-400">
                        仅显示前 30 条，共 {stepChanges.length} 条
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
