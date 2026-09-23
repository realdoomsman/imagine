import { COLORS } from "./theme";

/**
 * The same vise mechanism the site draws, as SVG so it stays crisp at 4K.
 *
 * `grip` (0..1) closes the jaws and heats the block. Every frame is a pure
 * function of grip — no randomness, so a re-render is byte-identical.
 */
export function Vise({
  grip,
  width = 900,
  showScrew = true,
}: {
  grip: number;
  width?: number;
  showScrew?: boolean;
}) {
  const g = Math.min(Math.max(grip, 0), 1);
  const gap = 300 - g * 232;
  const jawW = 184;
  const jawH = 264;
  const blockW = Math.max(gap - 20, 20);
  const heat = g;

  return (
    <svg
      width={width}
      height={width * 0.52}
      viewBox="-480 -180 960 360"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="jaw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2B333D" />
          <stop offset="50%" stopColor="#1A2027" />
          <stop offset="100%" stopColor="#11161B" />
        </linearGradient>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={18 * heat} />
        </filter>
      </defs>

      {/* bed rail */}
      <rect x={-460} y={jawH / 2} width={920} height={26} fill="#12161B" />
      <rect x={-460} y={jawH / 2} width={920} height={3} fill="#1C232B" />

      {showScrew ? (
        <>
          <line
            x1={gap / 2 + jawW / 2}
            y1={0}
            x2={410}
            y2={0}
            stroke="#2A323C"
            strokeWidth={14}
          />
          {Array.from({ length: 22 }, (_, i) => {
            const x = gap / 2 + jawW / 2 + 14 + i * 18;
            return x < 400 ? (
              <line
                key={i}
                x1={x}
                y1={-10}
                x2={x}
                y2={10}
                stroke="#39434F"
                strokeWidth={3}
              />
            ) : null;
          })}
        </>
      ) : null}

      {/* the held block, glowing hotter under pressure */}
      <rect
        x={-blockW / 2}
        y={-76}
        width={blockW}
        height={152}
        fill={COLORS.torch}
        opacity={0.12 + heat * 0.55}
        filter={heat > 0.1 ? "url(#glow)" : undefined}
      />
      <rect
        x={-blockW / 2}
        y={-76}
        width={blockW}
        height={152}
        fill="none"
        stroke={COLORS.torch}
        strokeWidth={3}
        opacity={0.4 + heat * 0.6}
      />

      <Jaw x={-gap / 2 - jawW} w={jawW} h={jawH} heat={heat} faceRight />
      <Jaw x={gap / 2} w={jawW} h={jawH} heat={heat} />
    </svg>
  );
}

function Jaw({
  x,
  w,
  h,
  heat,
  faceRight,
}: {
  x: number;
  w: number;
  h: number;
  heat: number;
  faceRight?: boolean;
}) {
  const y = -h / 2;
  const faceX = faceRight ? x + w - 24 : x;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="url(#jaw)" />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#39434F" strokeWidth={2} />
      <rect x={x + 2} y={y + 2} width={w - 4} height={2} fill="rgba(255,255,255,0.09)" />
      <g clipPath="none">
        {Array.from({ length: 26 }, (_, i) => (
          <line
            key={i}
            x1={faceX}
            y1={y + i * 12}
            x2={faceX + 24}
            y2={y + i * 12 - 24}
            stroke={COLORS.torch}
            strokeWidth={2}
            opacity={0.12 + heat * 0.35}
          />
        ))}
      </g>
    </g>
  );
}
