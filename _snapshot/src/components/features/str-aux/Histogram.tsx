'use client';

import React, { useId } from 'react';

type HistogramProps = {
  counts?: number[];
  height?: number;
  nuclei?: number[];
  className?: string;
  accent?: 'emerald' | 'cyan' | 'violet' | 'silver';
};

const ACCENTS: Record<string, { base: string; soft: string; grid: string }> = {
  emerald: { base: '#34d399', soft: 'rgba(52, 211, 153, 0.2)', grid: 'rgba(52, 211, 153, 0.08)' },
  cyan: { base: '#22d3ee', soft: 'rgba(34, 211, 238, 0.2)', grid: 'rgba(34, 211, 238, 0.08)' },
  violet: { base: '#a855f7', soft: 'rgba(168, 85, 247, 0.2)', grid: 'rgba(168, 85, 247, 0.08)' },
  silver: { base: '#e5e7eb', soft: 'rgba(229, 231, 235, 0.2)', grid: 'rgba(229, 231, 235, 0.08)' },
};

export default function Histogram({
  counts = [],
  height = 72,
  nuclei = [],
  className,
  accent = 'emerald',
}: HistogramProps) {
  const data = counts.filter((v) => Number.isFinite(v));
  if (!data.length) {
    return <div className="text-xs cp-subtle">No histogram data</div>;
  }

  const width = Math.max(160, data.length * 8);
  const max = data.reduce((m, x) => (x > m ? x : m), 0) || 1;
  const barWidth = width / data.length;
  const marks = new Set(nuclei ?? []);
  const accentPalette = ACCENTS[accent] ?? ACCENTS.emerald;
  const rawId = useId().replace(/[:]/g, '');
  const gradientId = `hist-${rawId}`;

  return (
    <div className={['relative w-full', className].filter(Boolean).join(' ')}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="return distribution histogram"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accentPalette.base} stopOpacity={0.65} />
            <stop offset="100%" stopColor={accentPalette.soft} stopOpacity={0.05} />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={width} height={height} fill="rgba(15, 20, 30, 0.55)" />

        {/* horizontal grid */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={0}
            x2={width}
            y1={height * pct}
            y2={height * pct}
            stroke={accentPalette.grid}
            strokeWidth={1}
          />
        ))}

        {data.map((value, idx) => {
          const barHeight = Math.max(1, (value / max) * (height - 6));
          const x = idx * barWidth;
          const y = height - barHeight - 2;
          const isMarked = marks.has(idx);

          return (
            <g key={idx}>
              <rect
                x={x + 0.6}
                y={y}
                width={Math.max(1, barWidth - 1.2)}
                height={barHeight}
                fill={`url(#${gradientId})`}
                opacity={0.9}
              />
              {isMarked && (
                <rect
                  x={x + 0.6}
                  y={y}
                  width={Math.max(1, barWidth - 1.2)}
                  height={barHeight}
                  fill="none"
                  stroke={accentPalette.base}
                  strokeWidth={1.5}
                  opacity={0.9}
                />
              )}
            </g>
          );
        })}

        <line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke={accentPalette.base} strokeOpacity={0.35} strokeWidth={1} />
      </svg>
    </div>
  );
}
