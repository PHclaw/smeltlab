'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface HistogramBin {
  bin: string;
  count: number;
}

interface TopValue {
  value: string;
  count: number;
}

interface ColumnChartProps {
  type: 'histogram' | 'top_values';
  data: HistogramBin[] | TopValue[];
  color?: string;
  height?: number;
}

const COLORS = [
  '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff',
  '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b',
];

export function ColumnChart({ type, data, color = '#6366f1', height = 140 }: ColumnChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[140px] text-xs text-gray-400">
        No data
      </div>
    );
  }

  if (type === 'histogram') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="bin"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            formatter={(value: number) => [value, 'Count']}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={color} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Top values — horizontal bars
  const sorted = [...data].slice(0, 8);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="value"
          width={70}
          tick={{ fontSize: 10, fill: '#6b7280' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: string) => v.length > 10 ? v.slice(0, 10) + '...' : v}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
          formatter={(value: number) => [value, 'Count']}
        />
        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
          {sorted.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} opacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
