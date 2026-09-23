"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { formatPercent, formatTokenAmount } from "@vise/sdk";
import { useCallback, useMemo, useState } from "react";
import { post } from "@/lib/api";
import { signAndSend, type BuiltTransaction } from "@/lib/send";
import { LockDial } from "./lock-dial";

interface LaunchPlan {
  mint: string;
  pool: string;
  expectedTokens: string;
  transactions: BuiltTransaction[];
}

type Phase = "idle" | "signing" | "done" | "error";

export function LaunchForm() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [devBuy, setDevBuy] = useState("1");
  const [lockPercent, setLockPercent] = useState(50);
  const [lockDays, setLockDays] = useState(90);
  const [creatorShare, setCreatorShare] = useState(10);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<{ mint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The mint is a fresh keypair the browser generates and signs with. It never
  // leaves this page; the API only ever sees the public key.
  const mintKeypair = useMemo(() => Keypair.generate(), []);

  const devBuyLamports = (() => {
    const parsed = Number(devBuy);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.floor(parsed * LAMPORTS_PER_SOL));
  })();

  const valid =
    name.trim().length > 0 &&
    symbol.trim().length > 0 &&
    uri.trim().length > 0 &&
    devBuyLamports > 0n;

  const launch = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setPhase("signing");
    setError(null);
    setProgress([]);

    const request = {
      creator: wallet.publicKey.toBase58(),
      mint: mintKeypair.publicKey.toBase58(),
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      uri: uri.trim(),
      devBuyLamports: devBuyLamports.toString(),
      lockPercent,
      lockDurationDays: lockDays,
      creatorShareBps: creatorShare * 100,
    };

    const run = async (plan: LaunchPlan, mintSigns: boolean) => {
      for (const built of plan.transactions) {
        const label = built.label ?? "Transaction";
        setProgress((prev) => [...prev, `${label}…`]);
        const signature = await signAndSend(
          connection,
          wallet,
          built,
          mintSigns ? [mintKeypair] : [],
        );
        setProgress((prev) => [...prev.slice(0, -1), `${label} — ${signature.slice(0, 12)}…`]);
      }
    };

    try {
      // Stage one creates the mint, so the mint keypair signs it. Stage two is
      // priced against the curve that stage one just created, which is why it
      // is fetched only after the first signature confirms.
      await run(await post<LaunchPlan>("/api/tx/launch", { ...request, stage: "create" }), true);
      await run(await post<LaunchPlan>("/api/tx/launch", { ...request, stage: "finish" }), false);

      setResult({ mint: mintKeypair.publicKey.toBase58() });
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "launch failed");
      setPhase("error");
    }
  }, [
    connection,
    creatorShare,
    devBuyLamports,
    lockDays,
    lockPercent,
    mintKeypair,
    name,
    symbol,
    uri,
    wallet,
  ]);

  if (phase === "done" && result) {
    return (
      <section className="panel mt-10 p-8">
        <h2 className="text-[22px]">Clamped and live.</h2>
        <p className="mt-3 text-[14px] text-steel-400">
          Your coin is trading on pump.fun and its fee stream is permanently
          pointed at its lock pool.
        </p>
        <p className="num mt-4 break-all text-[12px] text-steel-500">{result.mint}</p>
        <a href={`/coins/${result.mint}`} className="btn btn-primary mt-6">
          Open the coin page
        </a>
      </section>
    );
  }

  return (
    <div className="mt-10 space-y-5">
      <section className="panel p-6">
        <h2 className="rule-label">The coin</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={setName} placeholder="Tungsten Cube" maxLength={32} />
          <Field
            label="Ticker"
            value={symbol}
            onChange={(v) => setSymbol(v.toUpperCase())}
            placeholder="CUBE"
            maxLength={13}
          />
        </div>
        <div className="mt-4">
          <Field
            label="Metadata URI"
            value={uri}
            onChange={setUri}
            placeholder="https://ipfs.io/ipfs/…"
            maxLength={200}
          />
          <p className="mt-1.5 text-[12px] text-steel-600">
            The JSON document pump.fun reads for the name, image and socials.
            Upload it anywhere public — IPFS, Arweave, your own host.
          </p>
        </div>
      </section>

      <section className="panel p-6">
        <h2 className="rule-label">Your position</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="devbuy" className="text-[13px] text-steel-400">
              Dev buy (SOL)
            </label>
            <input
              id="devbuy"
              inputMode="decimal"
              value={devBuy}
              onChange={(event) => setDevBuy(event.target.value.replace(/[^\d.]/g, ""))}
              className="num mt-2 w-full rounded-machined border border-steel-700 bg-steel-950 px-3 py-2.5 text-[16px] text-steel-50 outline-none focus:border-torch"
            />
          </div>
          <div>
            <label htmlFor="creator-share" className="text-[13px] text-steel-400">
              Your share of fees: {creatorShare}%
            </label>
            <input
              id="creator-share"
              type="range"
              min={0}
              max={30}
              value={creatorShare}
              onChange={(event) => setCreatorShare(Number(event.target.value))}
              className="mt-4 w-full accent-[var(--color-torch)]"
            />
            <p className="mt-1 text-[12px] text-steel-600">
              Capped at 30%. Lockers receive{" "}
              {formatPercent(0.8 * (1 - creatorShare / 100), 0)} of every fee.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <label htmlFor="lock-pct" className="text-[13px] text-steel-400">
            Lock {lockPercent}% of your dev buy
          </label>
          <input
            id="lock-pct"
            type="range"
            min={10}
            max={100}
            value={lockPercent}
            onChange={(event) => setLockPercent(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--color-torch)]"
          />
          <p className="mt-1.5 text-[12px] text-steel-600">
            A pool cannot open without the creator locking. This is the part that
            makes your launch legible: everyone can see what you committed and
            for how long.
          </p>
        </div>

        <div className="mt-6">
          <LockDial
            days={lockDays}
            onChange={setLockDays}
            min={7}
            max={365}
            presets={[7, 30, 90, 180, 365]}
          />
        </div>
      </section>

      {wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void launch()}
          disabled={!valid || phase === "signing"}
          className="btn btn-primary w-full"
        >
          {phase === "signing" ? "Signing…" : "Launch the coin"}
        </button>
      ) : (
        <p className="panel px-5 py-4 text-center text-[13px] text-steel-500">
          Connect a wallet to launch
        </p>
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
        <p className="rounded-machined border border-rust/40 bg-rust/10 px-5 py-4 text-[13px] text-rust">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
}) {
  return (
    <div>
      <label className="text-[13px] text-steel-400">{label}</label>
      <input
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-machined border border-steel-700 bg-steel-950 px-3 py-2.5 text-[15px] text-steel-50 outline-none placeholder:text-steel-600 focus:border-torch"
      />
    </div>
  );
}
