"use client";

import { useState } from "react";
import type { PortfolioPosition } from "@/lib/api";
import { explorerTx, formatAmount } from "@/lib/format";

/** The busy key the views hold while a claim-all runs. */
export const CLAIM_ALL = "claim-all";

/**
 * One press for every lock's earnings: the total claimable, per pair asset
 * since SOL and USDC don't add up, and the transactions as they land.
 * `onClaimAll` runs the claims and reports each landed signature.
 */
export function ClaimAll({
  positions,
  busy,
  onClaimAll,
}: {
  positions: PortfolioPosition[];
  /** The key of the action in flight anywhere on the page, or null. */
  busy: string | null;
  onClaimAll: (onSent: (signature: string) => void) => void;
}) {
  const [sent, setSent] = useState<string[]>([]);

  const totals = new Map<string, { symbol: string; decimals: number; amount: bigint }>();
  let locks = 0;
  for (const position of positions) {
    const pending = BigInt(position.pending);
    if (!position.quote || pending === 0n) continue;
    locks += 1;
    const total = totals.get(position.quote.mint) ?? { symbol: position.quote.symbol, decimals: position.quote.decimals, amount: 0n };
    total.amount += pending;
    totals.set(position.quote.mint, total);
  }
  const amounts = [...totals.values()].map((total) => `${formatAmount(total.amount, total.decimals)} ${total.symbol}`).join(" + ");
  const running = busy === CLAIM_ALL;

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <button
        type="button"
        disabled={busy !== null || locks === 0}
        onClick={() => {
          setSent([]);
          onClaimAll((signature) => setSent((previous) => [...previous, signature]));
        }}
        className="btn btn-primary btn-sm"
      >
        {running
          ? sent.length > 0
            ? `Claiming… ${sent.length} sent`
            : "Claiming…"
          : locks === 0
            ? "Nothing to claim yet"
            : `Claim all · ${amounts} across ${locks} lock${locks === 1 ? "" : "s"}`}
      </button>
      {sent.length > 0 ? (
        <p className="num flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          {running ? "Landed:" : `Claimed in ${sent.length} transaction${sent.length === 1 ? "" : "s"}:`}
          {sent.map((signature) => (
            <a
              key={signature}
              href={explorerTx(signature)}
              target="_blank"
              rel="noreferrer"
              className="text-steel-hi hover:text-fg"
            >
              {signature.slice(0, 8)}… ↗
            </a>
          ))}
        </p>
      ) : (
        <p className="text-[12px] text-muted">
          {locks > 1 ? "Every lock's earnings in one go, straight to your wallet." : "Earnings go straight to your wallet."}
        </p>
      )}
    </div>
  );
}
