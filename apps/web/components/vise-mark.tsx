/**
 * The VISE mark: two jaws closing on a gap.
 *
 * `grip` (0..1) drives how far the jaws have travelled, so the same primitive
 * serves as the logo, the lock slider's indicator, and the loading state.
 */
export function ViseMark({
  size = 24,
  grip = 0.45,
  className,
}: {
  size?: number;
  grip?: number;
  className?: string;
}) {
  const clamped = Math.min(Math.max(grip, 0), 1);
  /*
   * Jaws travel from the outer edge toward the centre but never meet: a closed
   * vise with nothing in it is a vise with nothing to hold. The travel is
   * capped so the held block stays visible at full grip — otherwise the mark
   * collapses into a single solid bar at small sizes.
   */
  const travel = 4 + clamped * 4;
  const gap = 20 - travel * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x={2} y={4} width={travel} height={16} rx={1} fill="currentColor" />
      <rect
        x={22 - travel}
        y={4}
        width={travel}
        height={16}
        rx={1}
        fill="currentColor"
      />
      <rect
        x={2 + travel + 1}
        y={8}
        width={gap - 2}
        height={8}
        rx={1}
        fill="currentColor"
        opacity={0.4}
      />
    </svg>
  );
}
