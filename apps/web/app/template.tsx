/**
 * Route transition.
 *
 * A template remounts on every navigation, which is exactly the hook needed to
 * replay an entrance. The movement is small and fast — 18px and 420ms — because
 * a page transition that announces itself is a page transition you resent by
 * the fourth click.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
