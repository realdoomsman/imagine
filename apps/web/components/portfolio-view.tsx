"use client";

import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type PortfolioPosition, type PortfolioTotals } from "@/lib/api";
import type { Expectation } from "@/lib/send";
import { formatUsd } from "@/lib/format";
import { useActor } from "@/lib/signer";
import { ImagineMark } from "./imagine-mark";
import { PositionCard } from "./position-card";
import { Shimmer } from "./skeleton";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Locks for whichever wallet is connected, read from chain. Earnings are
 * shown per lock in that coin's pair asset; the totals are the USD sum,
 * since NVDAx and SOL don't add up any other way.
 */
export function PortfolioView() {
  const actor = useActor();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totals, setTotals] = useState<PortfolioTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last failed action and why, so a position can react to its own unlock failing.
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!actor.publicKey) return;
    setLoading(true);
    try {
      const result = await api.portfolio(actor.publicKey.toBase58());
      setPositions(result.positions);
      setTotals(result.totals);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not load positions");
    } finally {
      setLoading(false);
    }
  }, [actor.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (key: string, action: Record<string, unknown>, expect?: Expectation) => {
      setBusy(key);
      setError(null);
      setFailed(null);
      try {
        await actor.act(action, expect);
        await refresh();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "action failed";
        setError(message);
        setFailed({ key, message });
      } finally {
        setBusy(null);
      }
    },
    [actor, refresh],
  );

  if (!actor.publicKey) {
    return (
      <div className="card mt-10 flex flex-col items-center gap-4 px-8 py-20 text-center">
        <ImagineMark size={44} className="opacity-40" />
        <h2 className="t-h3">Sign in to see your locks.</h2>
        <p className="max-w-[46ch] text-[14.5px] leading-relaxed text-muted">
          Positions and unclaimed rewards are read straight from chain for whichever wallet you use — an Imagine wallet
          or your own.
        </p>
        <div className="w-full max-w-md text-left">
          <SignInPrompt what="see your locks" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <dl className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3">
        <Summary label="Unclaimed" value={totals ? formatUsd(totals.pendingUsd) : "—"} accent />
        <Summary label="Claimed to date" value={totals ? formatUsd(totals.claimedUsd) : "—"} />
        <Summary label="Open locks" value={totals ? String(totals.positions) : "—"} />
      </dl>

      {error ? (
        <p className="mt-5 break-words rounded-[10px] border border-rose/40 bg-rose/10 px-5 py-3 text-[13px] text-rose">{error}</p>
      ) : null}

      {loading && positions.length === 0 ? (
        <div className="card mt-6 space-y-3 px-6 py-8">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-4">
              <Shimmer className="size-11 shrink-0 rounded-[10px]" />
              <Shimmer className="h-3.5 w-40" />
              <Shimmer className="ml-auto h-3.5 w-24" />
            </div>
          ))}
          <p className="sr-only">Reading the chain…</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="card mt-6 flex flex-col items-center gap-4 px-8 py-20 text-center">
          <ImagineMark size={44} className="opacity-40" />
          <h2 className="t-h3">Nothing locked yet</h2>
          <p className="max-w-[44ch] text-[14.5px] leading-relaxed text-muted">
            Lock a coin and you start earning a share of every fee it generates, in the asset it&apos;s paired with, for
            as long as the lock runs.
          </p>
          <Link href="/coins" className="btn btn-primary mt-2">
            Browse coins
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {positions.map((position) => {
            const key = `${position.mint}-${position.index}`;
            const base = { mint: position.mint, index: position.index };
            return (
              <PositionCard
                key={key}
                position={position}
                earlyExitBurn={null}
                busy={busy}
                unlockError={failed?.key === `unlock-${key}` ? failed.message : null}
                onClaim={() => void act(`claim-${key}`, { kind: "claim", ...base })}
                onUnlock={(early) => void act(`unlock-${key}`, { kind: "unlock", ...base, early })}
                onExtend={(seconds) => void act(`extend-${key}`, { kind: "extend", ...base, durationSecs: seconds })}
                onRenounce={() => void act(`renounce-${key}`, { kind: "renounce", ...base })}
                onLockForever={() =>
                  void act(`forever-${key}`, { kind: "lockForever", ...base }, {
                    kind: "lockForever",
                    mint: new PublicKey(position.mint!),
                    index: position.index,
                  })
                }
                onSetAutoCompound={(enabled) =>
                  void act(`auto-${key}`, { kind: "setAutoCompound", ...base, enabled }, {
                    kind: "setAutoCompound",
                    mint: new PublicKey(position.mint!),
                    index: position.index,
                    enabled,
                  })
                }
                onCompound={() =>
                  void act(`compound-${key}`, { kind: "compound", ...base }, {
                    kind: "compound",
                    mint: new PublicKey(position.mint!),
                    index: position.index,
                    expectedOut: position.compoundEstimate !== null ? BigInt(position.compoundEstimate) : null,
                  })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-ink-2 px-5 py-4">
      <dt className="eyebrow">{label}</dt>
      <dd className={`num mt-1.5 text-[24px] leading-none ${accent ? "text-mint" : "text-fg"}`}>{value}</dd>
    </div>
  );
}
