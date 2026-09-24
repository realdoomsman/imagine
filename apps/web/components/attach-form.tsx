"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { DAY, ECONOMICS } from "@vise/sdk";
import { useCallback, useState } from "react";
import { api, post } from "@/lib/api";
import { signAndSend, type BuiltTransaction } from "@/lib/send";
import { useAccount } from "./account-provider";
import { LockDial } from "./lock-dial";
import { SignInPrompt } from "./sign-in-prompt";

interface AttachPlan {
  mint: string;
  pool: string;
  lockAmount: string;
  transactions: BuiltTransaction[];
}

type Phase = "idle" | "signing" | "done" | "error";

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Bring a coin launched directly on pump.fun onto VISE: the launching wallet
 * opens the pool with its founding lock and routes the creator fees to it.
 */
export function AttachForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { account } = useAccount();

  const [mint, setMint] = useState("");
  const [lockPercent, setLockPercent] = useState(50);
  const [lockSeconds, setLockSeconds] = useState(30 * DAY);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<{ mint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = mint.trim();
  const valid = BASE58_MINT.test(trimmed);

  const attach = useCallback(async () => {
    if (!valid) return;
    setPhase("signing");
    setError(null);
    setProgress([`Bringing ${trimmed.slice(0, 6)}… to VISE`]);
    const request = { mint: trimmed, lockPercent, lockDurationSecs: lockSeconds };

    try {
      if (account) {
        // The API signs each step with the account's wallet and reports back.
        setProgress((prev) => [...prev, "Signing from your VISE wallet…"]);
        const done = await api.attachFromAccount(request);
        setProgress((prev) => [prev[0], ...done.signatures.map((s) => `${s.label} — ${s.signature.slice(0, 12)}…`)]);
        setResult({ mint: done.mint });
        setPhase("done");
        return;
      }

      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("connect a wallet or sign in first");
      }
      // Order is load-bearing: the pool opens before the fee routing rewrites
      // the curve's creator field, so these are signed one after another.
      const plan = await post<AttachPlan>("/api/tx/attach", { ...request, creator: wallet.publicKey.toBase58() });
      for (const built of plan.transactions) {
        const label = built.label ?? "Transaction";
        setProgress((prev) => [...prev, `${label}…`]);
        const signature = await signAndSend(connection, wallet, built);
        setProgress((prev) => [...prev.slice(0, -1), `${label} — ${signature.slice(0, 12)}…`]);
      }
      setResult({ mint: plan.mint });
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "bringing the coin over failed");
      setPhase("error");
    }
  }, [account, connection, lockPercent, lockSeconds, trimmed, valid, wallet]);

  if (phase === "done" && result) {
    return (
      <section className="panel mt-10 p-8">
        <h2 className="text-[22px]">Clamped.</h2>
        <p className="mt-3 text-[14px] text-steel-400">
          The pool is open with your founding lock, and the coin&apos;s creator
          fees are permanently pointed at its lockers.
        </p>
        <p className="num mt-4 break-all text-[12px] text-steel-500">{result.mint}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`/coins/${result.mint}`} className="btn btn-primary">
            Open the coin page
          </a>
        </div>
      </section>
    );
  }

  // Custom properties are legal in a style object but absent from CSSProperties.
  const lockFill: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${((lockPercent - 10) / 90) * 100}%`,
  };

  return (
    <div className="mt-10 space-y-5">
      <section className="panel p-6">
        <h2 className="rule-label">Already launched on pump.fun?</h2>
        <p className="mt-4 text-[13px] leading-relaxed text-steel-400">
          Bring it here. It must be done from the same wallet or account that
          launched the coin, and pump.fun fee sharing must not have been turned
          on for it — that setting is permanent. The pool opens with your
          founding lock, and the coin&apos;s creator fees go to its lockers for
          good: 90% lockers · 10% treasury · 0% creator.
        </p>

        <div className="mt-4">
          <label htmlFor="attach-mint" className="text-[13px] text-steel-400">
            Coin mint address
          </label>
          <input
            id="attach-mint"
            value={mint}
            onChange={(event) => setMint(event.target.value)}
            placeholder="…pump"
            spellCheck={false}
            autoComplete="off"
            className="input num mt-2 text-[14px]"
          />
          {trimmed.length > 0 && !valid ? (
            <p className="mt-1.5 text-[12px] text-rust">That is not a Solana address.</p>
          ) : null}
        </div>

        <div className="mt-6">
          <label htmlFor="attach-lock-pct" className="text-[13px] text-steel-400">
            Lock {lockPercent}% of your current holding
          </label>
          <input
            id="attach-lock-pct"
            type="range"
            min={10}
            max={100}
            value={lockPercent}
            onChange={(event) => setLockPercent(Number(event.target.value))}
            className="vise-range mt-3 w-full"
            style={lockFill}
          />
        </div>

        <div className="mt-6">
          <LockDial
            seconds={lockSeconds}
            onChange={setLockSeconds}
            min={ECONOMICS.minLockSecs}
            max={ECONOMICS.maxLockSecs}
          />
        </div>
      </section>

      {account || wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void attach()}
          disabled={!valid || phase === "signing"}
          className="btn btn-primary w-full"
        >
          {phase === "signing" ? "Signing…" : "Bring it to VISE"}
        </button>
      ) : (
        <SignInPrompt what="launch" />
      )}

      {progress.length > 0 ? (
        <ol className="panel space-y-2 p-5 text-[12px]">
          {progress.map((line) => (
            <li key={line} className="num text-steel-400">
              {line}
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <div className="rounded-machined border border-rust/40 bg-rust/10 px-5 py-4 text-[13px] text-rust">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
