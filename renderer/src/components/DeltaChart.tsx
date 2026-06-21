interface Props {
  timeline: number[]; // similarity values 0..1 per aligned frame
  height?: number;
}

/**
 * Similarity ribbon over the motion: how closely your pose matched the pro at
 * each aligned frame. Now labelled (y-axis = similarity %, x-axis = motion
 * progress) so a dip is readable as "you diverged here" rather than being purely
 * decorative.
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
  const yFor = (v: number) => (1 - v) * (height - 8) + 4;

  const pathD = timeline
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${yFor(v).toFixed(2)}`)
    .join(" ");

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div>
      <div className="relative pl-7">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[72px]"
          preserveAspectRatio="none"
          role="img"
          aria-label="Per-frame similarity to the pro across the motion"
        >
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
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#ffffff"
              strokeOpacity={0.06}
              strokeDasharray="3 6"
            />
          ))}
        </svg>
        {/* Y-axis labels (HTML so they don't distort under preserveAspectRatio="none"). */}
        {[1, 0.5, 0].map((v) => (
          <span
            key={v}
            className="absolute left-0 text-[9px] text-ink-500 tabular-nums -translate-y-1/2"
            style={{ top: (yFor(v) / height) * 100 + "%" }}
          >
            {Math.round(v * 100)}%
          </span>
        ))}
      </div>
      <div className="pl-7 flex justify-between text-[10px] text-ink-500 mt-1">
        <span>start of motion</span>
        <span className="text-ink-400">similarity to pro</span>
        <span>finish</span>
      </div>
    </div>
  );
}
