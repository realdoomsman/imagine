"use client";

import {
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatTokenAmount,
  MIN_COMPOUND_QUOTE,
  shortAddress,
} from "@imagine/sdk";
import Link from "next/link";
import { useState } from "react";
import type { PortfolioPosition } from "@/lib/api";
import { explorerAccount, FOREVER_TOOLTIP, formatAmount, usdSuffix } from "@/lib/format";
import { ExtendControl } from "./extend-control";
import { QuoteLogo } from "./pair-pill";

const RENOUNCE_WARNING =
  "Give up this lock's earnings for good? Your tokens stay locked until the same date, but it will never earn again: what it has built up and everything it would earn goes to the other lockers. Claim first if you want what is unclaimed. This cannot be undone.";

/** What has to be typed to lock a position forever, so it is never one stray click. */
const FOREVER_WORD = "FOREVER";

/**
 * A payout refused because the pair asset's issuer froze the reward account or
 * paused the token: SPL "Account is frozen" (custom error 17) or Token-2022's
 * paused-mint error, as the wallet path or the Imagine wallet reports them.
 */
const BLOCKED_PAYOUT = /frozen|paused|"Custom":\s*17\b|custom program error: 0x11\b/i;

/**
 * One lock: what is locked, what it has earned in its pair asset, how long
 * is left, and the controls. Breaking a lock early is irreversible and costs
 * principal, so it takes a second, differently-worded press.
 *
 * A matured lock can also leave without its rewards: the program's
 * `early_unlock` on a matured position burns nothing, returns every coin and
 * moves no pair asset, and the unclaimed rewards go to the other lockers. It
 * is the way out when the pair asset's issuer has frozen or paused payouts,
 * so it is offered prominently after an unlock fails that way and behind a
 * small link otherwise.
 */
export function PositionCard({
  position,
  earlyExitBurn,
  busy,
  unlockError,
  onClaim,
  onUnlock,
  onExtend,
  onRenounce,
  onLockForever,
  onSetAutoCompound,
  onCompound,
}: {
  position: PortfolioPosition;
  /** Coin base units an early exit would burn now; null when not computed. */
  earlyExitBurn: string | null;
  /** The key of the action in flight anywhere on the page, or null. */
  busy: string | null;
  /** Why this position's last unlock failed, if it did. */
  unlockError: string | null;
  onClaim: () => void;
  onUnlock: (early: boolean) => void;
  onExtend: (seconds: number) => void;
  onRenounce: () => void;
  /** Lock this position forever: never unlockable, earnings to the other lockers. */
  onLockForever: () => void;
  /** Turn auto-compound on or off for this lock. */
  onSetAutoCompound: (enabled: boolean) => void;
  /** Compound this lock's rewards now: buy more of the coin with them and add it to the lock. */
  onCompound: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [typed, setTyped] = useState("");
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = Math.max(position.lockEnd - now, 0);
  const matured = secondsLeft === 0;
  const term = position.lockEnd - position.lockStart;
  const elapsed = term > 0 ? Math.min(Math.max((now - position.lockStart) / term, 0), 1) : 1;
  const key = `${position.mint}-${position.index}`;
  const pending = BigInt(position.pending);
  const quote = position.quote;
  const amountLabel = formatTokenAmount(BigInt(position.amount), position.decimals);
  const pendingLabel = quote ? `${formatAmount(pending, quote.decimals)} ${quote.symbol}` : "—";
  const burnLabel = earlyExitBurn !== null ? formatTokenAmount(BigInt(earlyExitBurn), position.decimals) : null;
  const payoutBlocked = unlockError !== null && BLOCKED_PAYOUT.test(unlockError);
  const ticker = `$${position.symbol ?? shortAddress(position.mint ?? "")}`;
  // Compounding adds to the lock, so it runs only while the lock still earns and runs.
  const canCompound = !position.forever && !position.renounced && !matured;
  const compoundedQuote = BigInt(position.compoundedQuote);
  const compoundEstimate = position.compoundEstimate !== null ? BigInt(position.compoundEstimate) : null;
  const enoughToCompound = pending >= MIN_COMPOUND_QUOTE && compoundEstimate !== null && compoundEstimate > 0n;

  return (
    <article className={`card p-5 ${pending > 0n ? "card-dream" : ""}`}>
      <div className="flex flex-wrap items-start gap-4">
        {position.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
          <img src={position.imageUrl} alt="" className="size-11 rounded-[10px] border border-line bg-ink-3 object-cover" />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-[10px] border border-line bg-ink-3 font-bold text-muted">
            {(position.symbol ?? "?").slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/coins/${position.mint}`} className="text-[15px] font-semibold text-fg hover:text-steel-hi">
            ${position.symbol ?? shortAddress(position.mint ?? "")}
          </Link>
          {position.forever ? (
            <span className="pill pill-steel ml-2 h-[20px] px-2 text-[10.5px]" title={FOREVER_TOOLTIP}>
              Locked forever
            </span>
          ) : null}
          {position.autoCompound && canCompound ? (
            <span
              className="pill pill-up ml-2 h-[20px] px-2 text-[10.5px]"
              title={`Rewards buy more ${ticker} and add to this lock automatically`}
            >
              Auto-compounding
            </span>
          ) : null}
          <p className="num mt-0.5 text-[12px] text-muted">
            {amountLabel} locked ·{" "}
            {position.forever
              ? "locked forever, its earnings go to the other lockers"
              : position.renounced
                ? "earnings given up, locked for the other holders"
                : `${formatMultiplier(position.multiplierBps)} · ${formatPercent(position.share, 2)} of the pool`}
          </p>
        </div>
        <div className="basis-full sm:basis-auto sm:text-right">
          <p className="eyebrow">Earning</p>
          <p className="num mt-1 flex items-center gap-1.5 text-[20px] leading-none text-mint sm:justify-end">
            {quote ? <QuoteLogo quote={quote} size={16} /> : null}
            {pendingLabel}
          </p>
          <p className="num mt-1 text-[11px] text-muted">
            {quote && usdSuffix(pending, quote) ? `${usdSuffix(pending, quote)} · ` : ""}
            {quote ? formatAmount(position.claimed, quote.decimals) : "—"}
            {quote ? ` of max ${formatAmount(position.rewardCap, quote.decimals)}` : ""} claimed
          </p>
          {compoundedQuote > 0n && quote ? (
            <p className="num mt-0.5 text-[11px] text-muted">
              {formatAmount(compoundedQuote, quote.decimals)} {quote.symbol} compounded into{" "}
              {formatTokenAmount(BigInt(position.compoundedTokens), position.decimals)} {ticker}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        {position.forever ? (
          <p className="text-[12px] text-muted" title={FOREVER_TOOLTIP}>
            Never unlocks. {FOREVER_TOOLTIP}.{" "}
            <a href={explorerAccount(position.address)} target="_blank" rel="noreferrer" className="text-steel-hi hover:text-fg">
              On-chain proof ↗
            </a>
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-muted">
                {matured ? "Matured — your coins are free" : `Unlocks in ${formatDuration(secondsLeft)}`}
              </span>
              <span className="num text-muted">
                {new Date(position.lockEnd * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-4">
              <div className="h-full rounded-full" style={{ width: `${elapsed * 100}%`, background: "var(--dream)" }} />
            </div>
          </>
        )}
      </div>

      {position.forever ? null : (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null || pending === 0n} onClick={onClaim} className="btn btn-primary btn-sm">
          {busy === `claim-${key}` ? "Claiming…" : `Claim${quote ? ` ${quote.symbol}` : ""}`}
        </button>
        {matured && forfeiting ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setForfeiting(false);
                onUnlock(true);
              }}
              className="btn btn-danger btn-sm"
            >
              {busy === `unlock-${key}` ? "Withdrawing…" : `Withdraw ${amountLabel}, forfeit ${pendingLabel}`}
            </button>
            <button type="button" onClick={() => setForfeiting(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </>
        ) : matured ? (
          <>
            <button type="button" disabled={busy !== null} onClick={() => onUnlock(false)} className="btn btn-ghost btn-sm">
              {busy === `unlock-${key}` ? "Working…" : "Unlock"}
            </button>
            {payoutBlocked ? (
              <button type="button" disabled={busy !== null} onClick={() => setForfeiting(true)} className="btn btn-danger btn-sm">
                Withdraw coins, forfeit rewards
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setForfeiting(true)}
                className="text-[11.5px] text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
              >
                Can&apos;t unlock? Withdraw coins without rewards
              </button>
            )}
          </>
        ) : confirming ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setConfirming(false);
                onUnlock(true);
              }}
              className="btn btn-danger btn-sm"
            >
              {busy === `unlock-${key}` ? "Breaking…" : burnLabel ? `Burn ${burnLabel} and leave` : "Burn and leave"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
              Keep it locked
            </button>
          </>
        ) : (
          <>
            {position.renounced ? null : (
              <>
                <ExtendControl
                  lockEnd={position.lockEnd}
                  minLockSecs={position.minLockSecs}
                  maxLockSecs={position.maxLockSecs}
                  busy={busy !== null}
                  onExtend={onExtend}
                />
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(RENOUNCE_WARNING)) onRenounce();
                  }}
                  className="btn btn-ghost btn-sm"
                  title="Keep the tokens locked but hand everything this lock would earn to the other lockers"
                >
                  {busy === `renounce-${key}` ? "Working…" : "Give up earnings"}
                </button>
              </>
            )}
            <button type="button" disabled={busy !== null} onClick={() => setConfirming(true)} className="btn btn-ghost btn-sm">
              {busy === `extend-${key}` ? "Extending…" : "Break the lock"}
            </button>
          </>
        )}
        {matured && (forfeiting || payoutBlocked) ? (
          <span className="basis-full text-[11.5px] leading-relaxed text-muted">
            {payoutBlocked && !forfeiting
              ? `The unlock was refused because ${quote?.symbol ?? "the pair asset"}'s issuer has frozen or paused it, so its rewards can't be paid out right now. `
              : ""}
            Withdrawing without rewards returns all {amountLabel} of your coins with no burn and moves no{" "}
            {quote?.symbol ?? "pair asset"}; the {pendingLabel} this lock has earned goes to the other lockers instead.
            This can&apos;t be undone — use it only if a normal unlock fails.
          </span>
        ) : null}
        {!matured ? (
          <span className="basis-full text-[11.5px] leading-relaxed text-muted sm:basis-auto">
            {confirming ? "This can't be undone. It " : "Breaking it now "}
            burns {burnLabel ? `${burnLabel} of your ${amountLabel}` : "part of your principal"} and forfeits{" "}
            {pendingLabel} to the lockers who stayed.
          </span>
        ) : null}
      </div>
      )}

      {canCompound ? (
        <div className="mt-4 rounded-[10px] border border-line bg-ink-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={position.autoCompound}
              aria-label="Auto-compound"
              disabled={busy !== null}
              onClick={() => onSetAutoCompound(!position.autoCompound)}
              className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-60 ${
                position.autoCompound ? "border-mint/60 bg-mint/30" : "border-line-strong bg-ink-4"
              }`}
            >
              <span
                className={`inline-block size-[16px] rounded-full transition-transform duration-200 ${
                  position.autoCompound ? "translate-x-[20px] bg-mint" : "translate-x-[2px] bg-muted"
                }`}
              />
            </button>
            <span className="text-[13px] font-semibold text-fg">
              {busy === `auto-${key}` ? "Saving…" : "Auto-compound"}
              <span className="ml-1.5 font-normal text-muted">{position.autoCompound ? "on" : "off"}</span>
            </span>
            <button
              type="button"
              disabled={busy !== null || !enoughToCompound}
              onClick={onCompound}
              className="btn btn-ghost btn-sm ml-auto"
              title={
                enoughToCompound
                  ? `Buy ${ticker} with this lock's ${pendingLabel} and add it to the lock`
                  : `Needs at least ${quote ? `${formatAmount(MIN_COMPOUND_QUOTE, quote.decimals)} ${quote.symbol}` : "a little"} earned`
              }
            >
              {busy === `compound-${key}`
                ? "Compounding…"
                : enoughToCompound
                  ? `Compound now · ≈ ${formatTokenAmount(compoundEstimate!, position.decimals)} ${ticker}`
                  : "Compound now"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Your {quote?.symbol ?? "pair asset"} rewards automatically buy more {ticker} and add to this lock. Optional,
            turn off any time.{" "}
            {position.autoCompound
              ? "It runs on its own once about $0.50 has built up, at most every 30 minutes; the unlock date stays the same."
              : "Same unlock date, same multiplier, a bigger lock earning a bigger share."}
          </p>
        </div>
      ) : null}

      {position.forever ? null : sealing ? (
        <div className="mt-4 rounded-[10px] border border-rose/40 bg-rose/10 p-4">
          <p className="text-[12.5px] leading-relaxed text-rose">
            Lock {amountLabel} forever? It can never be unlocked, broken or withdrawn — not at maturity, not by you, not by
            anyone. It stops earning now: the {pendingLabel} it has built up and everything it would earn go to the other
            lockers. Claim first if you want what is unclaimed. This cannot be undone. Type {FOREVER_WORD} to confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={`Type ${FOREVER_WORD}`}
              aria-label={`Type ${FOREVER_WORD} to confirm`}
              className="input num w-36 text-[14px]"
              autoFocus
            />
            <button
              type="button"
              disabled={busy !== null || typed.trim().toUpperCase() !== FOREVER_WORD}
              onClick={() => {
                setSealing(false);
                setTyped("");
                onLockForever();
              }}
              className="btn btn-danger btn-sm"
            >
              Lock {amountLabel} forever
            </button>
            <button
              type="button"
              onClick={() => {
                setSealing(false);
                setTyped("");
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setSealing(true)}
          className="mt-3 text-[11.5px] text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
          title={FOREVER_TOOLTIP}
        >
          {busy === `forever-${key}` ? "Locking forever…" : "Lock forever"}
        </button>
      )}
    </article>
  );
}
