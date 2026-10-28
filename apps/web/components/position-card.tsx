"use client";

import { formatDuration, formatMultiplier, formatPercent, formatTokenAmount, shortAddress } from "@imagine/sdk";
import Link from "next/link";
import { useState } from "react";
import type { PortfolioPosition } from "@/lib/api";
import { formatAmount, usdSuffix } from "@/lib/format";
import { ExtendControl } from "./extend-control";
import { QuoteLogo } from "./pair-pill";

const RENOUNCE_WARNING =
  "Give up this lock's earnings for good? Your tokens stay locked until the same date, but it will never earn again: what it has built up and everything it would earn goes to the other lockers. Claim first if you want what is unclaimed. This cannot be undone.";

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
}) {
  const [confirming, setConfirming] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
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
          <p className="num mt-0.5 text-[12px] text-muted">
            {amountLabel} locked ·{" "}
            {position.renounced
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
        </div>
      </div>

      <div className="mt-4">
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
      </div>

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
    </article>
  );
}
