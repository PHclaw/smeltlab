'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2,
  Info, ArrowRight, Sparkles, ChevronDown, ChevronUp, Hash, Type,
  Calendar, Mail, Phone, Globe, ToggleLeft, BarChart3,
} from 'lucide-react';
import { uploadFile, getProfile, type ProfileResponse, type ColumnProfile } from '@/lib/api';
import { formatNumber, formatBytes, getHealthBg, getSeverityBadge } from '@/lib/utils';
import { ColumnChart } from '@/components/ColumnChart';

const TYPE_ICONS: Record<string, typeof Hash> = {
  integer: Hash, float: Hash, string: Type, boolean: ToggleLeft,
  date: Calendar, datetime: Calendar, email: Mail, phone: Phone, url: Globe,
};

const TYPE_COLORS: Record<string, string> = {
  integer: 'bg-blue-100 text-blue-700',
  float: 'bg-blue-100 text-blue-700',
  string: 'bg-gray-100 text-gray-700',
  boolean: 'bg-purple-100 text-purple-700',
  date: 'bg-amber-100 text-amber-700',
  datetime: 'bg-amber-100 text-amber-700',
  email: 'bg-emerald-100 text-emerald-700',
  phone: 'bg-emerald-100 text-emerald-700',
  url: 'bg-cyan-100 text-cyan-700',
};

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [expandedCol, setExpandedCol] = useState<string | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setError(null);
      setProfile(null);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
      setProfile(null);
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadResult = await uploadFile(file);
      setDatasetId(uploadResult.id);
      const profileData = await getProfile(uploadResult.id);
      setProfile(profileData);
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleStartCleaning = () => {
    if (datasetId) {
      router.push(`/clean/${datasetId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">DataCleanr</span>
          </div>
          <span className="text-sm text-gray-500">Step 1: Upload & Profile</span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Upload area */}
        {!profile && (
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">Upload your dataset</h1>
            <p className="mt-2 text-gray-600">Drop a file and get an instant AI-powered health report</p>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className={`mt-8 rounded-2xl border-2 border-dashed p-12 transition-colors ${
                file
                  ? 'border-primary-400 bg-primary-50'
                  : 'border-gray-300 bg-white hover:border-primary-400 hover:bg-primary-50'
              }`}
            >
              {file ? (
                <div className="flex flex-col items-center">
                  <FileSpreadsheet className="h-12 w-12 text-primary-500" />
                  <p className="mt-4 text-lg font-medium text-gray-900">{file.name}</p>
                  <p className="mt-1 text-sm text-gray-500">{formatBytes(file.size)}</p>
                  <button onClick={() => { setFile(null); setError(null); }} className="mt-4 text-sm text-gray-500 hover:text-gray-700">
                    Choose a different file
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="h-12 w-12 text-gray-400" />
                  <p className="mt-4 text-lg font-medium text-gray-700">Drag & drop your file here</p>
                  <p className="mt-1 text-sm text-gray-500">or click to browse</p>
                  <p className="mt-3 text-xs text-gray-400">CSV, JSON, JSONL, Excel, Parquet — up to 100MB</p>
                  <input
                    type="file"
                    accept=".csv,.json,.jsonl,.ndjson,.xlsx,.xls,.parquet"
                    onChange={handleFileSelect}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    style={{ position: 'relative' }}
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {file && !uploading && (
              <button onClick={handleUpload} className="btn-primary mt-8 text-base px-8 py-3">
                <Sparkles className="mr-2 h-5 w-5" />
                Analyze & Profile Data
              </button>
            )}

            {uploading && (
              <div className="mt-8 flex items-center justify-center gap-3 text-gray-600">
                <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
                <span>Analyzing your data with AI...</span>
              </div>
            )}
          </div>
        )}

        {/* Profile Results */}
        {profile && (
          <div className="space-y-6">
            {/* Health Score + Quick Stats */}
            <div className="card">
              <div className="flex items-start gap-8">
                {/* Gauge */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <HealthGauge score={profile.health_score} size={120} />
                  <p className="mt-2 text-sm font-medium text-gray-600">Health Score</p>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-900">Data Health Report</h2>
                  <p className="mt-1 text-sm text-gray-500 truncate">
                    {file?.name} — {formatBytes(profile.file_size_bytes)}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Rows" value={formatNumber(profile.total_rows)} />
                    <StatCard label="Columns" value={String(profile.total_columns)} />
                    <StatCard label="Duplicates" value={`${profile.duplicate_pct}%`} highlight={profile.duplicate_pct > 5} />
                    <StatCard label="Issues" value={String(profile.issues.length)} highlight={profile.issues.length > 3} />
                  </div>
                </div>
              </div>
            </div>

            {/* Issues */}
            {profile.issues.length > 0 && (
              <div className="card">
                <h3 className="mb-4 text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Issues Found ({profile.issues.length})
                </h3>
                <div className="space-y-2">
                  {profile.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
                      {issue.severity === 'critical' ? (
                        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-100 flex-shrink-0">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                        </div>
                      ) : issue.severity === 'warning' ? (
                        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 flex-shrink-0">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        </div>
                      ) : (
                        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
                          <Info className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={getSeverityBadge(issue.severity)}>{issue.severity}</span>
                          <span className="text-xs text-gray-400">{issue.category}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{issue.message}</p>
                        {issue.suggestion && (
                          <p className="mt-1 text-xs text-gray-500">💡 {issue.suggestion}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Column Cards Grid */}
            <div>
              <h3 className="mb-4 text-lg font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary-500" />
                Column Details ({profile.columns.length})
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {profile.columns.map((col) => (
                  <ColumnCard
                    key={col.name}
                    column={col}
                    totalRows={profile.total_rows}
                    expanded={expandedCol === col.name}
                    onToggle={() => setExpandedCol(expandedCol === col.name ? null : col.name)}
                  />
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="text-center py-4">
              <button onClick={handleStartCleaning} className="btn-primary text-base px-8 py-3">
                Start Cleaning
                <ArrowRight className="ml-2 h-5 w-5" />
              </button>
              <p className="mt-3 text-sm text-gray-500">
                Describe what you want to clean in plain English, or use preset actions
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health Gauge
// ---------------------------------------------------------------------------

function HealthGauge({ score, size = 120 }: { score: number; size?: number }) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-gray-400 -mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column Card
// ---------------------------------------------------------------------------

function ColumnCard({
  column, totalRows, expanded, onToggle,
}: {
  column: ColumnProfile;
  totalRows: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = TYPE_ICONS[column.inferred_type] || Type;
  const typeColor = TYPE_COLORS[column.inferred_type] || 'bg-gray-100 text-gray-700';
  const hasIssues = column.issues.length > 0;

  const histogram = column.stats?.histogram as { bin: string; count: number }[] | undefined;
  const topValues = column.stats?.top_values as { value: string; count: number }[] | undefined;
  const hasChart = (histogram && histogram.length > 0) || (topValues && topValues.length > 0);

  return (
    <div className={`rounded-xl border bg-white transition-shadow ${hasIssues ? 'border-amber-200' : 'border-gray-200'} ${expanded ? 'shadow-md' : 'shadow-sm hover:shadow-md'}`}>
      {/* Header */}
      <button onClick={onToggle} className="w-full text-left p-4 flex items-start gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${typeColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-gray-900 truncate">{column.name}</span>
            {hasIssues && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-700 flex-shrink-0">
                {column.issues.length}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <span className="badge bg-gray-100 text-gray-600 text-[10px] py-0">{column.inferred_type}</span>
            <span>{column.unique_count} unique</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />}
      </button>

      {/* Missing bar */}
      {column.null_pct > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={`font-medium ${column.null_pct > 20 ? 'text-red-600' : column.null_pct > 5 ? 'text-amber-600' : 'text-gray-500'}`}>
              {column.null_pct}% null
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${column.null_pct > 20 ? 'bg-red-400' : column.null_pct > 5 ? 'bg-amber-400' : 'bg-gray-300'}`}
                style={{ width: `${Math.min(column.null_pct, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {hasChart && !expanded && (
        <div className="px-4 pb-3">
          {histogram && histogram.length > 0 ? (
            <ColumnChart type="histogram" data={histogram} height={100} />
          ) : topValues && topValues.length > 0 ? (
            <ColumnChart type="top_values" data={topValues} height={100} />
          ) : null}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {/* Chart */}
          {hasChart && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Distribution</p>
              {histogram && histogram.length > 0 ? (
                <ColumnChart type="histogram" data={histogram} height={130} />
              ) : topValues && topValues.length > 0 ? (
                <ColumnChart type="top_values" data={topValues} height={130} />
              ) : null}
            </div>
          )}

          {/* Numeric stats */}
          {(column.inferred_type === 'integer' || column.inferred_type === 'float') && column.stats && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Statistics</p>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {column.stats.min != null && <StatPill label="Min" value={String(column.stats.min)} />}
                {column.stats.max != null && <StatPill label="Max" value={String(column.stats.max)} />}
                {column.stats.mean != null && <StatPill label="Mean" value={String(column.stats.mean)} />}
                {column.stats.median != null && <StatPill label="Median" value={String(column.stats.median)} />}
                {column.stats.std != null && <StatPill label="Std Dev" value={String(column.stats.std)} />}
                {column.stats.outlier_count != null && (
                  <StatPill label="Outliers" value={String(column.stats.outlier_count)} highlight />
                )}
              </div>
            </div>
          )}

          {/* Sample values */}
          {column.sample_values.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Sample Values</p>
              <div className="flex flex-wrap gap-1">
                {column.sample_values.map((v, i) => (
                  <span key={i} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-600 max-w-[150px] truncate">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Issues */}
          {column.issues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Issues</p>
              {column.issues.map((issue, i) => (
                <p key={i} className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  {issue}
                </p>
              ))}
            </div>
          )}

          {/* Completeness */}
          <div className="text-xs text-gray-400">
            {formatNumber(column.null_count)} nulls · {formatNumber(column.unique_count)} unique ({column.unique_pct}%)
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-center">
      <div className={`text-xl font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

function StatPill({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded bg-gray-50 px-2 py-1">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono font-medium ${highlight ? 'text-red-600' : 'text-gray-700'}`}>{value}</span>
    </div>
  );
}
