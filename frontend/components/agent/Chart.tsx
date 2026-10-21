'use client';

/**
 * Markdown 里 ```chart 代码块的可视化渲染。
 *
 * 支持两种 JSON：
 * 1. 单序列（条形 / 折线 / 环形）
 *    {"type":"bar|line|pie","title":"...","unit":"%","data":[{"label":"缺失值","value":18.2}]}
 * 2. 多序列与矩阵（ROC / PR / 混淆矩阵）
 *    {"type":"line","title":"ROC","series":[{"name":"逻辑回归","data":[[0,0],[0.1,0.7],[1,1]]}]}
 *    {"type":"heatmap","title":"混淆矩阵","labels":["实际 否","实际 是"],"columns":["预测 否","预测 是"],"matrix":[[90,3],[8,20]]}
 */

const PALETTE = ['#111827', '#4B5563', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB'];

interface ChartPoint {
  label: string;
  value: number;
}

interface ChartSeries {
  name: string;
  data: number[][];
}

export interface ChartSpec {
  type?: string;
  title?: string;
  unit?: string;
  data?: ChartPoint[];
  series?: ChartSeries[];
  labels?: string[];
  columns?: string[];
  matrix?: number[][];
}

function parseSpec(raw: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(raw) as ChartSpec;
    if (!parsed || typeof parsed !== 'object') return null;

    if (Array.isArray(parsed.matrix)) return parsed;

    if (Array.isArray(parsed.series)) {
      const series = parsed.series
        .map((s) => ({
          name: String(s?.name ?? ''),
          data: Array.isArray(s?.data)
            ? s.data
                .map((pair) => [Number(pair?.[0] ?? 0), Number(pair?.[1] ?? 0)])
                .filter((pair) => pair.every((n) => Number.isFinite(n)))
            : [],
        }))
        .filter((s) => s.data.length > 0);
      return series.length ? { ...parsed, series } : null;
    }

    if (!Array.isArray(parsed.data)) return null;
    const data = parsed.data
      .map((d) => {
        const item = d as unknown as Record<string, unknown>;
        const label = String(item.label ?? item.name ?? '');
        const value = Number(item.value ?? item.count ?? 0);
        return { label, value: Number.isFinite(value) ? value : 0 };
      })
      .filter((d) => d.label);
    return data.length ? { ...parsed, data } : null;
  } catch {
    return null;
  }
}

function formatValue(value: number, unit?: string) {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${unit || ''}`;
}

export function Chart({ spec }: { spec: string }) {
  const parsed = parseSpec(spec);

  if (!parsed) {
    return (
      <pre className="my-3 overflow-x-auto rounded-xl bg-gray-50 px-4 py-3 text-[12px] leading-6 text-gray-500">
        <code className="font-mono whitespace-pre">{spec.trim()}</code>
      </pre>
    );
  }

  return <ChartView spec={parsed} />;
}

/** 直接接收对象 spec，供训练结果卡等处复用 */
export function ChartView({ spec }: { spec: ChartSpec }) {
  const { type = 'bar', title, unit } = spec;

  return (
    <figure className="my-4 rounded-xl border border-gray-100 p-3.5">
      {title && <figcaption className="mb-3 text-[12.5px] font-medium text-gray-700">{title}</figcaption>}

      {type === 'heatmap' && spec.matrix ? (
        <Heatmap spec={spec} />
      ) : spec.series ? (
        <MultiLineChart series={spec.series} unit={unit} />
      ) : type === 'line' && spec.data ? (
        <LineChart data={spec.data} unit={unit} />
      ) : type === 'pie' && spec.data ? (
        <PieChart data={spec.data} unit={unit} />
      ) : spec.data ? (
        <BarChart data={spec.data} unit={unit} />
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ 条形图 */

function BarChart({ data, unit }: { data: ChartPoint[]; unit?: string }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <div className="space-y-2">
      {data.map((point, idx) => {
        const width = Math.max((Math.abs(point.value) / max) * 100, point.value === 0 ? 0 : 2);
        return (
          <div key={`${point.label}-${idx}`} className="flex items-center gap-2.5">
            <span className="w-[104px] shrink-0 truncate text-[11.5px] text-gray-500" title={point.label}>
              {point.label}
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-50">
              <span
                className="block h-full rounded-full"
                style={{ width: `${width}%`, backgroundColor: PALETTE[idx % PALETTE.length] }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-[11.5px] tabular-nums text-gray-600">
              {formatValue(point.value, unit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- 单序列折线 */

function LineChart({ data, unit }: { data: ChartPoint[]; unit?: string }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const width = 520;
  const height = 140;
  const padX = 8;
  const padY = 12;
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padX + step * i;
    const y = height - padY - (Math.abs(d.value) / max) * (height - padY * 2);
    return { ...d, x, y };
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 18}`} className="h-[170px] w-full min-w-[420px]">
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={width - padX}
            y1={padY + ratio * (height - padY * 2)}
            y2={padY + ratio * (height - padY * 2)}
            stroke="#F3F4F6"
            strokeWidth={1}
          />
        ))}
        <polyline
          fill="none"
          stroke="#111827"
          strokeWidth={1.6}
          strokeLinejoin="round"
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        />
        {points.map((p, i) => (
          <circle key={`${p.label}-${i}`} cx={p.x} cy={p.y} r={2.2} fill="#111827">
            <title>{`${p.label}：${formatValue(p.value, unit)}`}</title>
          </circle>
        ))}
        {points.map((p, i) => (
          <text
            key={`label-${i}`}
            x={p.x}
            y={height + 10}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="fill-gray-400"
            fontSize={9.5}
          >
            {p.label.length > 8 ? `${p.label.slice(0, 8)}…` : p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------- 多序列折线 */

function MultiLineChart({ series, unit }: { series: ChartSeries[]; unit?: string }) {
  const allPoints = series.flatMap((s) => s.data);
  const xMax = Math.max(...allPoints.map((p) => p[0]), 1);
  const xMin = Math.min(...allPoints.map((p) => p[0]), 0);
  const yMax = Math.max(...allPoints.map((p) => p[1]), 1);
  const yMin = Math.min(...allPoints.map((p) => p[1]), 0);
  const width = 520;
  const height = 160;
  const padL = 26;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const spanX = xMax - xMin || 1;
  const spanY = yMax - yMin || 1;

  const mapX = (x: number) => padL + ((x - xMin) / spanX) * (width - padL - padR);
  const mapY = (y: number) => height - padB - ((y - yMin) / spanY) * (height - padT - padB);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[185px] w-full min-w-[420px]">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padT + ratio * (height - padT - padB);
            const label = (yMax - ratio * spanY).toFixed(2);
            return (
              <g key={ratio}>
                <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#F3F4F6" strokeWidth={1} />
                <text x={padL - 5} y={y + 3} textAnchor="end" fontSize={8.5} className="fill-gray-300">
                  {label}
                </text>
              </g>
            );
          })}
          <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="#E5E7EB" />
          {series.map((s, idx) => (
            <polyline
              key={s.name || idx}
              fill="none"
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={1.6}
              strokeLinejoin="round"
              points={s.data.map((p) => `${mapX(p[0])},${mapY(p[1])}`).join(' ')}
            />
          ))}
          <text x={width - padR} y={height - 4} textAnchor="end" fontSize={8.5} className="fill-gray-300">
            {xMax.toFixed(2)}
          </text>
          <text x={padL} y={height - 4} textAnchor="start" fontSize={8.5} className="fill-gray-300">
            {xMin.toFixed(2)}
          </text>
        </svg>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s, idx) => (
          <li key={`legend-${s.name}-${idx}`} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span
              className="h-1.5 w-3 rounded-full"
              style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
            />
            {s.name}
            {unit ? `（${unit}）` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ 热力图 */

function Heatmap({ spec }: { spec: ChartSpec }) {
  const matrix = spec.matrix || [];
  const labels = spec.labels || matrix.map((_, i) => `行 ${i + 1}`);
  const columns = spec.columns || (matrix[0] || []).map((_, i) => `列 ${i + 1}`);
  const max = Math.max(...matrix.flat().map((v) => Math.abs(Number(v) || 0)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[11.5px]">
        <thead>
          <tr>
            <th />
            {columns.map((col) => (
              <th key={col} className="px-1 pb-1 text-center font-normal text-gray-400">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rIdx) => (
            <tr key={`row-${rIdx}`}>
              <th className="whitespace-nowrap pr-2 text-right font-normal text-gray-400">
                {labels[rIdx] || `行 ${rIdx + 1}`}
              </th>
              {row.map((cell, cIdx) => {
                const value = Number(cell) || 0;
                const intensity = Math.min(Math.abs(value) / max, 1);
                const background = `rgba(17, 24, 39, ${0.06 + intensity * 0.84})`;
                return (
                  <td
                    key={`cell-${rIdx}-${cIdx}`}
                    className="h-11 min-w-[64px] rounded-md text-center font-medium tabular-nums"
                    style={{ backgroundColor: background, color: intensity > 0.55 ? '#FFFFFF' : '#374151' }}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ 环形图 */

function PieChart({ data, unit }: { data: ChartPoint[]; unit?: string }) {
  const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-[120px] w-[120px] shrink-0">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#F3F4F6" strokeWidth={14} />
        {data.map((point, idx) => {
          const ratio = Math.abs(point.value) / total;
          const dash = ratio * circumference;
          const element = (
            <circle
              key={`${point.label}-${idx}`}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={14}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            >
              <title>{`${point.label}：${formatValue(point.value, unit)}`}</title>
            </circle>
          );
          offset += dash;
          return element;
        })}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((point, idx) => (
          <li key={`${point.label}-legend-${idx}`} className="flex items-center gap-2 text-[11.5px] text-gray-600">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
            />
            <span className="truncate">{point.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-gray-500">
              {formatValue(point.value, unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Chart;
