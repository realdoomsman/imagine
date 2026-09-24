"use client";

import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ECONOMICS, appFeeLamports, exactAmount, formatSol, formatTokenAmount } from "@vise/sdk";
import { useCallback, useEffect, useState } from "react";
import { useActor } from "@/lib/signer";
import { SignInPrompt } from "./sign-in-prompt";

const PRESETS = [0.1, 0.5, 1, 5];

/**
 * Buy and sell through pump's bonding curve with the VISE fee attached.
 *
 * The fee is shown before the user signs, in SOL and as a percentage, and it is
 * named for what it is: the money that goes to this coin's lockers.
 */
export function SwapPanel({
  mint,
  symbol,
  priceLamports,
  graduated,
}: {
  mint: string;
  symbol: string;
  priceLamports: number;
  graduated: boolean;
}) {
  const actor = useActor();
  const { connection } = useConnection();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<bigint | null>(null);

  // What the signer holds of this coin, for the sell side's "available".
  useEffect(() => {
    if (!actor.publicKey) {
      setHeld(null);
      return;
    }
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), actor.publicKey, true, TOKEN_2022_PROGRAM_ID);
    let cancelled = false;
    void connection
      .getTokenAccountBalance(ata)
      .then((result) => {
        if (!cancelled) setHeld(BigInt(result.value.amount));
      })
      .catch(() => {
        if (!cancelled) setHeld(0n);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, mint, actor.publicKey, status]);

  const amount = (() => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return side === "buy"
      ? BigInt(Math.floor(parsed * LAMPORTS_PER_SOL))
      : BigInt(Math.floor(parsed * 1_000_000));
  })();

  const submit = useCallback(async () => {
    if (!actor.publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const signature = await actor.act({ kind: "swap", mint, side, amount: amount.toString() });
      const fee = side === "buy" ? appFeeLamports(amount, ECONOMICS.tradeFeeBps) : null;
      setStatus(
        fee !== null
          ? `Done. ${formatSol(fee)} SOL went to this coin's lockers. ${signature.slice(0, 12)}…`
          : `Done. 2% of the SOL went to this coin's lockers. ${signature.slice(0, 12)}…`,
      );
      setInput("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "swap failed");
    } finally {
      setBusy(false);
    }
  }, [actor, amount, mint, side]);

  if (graduated) {
    return (
      <section className="panel p-6">
        <h2 className="text-[17px]">Graduated</h2>
        <p className="mt-2 text-[13px] text-steel-500">
          This coin has left the bonding curve and trades on PumpSwap. Its lock
          pool keeps earning: creator fees from the AMM are swept into the same
          vault.
        </p>
        <a
          href={`https://pump.fun/coin/${mint}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost mt-4 w-full"
        >
          Trade on pump.fun
        </a>
      </section>
    );
  }

  // The fee is 2% of the SOL leg: what is spent on a buy, what comes back on
  // a sell (estimated from the spot price; the chain settles the exact figure).
  const solLeg = side === "buy" ? amount : BigInt(Math.round((Number(amount) / 1_000_000) * priceLamports));
  const estimatedFee = appFeeLamports(solLeg, ECONOMICS.tradeFeeBps);

  return (
    <section className="panel p-6">
      <div className="grid grid-cols-2 gap-px border border-steel-700 bg-steel-700">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSide(option)}
            className={`py-2 text-[13px] font-semibold uppercase tracking-wide transition-colors ${
              side === option
                ? option === "buy"
                  ? "bg-verdi/15 text-verdi"
                  : "bg-rust/15 text-rust"
                : "bg-steel-900 text-steel-500 hover:text-steel-300"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <input
        inputMode="decimal"
        value={input}
        onChange={(event) => setInput(event.target.value.replace(/[^\d.]/g, ""))}
        placeholder="0"
        aria-label={side === "buy" ? "SOL to spend" : `${symbol} to sell`}
        className="input num mt-4 text-[18px]"
      />
      <p className="mt-1.5 text-[12px] text-steel-600">
        {side === "buy" ? "SOL" : symbol}
        {priceLamports > 0 && side === "buy"
          ? ` · ~${formatSol(BigInt(Math.round(priceLamports)))} SOL per ${symbol}`
          : ""}
      </p>

      {side === "buy" ? (
        <div className="mt-3 flex gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setInput(String(preset))}
              className="num flex-1 rounded-machined border border-steel-700 py-1 text-[12px] text-steel-400 hover:border-steel-600/50 hover:text-steel-200"
            >
              {preset}
            </button>
          ))}
        </div>
      ) : held !== null ? (
        <div className="mt-3 flex items-center gap-1.5">
          {[25, 50, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              disabled={held === 0n}
              onClick={() => setInput(exactAmount((held * BigInt(pct)) / 100n, 6))}
              className="num flex-1 rounded-machined border border-steel-700 py-1 text-[12px] text-steel-400 hover:border-steel-600/50 hover:text-steel-200 disabled:opacity-40"
            >
              {pct === 100 ? "MAX" : `${pct}%`}
            </button>
          ))}
          <span className="num ml-2 text-[11.5px] text-steel-500">{formatTokenAmount(held, 6)} held</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-steel-860 pt-3 text-[12px]">
        <span className="text-steel-500">VISE fee (2%)</span>
        <span className="num text-torch">
          {amount > 0n ? `${formatSol(estimatedFee)} SOL` : "—"}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-steel-600">
        Goes straight into this coin&apos;s lock pool, in the same transaction.
        If the trade fails, the fee is never taken.
      </p>

      {actor.publicKey ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || amount <= 0n || (side === "sell" && held !== null && amount > held)}
          className="btn btn-primary mt-4 w-full"
        >
          {busy ? "Submitting…" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </button>
      ) : (
        <div className="mt-4">
          <SignInPrompt what="trade" />
        </div>
      )}

      {status ? (
        <p className="mt-3 break-all text-[12px] text-steel-400">{status}</p>
      ) : null}
    </section>
  );
}
