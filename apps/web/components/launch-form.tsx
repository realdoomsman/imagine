"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { formatTokenAmount } from "@vise/sdk";
import { useCallback, useMemo, useState } from "react";
import { api, post } from "@/lib/api";
import { signAndSend, type BuiltTransaction } from "@/lib/send";
import { useAccount } from "./account-provider";
import { LockDial } from "./lock-dial";
import { SignInPrompt } from "./sign-in-prompt";

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
  const { account } = useAccount();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [devBuy, setDevBuy] = useState("1");
  const [lockPercent, setLockPercent] = useState(50);
  const [lockDays, setLockDays] = useState(90);
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
    setPhase("signing");
    setError(null);
    setProgress([]);

    const request = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      uri: uri.trim(),
      devBuyLamports: devBuyLamports.toString(),
      lockPercent,
      lockDurationDays: lockDays,
    };

    try {
      if (account) {
        // A VISE account launches server-side: the API generates the mint,
        // signs all four transactions with the account's wallet, and reports
        // each one back.
        setProgress(["Launching from your VISE wallet…"]);
        const done = await api.launchFromAccount(request);
        setProgress(done.signatures.map((s) => `${s.label} — ${s.signature.slice(0, 12)}…`));
        setResult({ mint: done.mint });
        setPhase("done");
        return;
      }

      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("connect a wallet or sign in first");
      }
      const creator = wallet.publicKey.toBase58();
      const mint = mintKeypair.publicKey.toBase58();
      const run = async (plan: LaunchPlan, mintSigns: boolean) => {
        for (const built of plan.transactions) {
          const label = built.label ?? "Transaction";
          setProgress((prev) => [...prev, `${label}…`]);
          const signature = await signAndSend(connection, wallet, built, mintSigns ? [mintKeypair] : []);
          setProgress((prev) => [...prev.slice(0, -1), `${label} — ${signature.slice(0, 12)}…`]);
        }
      };
      // Stage one creates the mint, so the mint keypair signs it. Stage two is
      // priced against the curve that stage one just created, which is why it
      // is fetched only after the first signature confirms.
      await run(await post<LaunchPlan>("/api/tx/launch", { ...request, creator, mint, stage: "create" }), true);
      await run(await post<LaunchPlan>("/api/tx/launch", { ...request, creator, mint, stage: "finish" }), false);
      setResult({ mint });
      setPhase("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "launch failed");
      setPhase("error");
    }
  }, [account, connection, devBuyLamports, lockDays, lockPercent, mintKeypair, name, symbol, uri, wallet]);

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

  // Custom properties are legal in a style object but absent from CSSProperties.
  const lockFill: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${((lockPercent - 10) / 90) * 100}%`,
  };

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
              className="input num mt-2 text-[16px]"
            />
          </div>
          <div className="rounded-machined border border-steel-780 bg-steel-950/60 px-4 py-3">
            <p className="rule-label">Where the fees go</p>
            <p className="num mt-2 text-[15px] text-steel-50">90% lockers · 10% treasury · 0% creator</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-steel-500">
              You earn the same way everyone does: by locking. Your founding
              lock below is your position from block one.
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
            className="vise-range mt-3 w-full"
            style={lockFill}
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

      {account || wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void launch()}
          disabled={!valid || phase === "signing"}
          className="btn btn-primary w-full"
        >
          {phase === "signing" ? "Signing…" : "Launch the coin"}
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
        className="input mt-2 text-[15px]"
      />
    </div>
  );
}
