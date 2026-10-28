"use client";

import { exactAmount, formatTokenAmount, shortAddress } from "@imagine/sdk";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { api, type Holding } from "@/lib/api";
import { decimalInput, parseAmount } from "@/lib/format";
import { CHAIN_CHANGED, useActor } from "@/lib/signer";

type BurnableHolding = Pick<Holding, "mint" | "amount" | "decimals" | "symbol" | "name">;

/** What has to be typed to arm the burn, so it is never one stray click. */
const CONFIRM_WORD = "BURN";

/**
 * Burn some of a wallet's unlocked IMAGINE coins: a Token-2022 BurnChecked
 * from the wallet's own account, for exactly the amount typed. Burned coins
 * are gone for good and shrink the supply; locked coins are not offered.
 * Arming it takes a typed confirmation that names the amount.
 */
export function BurnPanel({
  holdings,
  busy,
  burn,
}: {
  holdings: BurnableHolding[];
  busy: string | null;
  burn: (mint: string, amount: bigint) => Promise<void>;
}) {
  const [mint, setMint] = useState(holdings[0]?.mint ?? "");
  const [amount, setAmount] = useState("");
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState("");

  const holding = holdings.find((h) => h.mint === mint) ?? holdings[0] ?? null;
  if (!holding) return null;
  const max = BigInt(holding.amount);
  const parsed = parseAmount(amount, holding.decimals);
  const symbol = holding.symbol ?? shortAddress(holding.mint);
  const label = `${formatTokenAmount(parsed, holding.decimals)} $${symbol}`;
  const valid = parsed > 0n && parsed <= max;

  const reset = () => {
    setArming(false);
    setTyped("");
  };

  return (
    <section className="card p-6">
      <h2 className="t-h3">Burn</h2>
      <p className="mt-1 text-[12.5px] text-muted">
        Destroy coins you hold, for good. Burned coins leave the supply forever; nobody can bring them back. Locked coins
        can&apos;t be burned here.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <select
          value={holding.mint}
          onChange={(event) => {
            setMint(event.target.value);
            setAmount("");
            reset();
          }}
          className="input text-[14px]"
          aria-label="Coin to burn"
        >
          {holdings.map((h) => (
            <option key={h.mint} value={h.mint}>
              ${h.symbol ?? shortAddress(h.mint)}
            </option>
          ))}
        </select>
        <div className="relative">
          <input
            value={amount}
            inputMode="decimal"
            onChange={(event) => {
              setAmount(decimalInput(event.target.value));
              reset();
            }}
            placeholder="Amount to burn"
            aria-label="Amount to burn"
            className="input num pr-14 text-[14px]"
          />
          <button
            type="button"
            onClick={() => {
              setAmount(exactAmount(max, holding.decimals));
              reset();
            }}
            className="num absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-steel-hi"
          >
            MAX
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {arming ? (
          <>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={`Type ${CONFIRM_WORD}`}
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
              className="input num w-32 text-[14px]"
              autoFocus
            />
            <button
              type="button"
              disabled={busy !== null || !valid || typed.trim().toUpperCase() !== CONFIRM_WORD}
              onClick={() =>
                void burn(holding.mint, parsed).then(() => {
                  setAmount("");
                  reset();
                })
              }
              className="btn btn-danger btn-sm"
            >
              {busy === "burn" ? "Burning…" : `Burn ${label} forever`}
            </button>
            <button type="button" onClick={reset} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <span className="basis-full text-[11.5px] leading-relaxed text-rose">
              This destroys {label} permanently. It cannot be undone and nobody, including Imagine, can return them.
            </span>
          </>
        ) : (
          <button type="button" disabled={busy !== null || !valid} onClick={() => setArming(true)} className="btn btn-ghost btn-sm">
            Burn…
          </button>
        )}
        <span className="num text-[12px] text-muted">
          Unlocked {formatTokenAmount(max, holding.decimals)} ${symbol}
        </span>
      </div>
    </section>
  );
}

/**
 * The burn panel for an extension wallet: its unlocked IMAGINE coins read
 * from the API, the burn built by the API and checked by `signAndSend`
 * against exactly the coin and amount typed before the wallet sees it.
 */
export function WalletBurnPanel() {
  const actor = useActor();
  const owner = actor.publicKey?.toBase58() ?? null;
  const [holdings, setHoldings] = useState<BurnableHolding[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      setHoldings((await api.holdings(owner)).holdings);
    } catch {
      // No holdings to show; the panel stays hidden.
    }
  }, [owner]);

  useEffect(() => {
    void refresh();
    window.addEventListener(CHAIN_CHANGED, refresh);
    return () => window.removeEventListener(CHAIN_CHANGED, refresh);
  }, [refresh]);

  const burn = useCallback(
    async (mint: string, amount: bigint) => {
      setBusy("burn");
      setError(null);
      try {
        await actor.act(
          { kind: "burn", mint, amount: amount.toString() },
          { kind: "burn", mint: new PublicKey(mint), amount },
        );
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "burn failed");
        throw cause;
      } finally {
        setBusy(null);
      }
    },
    [actor, refresh],
  );

  if (holdings.length === 0) return null;
  return (
    <div className="mt-6 space-y-3">
      {error ? (
        <p className="break-words rounded-[10px] border border-rose/40 bg-rose/10 px-5 py-3 text-[13px] text-rose">{error}</p>
      ) : null}
      <BurnPanel holdings={holdings} busy={busy} burn={(mint, amount) => burn(mint, amount).catch(() => undefined)} />
    </div>
  );
}
