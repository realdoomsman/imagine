"use client";

import {
  DAY,
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatSol,
  formatTokenAmount,
  multiplierBps,
  projectedShare,
  sizeBonusBps,
  type PoolTerms,
} from "@vise/sdk";
import { useCallback, useState } from "react";
import { useActor } from "@/lib/signer";
import { useTokenBalance } from "@/lib/use-token-balance";
import { durationLabel, LockDial } from "./lock-dial";
import { ViseMark } from "./vise-mark";
import { SignInPrompt } from "./sign-in-prompt";

interface TermsDto {
  treasuryShareBps: number;
  creatorShareBps: number;
  minLockSecs: number;
  maxLockSecs: number;
  maxMultiplierBps: number;
  earlyUnlockPenaltyBps: number;
  minLockAmount: string;
  rewardStreamSecs: number;
  durationCurve: number;
  sizeTierBps: [number, number, number];
  sizeBonusBps: [number, number, number];
}

export function LockPanel({
  mint,
  symbol,
  decimals,
  terms,
  totalWeight,
  accRewardPerWeight,
  supply,
  lockersPerDay,
  capped,
  priceLamports,
}: {
  mint: string;
  symbol: string;
  decimals: number;
  terms: TermsDto;
  totalWeight: string;
  accRewardPerWeight: string;
  /** Total token supply, base units; sets the size tier. */
  supply: string;
  /** Lamports a day reaching this pool's lockers at the trailing fee rate. */
  lockersPerDay: string;
  /** Each lock earns at most its SOL value when locked × its multiplier. */
  capped: boolean;
  /** Current price of one whole token, lamports. */
  priceLamports: number;
}) {
  const actor = useActor();
  const balance = useTokenBalance(mint, actor.publicKey);
  const [amountInput, setAmountInput] = useState("");
  const [seconds, setSeconds] = useState(Math.min(Math.max(30 * DAY, terms.minLockSecs), terms.maxLockSecs));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const poolTerms: PoolTerms = {
    ...terms,
    minLockAmount: BigInt(terms.minLockAmount),
  };
  const totalSupply = BigInt(supply);

  const amount = (() => {
    const parsed = Number(amountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 10 ** decimals));
  })();

  const projection =
    amount > 0n
      ? projectedShare(amount, seconds, poolTerms, BigInt(totalWeight), totalSupply)
      : null;
  const multiplier = multiplierBps(seconds, poolTerms, amount, totalSupply);
  // The coin's own fee flow sets the pay: the same lock earns more on a coin
  // that trades more. Realised trailing rate times the share this lock takes.
  const perDay = projection ? BigInt(Math.floor(Number(lockersPerDay) * projection.share)) : null;
  // What the program will cap this lock at: its SOL value now times its
  // multiplier. Quoted at the page's price; the program prices it on-chain.
  const maxEarn =
    capped && amount > 0n
      ? BigInt(Math.floor((Number(amount) / 10 ** decimals) * priceLamports * (multiplier / 10_000)))
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
      // A wallet can hold many positions in one pool, so pick the next free
      // slot rather than assuming index 0 is available.
      const index = Math.floor(Date.now() / 1000) % 1_000_000;
      const signature = await actor.act({
        kind: "lock",
        mint,
        index,
        amount: amount.toString(),
        durationSecs: seconds,
      });
      setStatus(`Clamped. ${signature.slice(0, 16)}…`);
      setAmountInput("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "lock failed");
    } finally {
      setBusy(false);
    }
  }, [actor, amount, seconds, mint]);

  const insufficient = balance !== null && amount > balance;
  const belowMinimum = amount > 0n && amount < poolTerms.minLockAmount;

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px]">Clamp {symbol}</h2>
        <span className="text-torch">
          <ViseMark
            size={20}
            grip={(seconds - terms.minLockSecs) / Math.max(1, terms.maxLockSecs - terms.minLockSecs)}
          />
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="lock-amount" className="rule-label">
            Amount
          </label>
          <button
            type="button"
            className="num text-[12px] text-steel-500 hover:text-steel-200"
            onClick={() =>
              balance !== null && setAmountInput(String(Number(balance) / 10 ** decimals))
            }
          >
            {balance === null
              ? "—"
              : `${formatTokenAmount(balance, decimals)} available`}
          </button>
        </div>
        <input
          id="lock-amount"
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0"
          className="input num mt-2 text-[18px]"
        />
      </div>

      <div className="mt-5">
        <LockDial seconds={seconds} onChange={setSeconds} min={terms.minLockSecs} max={terms.maxLockSecs} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px border border-steel-700 bg-steel-700">
        <div className="bg-steel-900 px-4 py-3">
          <dt className="rule-label">Your multiplier</dt>
          <dd className="num mt-1 text-[20px] text-torch">
            {formatMultiplier(multiplier)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-steel-500">
            {bonus > 0
              ? `includes +${bonus / 100}% size tier`
              : nextTier
                ? `+${nextTier.bonus / 100}% at ${nextTier.tier / 100}% of supply`
                : "duration only"}
          </dd>
        </div>
        <div className="bg-steel-900 px-4 py-3">
          <dt className="rule-label">Share of fees</dt>
          <dd className="num mt-1 text-[20px] text-steel-50">
            {projection ? formatPercent(projection.share, 2) : "—"}
          </dd>
          <dd className="mt-0.5 text-[11px] text-steel-500">of the lockers&apos; 90%</dd>
        </div>
        <div className="col-span-2 bg-steel-900 px-4 py-3">
          <dt className="rule-label">Estimated earnings</dt>
          <dd className="num mt-1 text-[20px] text-verdi">
            {perDay === null ? "—" : BigInt(lockersPerDay) === 0n ? "0 SOL / day" : `≈ ${formatSol(perDay, 6)} SOL / day`}
          </dd>
          <dd className="mt-0.5 text-[11px] text-steel-500">
            {BigInt(lockersPerDay) === 0n
              ? "No fees in the last day. Rewards start when this coin trades."
              : `At the last day's fee rate, ${formatSol(BigInt(lockersPerDay))} SOL/day to lockers. Tracks volume: more trading, more rewards.`}
          </dd>
        </div>
        {capped ? (
          <div className="col-span-2 bg-steel-900 px-4 py-3">
            <dt className="rule-label">Most this lock can earn</dt>
            <dd className="num mt-1 text-[20px] text-steel-50">
              {maxEarn === null ? "—" : `≈ ${formatSol(maxEarn)} SOL`}
            </dd>
            <dd className="mt-0.5 text-[11px] text-steel-500">
              Its SOL value when locked × its {formatMultiplier(multiplier)} multiplier. Once it has
              earned that it stops earning; fees beyond what locks can earn go to the treasury.
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-3 text-[12px] leading-relaxed text-steel-600">
        Fees arriving now stream out over{" "}
        {formatDuration(terms.rewardStreamSecs)}, so a share is earned by staying
        locked rather than by arriving at the right moment. Unlocks{" "}
        {new Date(Date.now() + seconds * 1_000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          ...(seconds < DAY ? { hour: "numeric", minute: "2-digit" } : {}),
        })}
        . Leaving early burns up to{" "}
        {formatPercent(terms.earlyUnlockPenaltyBps / 10_000, 0)} of your principal
        and forfeits unclaimed rewards to whoever stayed.
      </p>

      {actor.publicKey ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || amount <= 0n || insufficient || belowMinimum}
          className="btn btn-primary mt-5 w-full"
        >
          {busy
            ? "Clamping…"
            : insufficient
              ? "Not enough coins"
              : belowMinimum
                ? "Below the minimum lock"
                : `Clamp for ${durationLabel(seconds)}`}
        </button>
      ) : (
        <div className="mt-5">
          <SignInPrompt what="clamp" />
        </div>
      )}

      {status ? (
        <p className="num mt-3 break-all text-[12px] text-steel-400">{status}</p>
      ) : null}
    </section>
  );
}
