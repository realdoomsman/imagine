const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";

/**
 * Says which network the site is on until it is on the real one.
 *
 * A visitor arriving from a post should never mistake a devnet coin for a
 * mainnet one, so a chip stays in the corner of every page until the build
 * is pointed at mainnet, at which point it renders nothing. It sits above
 * the phone tab bar and clear of the floating header.
 */
export function ClusterNotice() {
  if (CLUSTER === "mainnet-beta") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 md:bottom-4 md:justify-end">
      <p
        className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-torch/30 bg-steel-990/85 px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-torch-pale shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)] backdrop-blur-md"
        title="Coins here trade with test SOL. Mainnet follows the audit."
      >
        <span className="inline-block size-1.5 rounded-full bg-torch" aria-hidden="true" />
        Solana devnet · test SOL only
      </p>
    </div>
  );
}
