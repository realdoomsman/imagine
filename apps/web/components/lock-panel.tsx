"use client";

import {
  DAY,
  exactAmount,
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatTokenAmount,
  multiplierBps,
  projectedShare,
  sizeBonusBps,
  type PoolTerms,
} from "@imagine/sdk";
import { useCallback, useState } from "react";
import type { PoolDetail, QuoteInfo } from "@/lib/api";
import { decimalInput, formatQuote, parseAmount, usdSuffix } from "@/lib/format";
import { useActor } from "@/lib/signer";
import { useTokenBalance } from "@/lib/use-token-balance";
import { durationLabel, LockDial } from "./lock-dial";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Lock the coin, earn the pair. Everything the lock will be paid is stated in
 * the coin's pair asset — NVDAx for an NVDAx coin, SOL for a SOL coin — with
 * a USD figure beside it when the asset has a price.
 */
export function LockPanel({
  mint,
  symbol,
  decimals,
  tokenProgram,
  quote,
  terms,
  totalWeight,
  supply,
  lockersPerDay,
  priceQuote,
}: {
  mint: string;
  symbol: string;
  decimals: number;
  /** The coin's token program (Token-2022 for StonkFun coins). */
  tokenProgram: string;
  quote: QuoteInfo;
  terms: PoolDetail["pool"]["terms"];
  totalWeight: string;
  /** Total token supply, base units; sets the size tier. */
  supply: string;
  /** Quote base units a day reaching this pool's lockers at the trailing fee rate. */
  lockersPerDay: string;
  /** Current price of one whole coin in pair units; null when unknown. */
  priceQuote: number | null;
}) {
  const actor = useActor();
  const balance = useTokenBalance(mint, tokenProgram, actor.publicKey);
  const [amountInput, setAmountInput] = useState("");
  const [seconds, setSeconds] = useState(Math.min(Math.max(30 * DAY, terms.minLockSecs), terms.maxLockSecs));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const poolTerms: PoolTerms = { ...terms, minLockAmount: BigInt(terms.minLockAmount) };
  const totalSupply = BigInt(supply);
  const amount = parseAmount(amountInput, decimals);
  const dailyToLockers = BigInt(lockersPerDay);

  const projection = amount > 0n ? projectedShare(amount, seconds, poolTerms, BigInt(totalWeight), totalSupply) : null;
  const multiplier = multiplierBps(seconds, poolTerms, amount, totalSupply);
  // The coin's own fee flow sets the pay: the same lock earns more on a coin
  // that trades more. Realised trailing rate times the share this lock takes.
  const perDay = projection ? BigInt(Math.floor(Number(dailyToLockers) * projection.share)) : null;
  // What the program will cap this lock at: its value in the pair asset now
  // times its multiplier. Quoted at the page's price; the program prices it on-chain.
  const maxEarn =
    amount > 0n && priceQuote !== null
      ? BigInt(Math.floor((Number(amount) / 10 ** decimals) * priceQuote * 10 ** quote.decimals * (multiplier / 10_000)))
      : null;
  const bonus = sizeBonusBps(amount, totalSupply, poolTerms);
  // The next tier up, so the panel can say what a larger lock would earn.
  const nextTier = poolTerms.sizeTierBps
    .map((tier, index) => ({ tier, bonus: poolTerms.sizeBonusBps[index] }))
    .find((entry) => entry.tier > 0 && entry.bonus > bonus);

  const submit = useCallback(async () => {
    if (!actor.publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      // A wallet can hold many positions in one pool, so take a fresh slot
      // rather than assuming index 0 is free.
      const index = Math.floor(Date.now() / 1000) % 1_000_000;
      const signature = await actor.act({ kind: "lock", mint, index, amount: amount.toString(), durationSecs: seconds });
      setStatus({ ok: true, text: `Locked. You're in the stream. ${signature.slice(0, 16)}…` });
      setAmountInput("");
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : "lock failed" });
    } finally {
      setBusy(false);
    }
  }, [actor, amount, seconds, mint]);

  const insufficient = balance !== null && amount > balance;
  const belowMinimum = amount > 0n && amount < poolTerms.minLockAmount;

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-h3">Lock ${symbol}</h2>
        <span className="text-[12px] text-muted">
          earn <span className="num font-semibold text-mint">{quote.symbol}</span>
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="lock-amount" className="eyebrow">
            Amount
          </label>
          <button
            type="button"
            disabled={balance === null}
            className="num text-[12px] text-muted transition-colors hover:text-fg disabled:cursor-default"
            onClick={() => balance !== null && setAmountInput(exactAmount(balance, decimals))}
          >
            {balance === null ? "—" : `${formatTokenAmount(balance, decimals)} available`}
          </button>
        </div>
        <div className="relative mt-2">
          <input
            id="lock-amount"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(decimalInput(event.target.value))}
            placeholder="0"
            className="input num pr-20 text-[18px]"
          />
          <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">
            ${symbol}
          </span>
        </div>
      </div>

      <div className="mt-5">
        <LockDial
          seconds={seconds}
          onChange={setSeconds}
          min={terms.minLockSecs}
          max={terms.maxLockSecs}
          multiplierBps={multiplier}
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
        <div className="bg-ink-1 px-4 py-3">
          <dt className="eyebrow">Multiplier</dt>
          <dd className="num dream-text mt-1 text-[20px] font-semibold">{formatMultiplier(multiplier)}</dd>
          <dd className="mt-0.5 text-[11px] text-muted">
            {bonus > 0
              ? `includes +${bonus / 100}% size tier`
              : nextTier
                ? `+${nextTier.bonus / 100}% at ${nextTier.tier / 100}% of supply`
                : "duration only"}
          </dd>
        </div>
        <div className="bg-ink-1 px-4 py-3">
          <dt className="eyebrow">Share of stream</dt>
          <dd className="num mt-1 text-[20px] text-fg">{projection ? formatPercent(projection.share, 2) : "—"}</dd>
          <dd className="mt-0.5 text-[11px] text-muted">of the lockers&apos; cut</dd>
        </div>
        <div className="col-span-2 bg-ink-1 px-4 py-3">
          <dt className="eyebrow">Estimated stream</dt>
          <dd className="num mt-1 text-[20px] text-mint">
            {perDay === null
              ? "—"
              : dailyToLockers === 0n
                ? `0 ${quote.symbol} / day`
                : `≈ ${formatQuote(perDay, quote)} / day`}
          </dd>
          <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">
            {dailyToLockers === 0n
              ? "No fees in the last day. The stream starts when this coin trades."
              : `At the last day's rate, ${formatQuote(dailyToLockers, quote)} a day to lockers${usdSuffix(dailyToLockers, quote) ? ` (${usdSuffix(dailyToLockers, quote)})` : ""}. Tracks volume, not a promise.`}
          </dd>
        </div>
        <div className="col-span-2 bg-ink-1 px-4 py-3">
          <dt className="eyebrow">Most this lock can earn</dt>
          <dd className="num mt-1 text-[20px] text-fg">{maxEarn === null ? "—" : `≈ ${formatQuote(maxEarn, quote)}`}</dd>
          <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Its value in {quote.symbol} when locked × its {formatMultiplier(multiplier)} multiplier. Once it has earned
            that it stops earning; fees beyond what locks can earn go to the treasury.
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Fees arriving now stream out over {formatDuration(terms.rewardStreamSecs)}, so a share is earned by staying
        locked, not by arriving at the right moment. Unlocks{" "}
        {new Date(Date.now() + seconds * 1_000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          ...(seconds < DAY ? { hour: "numeric", minute: "2-digit" } : {}),
        })}
        . Leaving early burns up to {formatPercent(terms.earlyUnlockPenaltyBps / 10_000, 0)} of your principal and
        hands unclaimed rewards to whoever stayed.
      </p>

      {actor.publicKey ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || amount <= 0n || insufficient || belowMinimum}
          className="btn btn-dream mt-5 w-full"
        >
          {busy
            ? "Locking…"
            : insufficient
              ? `Not enough $${symbol}`
              : belowMinimum
                ? "Below the minimum lock"
                : `Lock for ${durationLabel(seconds)}`}
        </button>
      ) : (
        <div className="mt-5">
          <SignInPrompt what="lock" />
        </div>
      )}

      {status ? (
        <p className={`num mt-3 break-all text-[12px] ${status.ok ? "text-mint" : "text-rose"}`}>{status.text}</p>
      ) : null}
    </section>
  );
}
