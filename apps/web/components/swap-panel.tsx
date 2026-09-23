"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { formatSol } from "@vise/sdk";
import { useCallback, useState } from "react";
import { post } from "@/lib/api";
import { signAndSend, type BuiltTransaction } from "@/lib/send";

const PRESETS = [0.1, 0.5, 1, 5];

interface SwapQuote extends BuiltTransaction {
  appFeeLamports: string;
  appFeeBps: number;
  solLegLamports: string;
}

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
  const { connection } = useConnection();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = (() => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return side === "buy"
      ? BigInt(Math.floor(parsed * LAMPORTS_PER_SOL))
      : BigInt(Math.floor(parsed * 1_000_000));
  })();

  const submit = useCallback(async () => {
    if (!wallet.publicKey) return;
    setBusy(true);
    setStatus(null);
    try {
      const quote = await post<SwapQuote>("/api/tx/swap", {
        user: wallet.publicKey.toBase58(),
        mint,
        side,
        amount: amount.toString(),
      });
      const signature = await signAndSend(connection, wallet, quote);
      setStatus(
        `Done. ${formatSol(BigInt(quote.appFeeLamports))} SOL went to this coin's lockers. ${signature.slice(0, 12)}…`,
      );
      setInput("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "swap failed");
    } finally {
      setBusy(false);
    }
  }, [amount, connection, mint, side, wallet]);

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

  const estimatedFee = (amount * 200n) / 10_000n;

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
              className="num flex-1 rounded-machined border border-steel-700 py-1 text-[12px] text-steel-400 hover:border-steel-500 hover:text-steel-200"
            >
              {preset}
            </button>
          ))}
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

      {wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || amount <= 0n}
          className="btn btn-primary mt-4 w-full"
        >
          {busy ? "Submitting…" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </button>
      ) : (
        <p className="mt-4 rounded-machined border border-steel-700 px-4 py-3 text-center text-[13px] text-steel-500">
          Connect a wallet to trade
        </p>
      )}

      {status ? (
        <p className="mt-3 break-all text-[12px] text-steel-400">{status}</p>
      ) : null}
    </section>
  );
}
