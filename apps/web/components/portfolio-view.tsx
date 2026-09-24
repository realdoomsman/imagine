"use client";

import {
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatSol,
  formatTokenAmount,
} from "@vise/sdk";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type PortfolioPosition } from "@/lib/api";
import { useActor } from "@/lib/signer";
import { ExtendControl } from "./extend-control";
import { SignInPrompt } from "./sign-in-prompt";
import { ViseMark } from "./vise-mark";
import { Shimmer } from "./skeleton";

export function PortfolioView() {
  const actor = useActor();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totals, setTotals] = useState({ pending: "0", claimed: "0", positions: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    async (action: Record<string, unknown>, key: string) => {
      setBusy(key);
      setError(null);
      try {
        await actor.act(action);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "action failed");
      } finally {
        setBusy(null);
      }
    },
    [actor, refresh],
  );

  if (!actor.publicKey) {
    return (
      <div className="panel mt-10 flex flex-col items-center gap-5 px-8 py-20 text-center">
        <span className="text-steel-700">
          <ViseMark size={44} grip={0} />
        </span>
        <h2 className="t-sub">Sign in to see your locks.</h2>
        <p className="max-w-[46ch] text-[14.5px] leading-relaxed text-steel-500">
          Positions and unclaimed rewards are read straight from the chain for
          whichever wallet you use — a VISE account or your own.
        </p>
        <div className="w-full max-w-md text-left">
          <SignInPrompt what="see your locks" />
        </div>
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="mt-8">
      <dl className="grid gap-px border border-steel-700 bg-steel-700 sm:grid-cols-3">
        <Summary label="Unclaimed" value={`${formatSol(BigInt(totals.pending))} SOL`} accent />
        <Summary label="Claimed to date" value={`${formatSol(BigInt(totals.claimed))} SOL`} />
        <Summary label="Open positions" value={String(totals.positions)} />
      </dl>

      {error ? (
        <p className="mt-5 rounded-machined border border-rust/40 bg-rust/10 px-5 py-3 text-[13px] text-rust">
          {error}
        </p>
      ) : null}

      {loading && positions.length === 0 ? (
        <div className="panel mt-6 space-y-3 px-6 py-8">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-4">
              <Shimmer className="size-10 shrink-0" />
              <Shimmer className="h-3.5 w-40" />
              <Shimmer className="ml-auto h-3.5 w-24" />
            </div>
          ))}
          <p className="sr-only">Reading the chain…</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="panel mt-6 flex flex-col items-center gap-5 px-8 py-20 text-center">
          <span className="text-steel-700">
            <ViseMark size={44} grip={0} />
          </span>
          <h2 className="t-sub">Nothing clamped yet</h2>
          <p className="max-w-[44ch] text-[14.5px] leading-relaxed text-steel-500">
            Lock a coin and you start earning a share of every fee it generates,
            for as long as the lock runs.
          </p>
          <Link href="/coins" className="btn btn-primary mt-2">
            Browse coins
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {positions.map((position) => {
            const remaining = position.lockEnd - now;
            const matured = remaining <= 0;
            const key = `${position.mint}-${position.index}`;
            const elapsed =
              position.lockEnd > position.lockStart
                ? Math.min(
                    Math.max(
                      (now - position.lockStart) /
                        (position.lockEnd - position.lockStart),
                      0,
                    ),
                    1,
                  )
                : 1;

            return (
              <article key={key} className="panel p-5">
                <div className="flex flex-wrap items-start gap-4">
                  {position.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
                    <img
                      src={position.imageUrl}
                      alt=""
                      className="size-10 rounded-machined border border-steel-700 object-cover"
                    />
                  ) : (
                    <div className="size-10 rounded-machined border border-steel-700 bg-steel-860" />
                  )}

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/coins/${position.mint}`}
                      className="text-[15px] font-semibold text-steel-50 hover:text-torch"
                    >
                      {position.symbol ?? position.mint?.slice(0, 8)}
                    </Link>
                    <p className="num text-[12px] text-steel-500">
                      {formatTokenAmount(BigInt(position.amount), position.decimals)}{" "}
                      clamped · {formatMultiplier(position.multiplierBps)} ·{" "}
                      {formatPercent(position.share, 2)} of the pool
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="rule-label">Unclaimed</p>
                    <p className="num text-[18px] text-verdi">
                      {formatSol(BigInt(position.pending))} SOL
                    </p>
                    {position.rewardCap !== null ? (
                      <p className="num text-[11px] text-steel-500">
                        {formatSol(BigInt(position.claimed))} of max {formatSol(BigInt(position.rewardCap))} earned
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="text-steel-500">
                      {matured ? "Matured" : `${formatDuration(remaining)} left`}
                    </span>
                    <span className="num text-steel-600">
                      {formatPercent(elapsed, 0)} served
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 border border-steel-700 bg-steel-950">
                    <div
                      className="knurl h-full bg-torch"
                      style={{ width: `${elapsed * 100}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === key || BigInt(position.pending) === 0n}
                    onClick={() =>
                      void act({ kind: "claim", mint: position.mint, index: position.index }, key)
                    }
                    className="btn btn-primary h-9 text-[13px]"
                  >
                    Claim
                  </button>

                  {!matured ? (
                    <ExtendControl
                      lockEnd={position.lockEnd}
                      minLockSecs={position.minLockSecs}
                      maxLockSecs={position.maxLockSecs}
                      busy={busy === key}
                      onExtend={(seconds) =>
                        void act({ kind: "extend", mint: position.mint, index: position.index, durationSecs: seconds }, key)
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() => {
                      // Breaking early is irreversible and burns principal: ask once, plainly.
                      if (!matured && !window.confirm("Break this lock now? Part of your principal is burned and unclaimed rewards go to the lockers who stayed. This cannot be undone.")) return;
                      void act({ kind: "unlock", mint: position.mint, index: position.index, early: !matured }, key);
                    }}
                    className="btn btn-ghost h-9 text-[13px]"
                    title={
                      matured
                        ? "Return your coins"
                        : "Leaving early burns part of your principal and forfeits unclaimed rewards"
                    }
                  >
                    {matured ? "Unlock" : "Break the lock"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-steel-900 px-5 py-4">
      <dt className="rule-label">{label}</dt>
      <dd
        className={`num mt-1.5 text-[24px] ${accent ? "text-verdi" : "text-steel-50"}`}
      >
        {value}
      </dd>
    </div>
  );
}
