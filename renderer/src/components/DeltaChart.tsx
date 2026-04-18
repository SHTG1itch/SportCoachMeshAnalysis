interface Props {
  timeline: number[]; // similarity values 0..1 per frame
  height?: number;
}

/**
 * SVG similarity ribbon. No deps. Colors by value band.
 */
export function DeltaChart({ timeline, height = 72 }: Props) {
  const n = timeline.length;
  if (n < 2) {
    return (
      <div className="h-[72px] flex items-center justify-center text-xs text-ink-400">
        Not enough data for timeline
      </div>
    );
  }
  const width = 600;
  const stepX = width / (n - 1);

  const pathD = timeline
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${((1 - v) * (height - 8) + 4).toFixed(2)}`)
    .join(" ");

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[72px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="similarity-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a8ffd" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#4a8ffd" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#similarity-grad)" />
      <path d={pathD} fill="none" stroke="#7ab6ff" strokeWidth="2" />
      {/* Reference lines */}
      {[0.25, 0.5, 0.75].map((v) => (
        <line
          key={v}
          x1={0}
          x2={width}
          y1={(1 - v) * (height - 8) + 4}
          y2={(1 - v) * (height - 8) + 4}
          stroke="#ffffff"
          strokeOpacity={0.06}
          strokeDasharray="3 6"
        />
      ))}
    </svg>
  );
}
