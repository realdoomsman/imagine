"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
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
import { buildAndSend } from "@/lib/send";

export function PortfolioView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totals, setTotals] = useState({ pending: "0", claimed: "0", positions: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    try {
      const result = await api.portfolio(wallet.publicKey.toBase58());
      setPositions(result.positions);
      setTotals(result.totals);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not load positions");
    } finally {
      setLoading(false);
    }
  }, [wallet.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (path: string, body: unknown, key: string) => {
      setBusy(key);
      setError(null);
      try {
        await buildAndSend(connection, wallet, path, body);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "action failed");
      } finally {
        setBusy(null);
      }
    },
    [connection, refresh, wallet],
  );

  if (!wallet.publicKey) {
    return (
      <p className="panel mt-10 px-6 py-10 text-center text-[14px] text-steel-500">
        Connect a wallet to see your locks.
      </p>
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
        <p className="panel mt-6 px-6 py-10 text-center text-[13px] text-steel-500">
          Reading chain…
        </p>
      ) : positions.length === 0 ? (
        <div className="panel mt-6 flex flex-col items-start gap-4 p-10">
          <h2 className="text-[18px]">Nothing clamped yet</h2>
          <p className="text-[14px] text-steel-500">
            Lock a coin and you start earning its trading fees.
          </p>
          <Link href="/coins" className="btn btn-primary">
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
                      void act(
                        "/api/tx/claim",
                        {
                          owner: wallet.publicKey!.toBase58(),
                          mint: position.mint,
                          index: position.index,
                        },
                        key,
                      )
                    }
                    className="btn btn-primary h-9 text-[13px]"
                  >
                    Claim
                  </button>

                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() =>
                      void act(
                        "/api/tx/unlock",
                        {
                          owner: wallet.publicKey!.toBase58(),
                          mint: position.mint,
                          index: position.index,
                          early: !matured,
                        },
                        key,
                      )
                    }
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
