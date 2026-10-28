"use client";

import { exactAmount, formatTokenAmount } from "@imagine/sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useState } from "react";
import type { QuoteInfo } from "@/lib/api";
import { LAUNCHLAB_PROTOCOL_FEE_BPS } from "@/lib/fees";
import { decimalInput, formatAmount, formatBps, formatNumber, formatQuote, parseAmount, usdSuffix } from "@/lib/format";
import { useActor } from "@/lib/signer";
import { useTokenBalance } from "@/lib/use-token-balance";
import { QuoteLogo } from "./pair-pill";
import { SignInPrompt } from "./sign-in-prompt";
import { ReauthNotice, reauthMessage } from "./reauth-notice";

/** Lamports a "max" SOL spend leaves behind for fees and token-account rent. */
const SOL_FEE_RESERVE = 10_000_000n;
const SLIPPAGE_OPTIONS = [100, 300, 500] as const;
const SOL: Pick<QuoteInfo, "symbol" | "decimals" | "logoUrl" | "usdPrice"> = {
  symbol: "SOL",
  decimals: 9,
  logoUrl: null,
  usdPrice: null,
};

/**
 * Buy and sell in the coin's pair asset, with the Imagine fee attached.
 *
 * On the bonding curve the trade goes through Raydium LaunchLab; after
 * migration through the Raydium pool. Every trade pays the coin's on-chain
 * pool fee wherever it happens; through here it also pays the Imagine app fee
 * into the same pool. Both are shown before signing, in the pair asset. A
 * buyer without the pair asset can pay in SOL, swapped into it first.
 */
export function SwapPanel({
  mint,
  symbol,
  coinDecimals,
  coinTokenProgram,
  quote,
  priceQuote,
  tradeFeeBps,
  poolFeeBps,
  migrating,
  raydiumUrl,
}: {
  mint: string;
  symbol: string;
  coinDecimals: number;
  coinTokenProgram: string;
  quote: QuoteInfo;
  /** Pair units per whole coin at spot; null when unknown. */
  priceQuote: number | null;
  /** Imagine app fee into the pool, bps. */
  tradeFeeBps: number;
  /** The on-chain trading fee Raydium LaunchLab sends to the pool, bps. */
  poolFeeBps: number;
  /** Between curve and Raydium pool: nothing can trade for a moment. */
  migrating: boolean;
  /** The coin's Raydium launchpad page. */
  raydiumUrl: string;
}) {
  const actor = useActor();
  const nativeQuote = quote.mint === NATIVE_MINT.toBase58();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payWithSol, setPayWithSol] = useState(false);
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(300);
  const [status, setStatus] = useState<{ ok: boolean; text: string; reauth?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const coinHeld = useTokenBalance(mint, coinTokenProgram, actor.publicKey);
  const quoteHeld = useTokenBalance(quote.mint, quote.tokenProgram, actor.publicKey);
  const solHeld = useTokenBalance(NATIVE_MINT.toBase58(), TOKEN_PROGRAM_ID.toBase58(), actor.publicKey);

  const solPays = side === "buy" && payWithSol && !nativeQuote;
  const payAsset = side === "sell" ? null : solPays ? SOL : quote;
  const inputDecimals = side === "sell" ? coinDecimals : solPays ? 9 : quote.decimals;
  const held = side === "sell" ? coinHeld : solPays ? solHeld : quoteHeld;
  const amount = parseAmount(input, inputDecimals);

  // The fee is a share of the pair-asset leg: what is spent on a buy, what
  // comes back on a sell (estimated at spot; the chain settles the exact figure).
  const quoteLeg =
    side === "buy"
      ? solPays
        ? null
        : amount
      : priceQuote !== null
        ? BigInt(Math.floor((Number(amount) / 10 ** coinDecimals) * priceQuote * 10 ** quote.decimals))
        : null;
  const fee = quoteLeg !== null ? (quoteLeg * BigInt(tradeFeeBps)) / 10_000n : null;
  const expectedOut =
    priceQuote === null || priceQuote <= 0 || quoteLeg === null || fee === null
      ? null
      : side === "buy"
        ? Number(quoteLeg - fee) / 10 ** quote.decimals / priceQuote
        : Number(quoteLeg - fee) / 10 ** quote.decimals;

  const submit = useCallback(async () => {
    if (!actor.publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const signature = await actor.act(
        {
          kind: "swap",
          mint,
          side,
          amount: amount.toString(),
          slippageBps,
          ...(solPays ? { payWithSol: true } : {}),
        },
        {
          kind: "trade",
          mint: new PublicKey(mint),
          side,
          amountIn: amount,
          payWithSol: solPays,
          slippageBps,
          tradeFeeBps,
          appFee: fee,
          expectedOut:
            expectedOut === null
              ? null
              : BigInt(Math.floor(expectedOut * 10 ** (side === "buy" ? coinDecimals : quote.decimals))),
        },
      );
      setStatus({
        ok: true,
        text:
          fee !== null && fee > 0n
            ? `Done. ${formatQuote(fee, quote)} went into this coin's pool. ${signature.slice(0, 12)}…`
            : `Done. ${formatBps(tradeFeeBps)} of the ${quote.symbol} leg went into this coin's pool. ${signature.slice(0, 12)}…`,
      });
      setInput("");
    } catch (error) {
      const again = reauthMessage(error);
      setStatus(again ? { ok: false, text: again, reauth: true } : { ok: false, text: error instanceof Error ? error.message : "swap failed" });
    } finally {
      setBusy(false);
    }
  }, [actor, amount, coinDecimals, expectedOut, fee, mint, quote, side, slippageBps, solPays, tradeFeeBps]);

  if (migrating) {
    return (
      <section className="card p-6">
        <h2 className="t-h3">Migrating to Raydium</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-soft">
          The curve has filled and the coin is moving to its Raydium pool. Trading reopens here as soon as the pool is
          live; locks and claims keep working throughout.
        </p>
        <a href={raydiumUrl} target="_blank" rel="noreferrer" className="btn btn-ghost mt-4 w-full">
          Follow it on Raydium ↗
        </a>
      </section>
    );
  }

  const insufficient = held !== null && amount > held;

  return (
    <section className="card p-6">
      <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-ink-1 p-1">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSide(option);
              setInput("");
              setStatus(null);
            }}
            aria-pressed={side === option}
            className={`h-9 rounded-[7px] text-[13.5px] font-semibold capitalize transition-colors ${
              side === option
                ? option === "buy"
                  ? "bg-mint text-ink"
                  : "bg-rose text-ink"
                : "text-muted hover:text-fg"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {side === "buy" && !nativeQuote ? (
        <div className="mt-4 flex items-center gap-1.5 text-[12px]">
          <span className="text-muted">Pay with</span>
          {[false, true].map((sol) => (
            <button
              key={String(sol)}
              type="button"
              onClick={() => {
                setPayWithSol(sol);
                setInput("");
              }}
              aria-pressed={payWithSol === sol}
              className={`pill num cursor-pointer ${payWithSol === sol ? "pill-steel" : "hover:border-line-strong hover:text-fg"}`}
            >
              {sol ? "SOL" : quote.symbol}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="swap-amount" className="eyebrow">
            {side === "buy" ? "You pay" : "You sell"}
          </label>
          <span className="num text-[12px] text-muted">
            {held === null
              ? ""
              : side === "sell"
                ? `${formatTokenAmount(held, coinDecimals)} $${symbol} held`
                : `${formatAmount(held, inputDecimals)} ${payAsset!.symbol} held`}
          </span>
        </div>
        <div className="relative mt-2">
          <input
            id="swap-amount"
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(decimalInput(event.target.value))}
            placeholder="0"
            className="input num pr-28 text-[18px]"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[13px] text-fg-soft">
            {payAsset ? <QuoteLogo quote={payAsset} size={16} /> : null}
            <span className="num">{payAsset ? payAsset.symbol : `$${symbol}`}</span>
          </span>
        </div>
        {held !== null ? (
          <div className="mt-2 flex gap-1.5">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={held === 0n}
                onClick={() => {
                  // Spending SOL keeps a little back for network fees and new token accounts.
                  const reserve = side === "buy" && (solPays || nativeQuote) ? SOL_FEE_RESERVE : 0n;
                  const spendable = held > reserve ? held - reserve : 0n;
                  setInput(exactAmount((spendable * BigInt(pct)) / 100n, inputDecimals));
                }}
                className="pill num flex-1 cursor-pointer justify-center hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pct === 100 ? "Max" : `${pct}%`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="well mt-4 space-y-2 px-4 py-3 text-[12.5px]">
        <Row label="You get (at spot)">
          {amount <= 0n
            ? "—"
            : expectedOut === null
              ? side === "buy" && solPays
                ? `$${symbol} for the ${quote.symbol} your SOL buys`
                : "—"
              : side === "buy"
                ? `≈ ${formatNumber(expectedOut)} $${symbol}`
                : `≈ ${formatNumber(expectedOut)} ${quote.symbol}`}
        </Row>
        <Row label={`Imagine fee (${formatBps(tradeFeeBps)})`} accent>
          {amount <= 0n
            ? "—"
            : fee !== null
              ? `${formatQuote(fee, quote)}${usdSuffix(fee, quote) ? ` · ${usdSuffix(fee, quote)}` : ""}`
              : `${formatBps(tradeFeeBps)} of the ${quote.symbol} leg`}
        </Row>
        <Row label="On-chain pool fee" accent>
          {formatBps(poolFeeBps)} to the pool
        </Row>
        <Row label="Max slippage">
          <span className="flex gap-1">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => setSlippageBps(bps)}
                aria-pressed={slippageBps === bps}
                className={`num rounded-[6px] px-1.5 py-0.5 text-[11.5px] transition-colors ${
                  slippageBps === bps ? "bg-steel text-ink" : "text-muted hover:text-fg"
                }`}
              >
                {bps / 100}%
              </button>
            ))}
          </span>
        </Row>
      </dl>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
        Both fees go into this coin&apos;s pool, paid in {quote.symbol} — {formatBps(poolFeeBps + tradeFeeBps)} in all
        through Imagine; the creator earns nothing from them. If the trade fails, nothing is taken. Raydium
        LaunchLab&apos;s {formatBps(LAUNCHLAB_PROTOCOL_FEE_BPS)} protocol fee applies on the curve.
        {solPays ? ` Your SOL is swapped to ${quote.symbol} through Jupiter first.` : ""}
      </p>

      {actor.publicKey ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || amount <= 0n || insufficient}
          className={`btn mt-4 w-full ${side === "buy" ? "btn-primary" : "btn-danger"}`}
        >
          {busy
            ? "Submitting…"
            : insufficient
              ? `Not enough ${side === "sell" ? `$${symbol}` : payAsset!.symbol}`
              : side === "buy"
                ? `Buy $${symbol}`
                : `Sell $${symbol}`}
        </button>
      ) : (
        <div className="mt-4">
          <SignInPrompt what="trade" />
        </div>
      )}

      {status?.reauth ? (
        <ReauthNotice message={status.text} className="mt-3" />
      ) : status ? (
        <p className={`mt-3 break-all text-[12px] ${status.ok ? "text-mint" : "text-rose"}`}>{status.text}</p>
      ) : null}
    </section>
  );
}

function Row({ label, accent = false, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`num min-w-0 truncate text-right ${accent ? "text-mint" : "text-fg"}`}>{children}</dd>
    </div>
  );
}
