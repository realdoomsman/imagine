const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";

/**
 * Says which network the site is on until it is on the real one.
 *
 * IMAGINE's platform lives on mainnet only, so anything else is either devnet or a local
 * mainnet fork; a visitor should never mistake a coin from either for a real
 * one. On mainnet-beta this renders nothing.
 */
export function ClusterNotice() {
  if (CLUSTER === "mainnet-beta") return null;
  const label = CLUSTER === "devnet" ? "Devnet" : "Local fork";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 lg:bottom-4 lg:justify-end">
      <p
        className="pill pill-steel pointer-events-auto h-8 px-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)]"
        title="This build is not connected to Solana mainnet. Coins and balances here are not real."
      >
        <span className="inline-block size-1.5 rounded-full bg-steel-hi" aria-hidden="true" />
        {label} · not mainnet
      </p>
    </div>
  );
}
