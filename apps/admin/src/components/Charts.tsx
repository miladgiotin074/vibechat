'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtDay, fmtNum } from '@/lib/format';

const GRID = 'rgba(255,255,255,0.06)';
const AXIS = { fill: '#8f7e9c', fontSize: 11, fontFamily: 'inherit' };

function TooltipBox({ active, payload, label, labels }: { active?: boolean; payload?: any[]; label?: string; labels: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 text-muted">{label && /^\d{4}-/.test(label) ? fmtDay(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{labels[p.dataKey] ?? p.dataKey}:</span>
          <span className="font-semibold">{fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({
  data,
  series,
  height = 260,
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  const labels = Object.fromEntries(series.map((s) => [s.key, s.label]));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickFormatter={fmtDay} axisLine={false} tickLine={false} reversed minTickGap={24} />
        <YAxis tick={AXIS} tickFormatter={(v) => fmtNum(v)} axisLine={false} tickLine={false} orientation="right" width={48} />
        <Tooltip content={<TooltipBox labels={labels} />} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, xKey, yKey, label, color = '#ff2d6f', height = 240 }: { data: Record<string, any>[]; xKey: string; yKey: string; label: string; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} reversed />
        <YAxis tick={AXIS} tickFormatter={(v) => fmtNum(v)} axisLine={false} tickLine={false} orientation="right" width={48} />
        <Tooltip content={<TooltipBox labels={{ [yKey]: label }} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey={yKey} fill={color} radius={[8, 8, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220 }: { data: { name: string; value: number; color: string }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-6">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="68%" outerRadius="100%" paddingAngle={3} stroke="none">
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xl font-bold">{fmtNum(total)}</div>
            <div className="text-xs text-muted">کاربر فعال</div>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-muted">{d.name}</span>
            <span className="font-semibold">{fmtNum(d.value)}</span>
            <span className="text-xs text-faint">{total ? `(${fmtNum(Math.round((d.value / total) * 100))}٪)` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
