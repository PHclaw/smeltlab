'use client';

/**
 * 聊天里的训练配置卡。
 *
 * Agent 输出 ```train-config {json} 后由 Markdown 渲染成本组件：
 * 选模型 / 调参 → 后端生成训练脚本并执行 → 进度条 + 实时曲线 → 测试结果与产物。
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Check, Code2, Download, Loader2, Play, RotateCcw } from 'lucide-react';
import {
  createTrainJob,
  getTrainJob,
  trainCodeUrl,
  trainFileUrl,
  type TrainJob,
  type TrainJobResult,
} from '@/lib/api';
import { ChartView, type ChartSpec } from './Chart';

export interface TrainConfigSpec {
  file: string;
  target: string;
  task?: 'classification' | 'regression';
  rows?: number;
  cols?: number;
  group?: string | null;
  drop?: string[];
  positive?: string | null;
  recommended?: { model?: string; test_size?: number };
  note?: string;
}

const MODELS = [
  { key: 'rf', label: '随机森林', hint: '默认，稳' },
  { key: 'gb', label: '梯度提升', hint: '精度好' },
  { key: 'lr', label: '逻辑回归', hint: '可解释' },
  { key: 'mlp', label: '神经网络', hint: '非线性' },
];

interface ParamField {
  key: string;
  label: string;
  kind: 'int' | 'float';
  step: string;
  placeholder?: string;
}

const PARAMS: Record<string, ParamField[]> = {
  rf: [
    { key: 'n_estimators', label: '树的数量', kind: 'int', step: '10', placeholder: '300' },
    { key: 'max_depth', label: '最大深度', kind: 'int', step: '1', placeholder: '不限' },
    { key: 'min_samples_leaf', label: '叶节点最小样本', kind: 'int', step: '1', placeholder: '2' },
  ],
  gb: [
    { key: 'n_estimators', label: '迭代次数', kind: 'int', step: '10', placeholder: '200' },
    { key: 'learning_rate', label: '学习率', kind: 'float', step: '0.01', placeholder: '0.08' },
    { key: 'max_depth', label: '树深度', kind: 'int', step: '1', placeholder: '3' },
  ],
  lr: [
    { key: 'epochs', label: '训练轮数', kind: 'int', step: '5', placeholder: '30' },
    { key: 'alpha', label: '正则强度 alpha', kind: 'float', step: '0.001', placeholder: '0.0001' },
  ],
  mlp: [
    { key: 'epochs', label: '训练轮数', kind: 'int', step: '5', placeholder: '30' },
    { key: 'hidden', label: '隐藏层宽度', kind: 'int', step: '8', placeholder: '32' },
    { key: 'lr', label: '学习率', kind: 'float', step: '0.001', placeholder: '0.01' },
  ],
};

const METRIC_LABELS: Record<string, string> = {
  pr_auc: 'PR-AUC',
  roc_auc: 'ROC-AUC',
  f1: 'F1',
  recall: '召回率',
  precision: '精确率',
  threshold: '判定阈值',
  mae: 'MAE',
  rmse: 'RMSE',
  r2: 'R²',
  val_pr_auc: '验证 PR-AUC',
  val_r2: '验证 R²',
};

/** 把结果摘要交给对话里的 Agent 做解读 */
function askAi(result: TrainJobResult) {
  const metricText = Object.entries(result.metrics)
    .map(([key, value]) => `${METRIC_LABELS[key] || key} ${value}`)
    .join('，');
  const warn = result.warnings?.length ? `注意：${result.warnings.join('；')}。` : '';
  const text =
    `训练完成：${result.model}，${metricText}。` +
    `训练 ${result.rows.train} 行 / 测试 ${result.rows.test} 行，${result.split}。${warn}` +
    '请解读这些结果：能不能用、主要风险是什么、下一步建议。';

  window.dispatchEvent(new CustomEvent('smeltlab:ask', { detail: text }));
}

export function TrainConfigCard({ spec }: { spec: string }) {
  const routeParams = useParams<{ id: string }>();
  const sessionId = String(routeParams?.id || '');

  const config = useMemo<TrainConfigSpec | null>(() => {
    try {
      const parsed = JSON.parse(spec);
      if (!parsed?.file || !parsed?.target) return null;
      return parsed as TrainConfigSpec;
    } catch {
      return null;
    }
  }, [spec]);

  const [model, setModel] = useState(config?.recommended?.model || 'rf');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [testSize, setTestSize] = useState(String(config?.recommended?.test_size ?? 0.25));
  const [job, setJob] = useState<TrainJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 轮询任务进度
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const next = await getTrainJob(job.id);
        if (alive) setJob(next);
      } catch {
        /* 网络抖动忽略，下一轮再试 */
      }
    }, 700);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job]);

  if (!config) {
    return (
      <pre className="my-3 overflow-x-auto rounded-xl bg-gray-50 px-4 py-3 text-[12px] leading-6 text-gray-500">
        <code className="font-mono whitespace-pre">{spec.trim()}</code>
      </pre>
    );
  }

  const isRunning = job?.status === 'running' || job?.status === 'queued';
  const isDone = job?.status === 'done';
  const taskLabel = (config.task || job?.result?.task) === 'regression' ? '回归' : '二分类';

  const handleStart = async () => {
    if (!sessionId) {
      setError('缺少会话信息，无法定位工作区文件');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, number> = {};
      for (const field of PARAMS[model]) {
        const raw = paramValues[field.key];
        if (raw === undefined || raw.trim() === '') continue;
        const value = field.kind === 'int' ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(value)) params[field.key] = value;
      }

      const created = await createTrainJob({
        session_id: sessionId,
        file: config.file,
        target: config.target,
        task: config.task || 'auto',
        model,
        params,
        group: config.group || null,
        drop: config.drop || [],
        test_size: Number(testSize) || 0.25,
      });
      setJob(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动训练失败');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setJob(null);
    setError(null);
  };

  return (
    <section className="my-4 rounded-xl border border-gray-100 bg-white p-4">
      {/* 头部 */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium text-gray-900">
            {isDone ? '训练完成' : isRunning ? '模型训练中' : '训练配置'}
          </h4>
          <p className="mt-0.5 truncate text-[11.5px] text-gray-400">
            {config.file}
            {config.rows ? ` · ${config.rows} 行 × ${config.cols} 列` : ''} · 目标列「{config.target}」 · {taskLabel}
          </p>
        </div>
        {isDone && job?.result && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">
            <Check size={11} />
            {job.result.model} · {job.result.elapsed_seconds}s
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>
      )}

      {/* 配置阶段 */}
      {!job && (
        <>
          <div className="mb-2 text-[12px] text-gray-500">选择模型</div>
          <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {MODELS.map((item) => (
              <button
                key={item.key}
                onClick={() => setModel(item.key)}
                className={`rounded-lg border px-2 py-1.5 text-left transition ${
                  model === item.key
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="block text-[12px] font-medium">{item.label}</span>
                <span
                  className={`block text-[10.5px] ${
                    model === item.key ? 'text-gray-300' : 'text-gray-400'
                  }`}
                >
                  {item.hint}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PARAMS[model].map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-[11px] text-gray-400">{field.label}</span>
                <input
                  type="number"
                  step={field.step}
                  value={paramValues[field.key] ?? ''}
                  onChange={(e) =>
                    setParamValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-[12px] text-gray-900 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-[11px] text-gray-400">测试集比例</span>
              <select
                value={testSize}
                onChange={(e) => setTestSize(e.target.value)}
                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-[12px] text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="0.2">20%</option>
                <option value="0.25">25%</option>
                <option value="0.3">30%</option>
              </select>
            </label>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
            {config.group && <span>按「{config.group}」分组切分</span>}
            {config.drop && config.drop.length > 0 && <span>剔除 {config.drop.length} 列</span>}
            {config.note && <span>{config.note}</span>}
          </div>

          <button
            onClick={handleStart}
            disabled={submitting}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {submitting ? '生成代码…' : '开始训练'}
          </button>
          <p className="mt-2 text-[11px] text-gray-300">
            会根据数据集结构自动生成训练脚本，执行后展示进度与测试结果
          </p>
        </>
      )}

      {/* 训练中 */}
      {isRunning && job && (
        <div>
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5 text-gray-600">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gray-900" />
              <span className="truncate">{job.stage}</span>
            </span>
            <span className="shrink-0 tabular-nums text-gray-400">{job.pct}%</span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gray-900 transition-all duration-500 ease-out"
              style={{ width: `${job.pct}%` }}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
            <span>已用时 {job.elapsed}s</span>
            {job.result?.rows ? (
              <span>
                训练 {job.result.rows.train} 行 · 测试 {job.result.rows.test} 行
              </span>
            ) : null}
            {Object.entries(job.metrics)
              .filter(([key]) => key.startsWith('val_'))
              .map(([key, value]) => (
                <span key={key} className="tabular-nums text-gray-600">
                  {METRIC_LABELS[key] || key} {Number(value).toFixed(3)}
                </span>
              ))}
          </div>

          {job.history.length > 1 && <MiniCurve points={job.history.map((p) => p[1])} />}

          {job.logs.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-gray-400 hover:text-gray-600">
                查看运行日志（{job.logs.length}）
              </summary>
              <pre className="mt-1.5 max-h-32 overflow-auto rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-[10.5px] leading-5 text-gray-500">
                {job.logs.slice(-12).join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* 训练失败 */}
      {job?.status === 'error' && (
        <div>
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
            {job.error || '训练失败'}
          </p>
          <button
            onClick={reset}
            className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-600 transition hover:bg-gray-50"
          >
            <RotateCcw size={13} />
            重新配置
          </button>
        </div>
      )}

      {/* 训练结果 */}
      {isDone && job?.result && <TrainResult job={job} onReset={reset} />}
    </section>
  );
}

/* --------------------------------------------------------------- 实时曲线 */

function MiniCurve({ points }: { points: number[] }) {
  const width = 320;
  const height = 40;
  const max = Math.max(...points, 0.0001);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const path = points
    .map((value, idx) => `${idx === 0 ? 'M' : 'L'}${(step * idx).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-10 w-full">
      <path d={path} fill="none" stroke="#111827" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- 结果展示 */

function TrainResult({ job, onReset }: { job: TrainJob; onReset: () => void }) {
  const result = job.result!;
  const metrics = Object.entries(result.metrics).filter(([key]) => key !== 'threshold');
  const charts = result.charts as Record<string, ChartSpec>;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map(([key, value]) => (
          <div key={key} className="rounded-lg bg-gray-50 px-2.5 py-2">
            <div className="text-[10.5px] text-gray-400">{METRIC_LABELS[key] || key}</div>
            <div className="text-[15px] font-semibold tabular-nums text-gray-900">
              {typeof value === 'number' ? value.toFixed(value >= 10 ? 1 : 3) : value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <span>{result.split}</span>
        <span>
          训练 {result.rows.train} / 测试 {result.rows.test} 行
        </span>
        <span>{result.features} 个特征</span>
        {typeof result.metrics.threshold === 'number' && (
          <span>判定阈值 {result.metrics.threshold}</span>
        )}
      </div>

      {charts.roc && charts.pr && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <ChartView spec={charts.roc} />
          <ChartView spec={charts.pr} />
        </div>
      )}
      {charts.confusion && <ChartView spec={charts.confusion} />}
      {charts.residual && <ChartView spec={charts.residual} />}
      {charts.importance && <ChartView spec={charts.importance} />}

      {result.warnings && result.warnings.length > 0 && (
        <div className="my-3 rounded-lg bg-amber-50 px-3 py-2">
          {result.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-amber-700">
              <AlertTriangle size={12} className="mt-1 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {result.artifacts?.model && (
          <a
            href={trainFileUrl(job.id, result.artifacts.model)}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-[11.5px] text-gray-600 transition hover:bg-gray-50"
          >
            <Download size={12} />
            模型文件
          </a>
        )}
        {result.artifacts?.predictions && (
          <a
            href={trainFileUrl(job.id, result.artifacts.predictions)}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-[11.5px] text-gray-600 transition hover:bg-gray-50"
          >
            <Download size={12} />
            预测结果
          </a>
        )}
        <a
          href={trainCodeUrl(job.id)}
          target="_blank"
          rel="noreferrer"
          className="flex h-7 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-[11.5px] text-gray-600 transition hover:bg-gray-50"
        >
          <Code2 size={12} />
          训练代码
        </a>
        <button
          onClick={() => askAi(result)}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 text-[11.5px] font-medium text-white transition hover:bg-gray-700"
        >
          让 AI 解读结果
        </button>
        <button
          onClick={onReset}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
        >
          <RotateCcw size={12} />
          换个模型再训
        </button>
      </div>
    </div>
  );
}

export default TrainConfigCard;
