"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatTokenAmount,
  multiplierBps,
  projectedShare,
  sizeBonusBps,
  type PoolTerms,
} from "@vise/sdk";
import { useCallback, useEffect, useState } from "react";
import { useActor } from "@/lib/signer";
import { LockDial } from "./lock-dial";
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
}: {
  mint: string;
  symbol: string;
  decimals: number;
  terms: TermsDto;
  totalWeight: string;
  accRewardPerWeight: string;
  /** Total token supply, base units; sets the size tier. */
  supply: string;
}) {
  const { connection } = useConnection();
  const actor = useActor();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const poolTerms: PoolTerms = {
    ...terms,
    minLockAmount: BigInt(terms.minLockAmount),
  };
  const totalSupply = BigInt(supply);
  const minDays = Math.floor(terms.minLockSecs / 86_400);
  const maxDays = Math.floor(terms.maxLockSecs / 86_400);

  useEffect(() => {
    if (!actor.publicKey) {
      setBalance(null);
      return;
    }
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      actor.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    let cancelled = false;
    void connection
      .getTokenAccountBalance(ata)
      .then((result) => {
        if (!cancelled) setBalance(BigInt(result.value.amount));
      })
      .catch(() => {
        if (!cancelled) setBalance(0n);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, mint, actor.publicKey]);

  const amount = (() => {
    const parsed = Number(amountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * 10 ** decimals));
  })();

  const projection =
    amount > 0n
      ? projectedShare(amount, days * 86_400, poolTerms, BigInt(totalWeight), totalSupply)
      : null;
  const multiplier = multiplierBps(days * 86_400, poolTerms, amount, totalSupply);
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
        durationDays: days,
      });
      setStatus(`Clamped. ${signature.slice(0, 16)}…`);
      setAmountInput("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "lock failed");
    } finally {
      setBusy(false);
    }
  }, [actor, amount, days, mint]);

  const insufficient = balance !== null && amount > balance;
  const belowMinimum = amount > 0n && amount < poolTerms.minLockAmount;

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px]">Clamp {symbol}</h2>
        <span className="text-torch">
          <ViseMark size={20} grip={(days - minDays) / (maxDays - minDays)} />
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
        <LockDial
          days={days}
          onChange={setDays}
          min={minDays}
          max={maxDays}
          presets={[7, 30, 90, 180, 365].filter((d) => d >= minDays && d <= maxDays)}
        />
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
      </dl>

      <p className="mt-3 text-[12px] leading-relaxed text-steel-600">
        Fees arriving now stream out over{" "}
        {formatDuration(terms.rewardStreamSecs)}, so a share is earned by staying
        locked rather than by arriving at the right moment. Unlocks{" "}
        {new Date(Date.now() + days * 86_400_000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
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
                : `Clamp for ${days} days`}
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
