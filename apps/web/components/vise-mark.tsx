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
  // Jaws travel from the outer edge toward the centre, never fully meeting:
  // a closed vise with nothing in it is a vise with nothing to hold.
  const travel = 5 + clamped * 5;

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
        x={travel + 2.5}
        y={8}
        width={19 - travel * 2}
        height={8}
        rx={1}
        fill="currentColor"
        opacity={0.35}
      />
    </svg>
  );
}
