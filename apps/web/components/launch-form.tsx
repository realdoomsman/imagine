"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { DAY, durationMultiplierBps, ECONOMICS, formatMultiplier, formatPercent } from "@imagine/sdk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, post, type QuoteInfo } from "@/lib/api";
import { loadFees, LAUNCHLAB_PROTOCOL_FEE_BPS, type PoolFees } from "@/lib/fees";
import { decimalInput, formatAmount, formatBps, formatQuote, parseAmount, usdSuffix } from "@/lib/format";
import { signMintProof } from "@/lib/mint-proof";
import { signAndSend, type BuiltTransaction } from "@/lib/send";
import { useActor } from "@/lib/signer";
import { useTokenBalance } from "@/lib/use-token-balance";
import { useAccount } from "./account-provider";
import { durationLabel, LockDial } from "./lock-dial";
import { PairPill, QuoteLogo } from "./pair-pill";
import { QuotePicker } from "./quote-picker";
import { SignInPrompt } from "./sign-in-prompt";
import { ReauthNotice, reauthMessage } from "./reauth-notice";

interface LaunchPlan {
  mint: string;
  pool: string;
  quote: QuoteInfo;
  expectedTokens: string;
  lockAmount: string;
  transactions: BuiltTransaction[];
}

type Phase = "idle" | "signing" | "done" | "error";

export function LaunchForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { account } = useAccount();
  const actor = useActor();
  const router = useRouter();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [quotes, setQuotes] = useState<QuoteInfo[] | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteInfo | null>(null);
  const [payWithSol, setPayWithSol] = useState(false);
  const [devBuy, setDevBuy] = useState("");
  const [lockPercent, setLockPercent] = useState(50);
  const [lockSeconds, setLockSeconds] = useState(30 * DAY);
  const [fees, setFees] = useState<PoolFees>({ poolFeeBps: ECONOMICS.poolFeeBps, tradeFeeBps: ECONOMICS.tradeFeeBps });
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<{ mint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** An Imagine-wallet launch that needs a fresh sign-in first. */
  const [reauth, setReauth] = useState<string | null>(null);
  // A launch that stopped after something landed: the mint to finish and the
  // metadata already stored for it. Retrying resumes rather than mints again.
  const [partial, setPartial] = useState<{ mint: string; uri: string } | null>(null);

  // The mint is a fresh keypair the browser generates and signs with. It never
  // leaves this page; the API only ever sees the public key.
  const mintKeypair = useMemo(() => Keypair.generate(), []);

  const loadQuotes = useCallback(() => {
    setQuotes(null);
    setQuotesError(null);
    api
      .quotes()
      .then((list) => {
        setQuotes(list);
        // SOL first when it's offered; the creator picks anything else.
        setQuote((current) => current ?? list.find((entry) => entry.mint === NATIVE_MINT.toBase58()) ?? list[0] ?? null);
      })
      .catch((cause: unknown) => setQuotesError(cause instanceof Error ? cause.message : "unavailable"));
  }, []);

  useEffect(() => {
    loadQuotes();
    void loadFees().then(setFees);
  }, [loadQuotes]);

  const nativeQuote = quote?.mint === NATIVE_MINT.toBase58();
  const solPays = payWithSol && !nativeQuote;
  const buyDecimals = solPays || !quote ? 9 : quote.decimals;
  const devBuyBase = parseAmount(devBuy, buyDecimals);
  const quoteHeld = useTokenBalance(quote?.mint ?? NATIVE_MINT.toBase58(), quote?.tokenProgram ?? TOKEN_PROGRAM_ID.toBase58(), actor.publicKey);
  const solHeld = useTokenBalance(NATIVE_MINT.toBase58(), TOKEN_PROGRAM_ID.toBase58(), actor.publicKey);
  const payHeld = solPays || nativeQuote ? solHeld : quoteHeld;

  const multiplier = durationMultiplierBps(lockSeconds, ECONOMICS);
  const lockersShare = (10_000 - ECONOMICS.treasuryShareBps) / 10_000;

  const valid =
    name.trim().length > 0 &&
    symbol.trim().length > 0 &&
    (image !== null || partial !== null) &&
    quote !== null &&
    devBuyBase > 0n;

  const launch = useCallback(async () => {
    if ((!image && !partial) || !quote) return;
    setPhase("signing");
    setError(null);
    setReauth(null);
    setProgress([partial ? `Resuming ${partial.mint.slice(0, 6)}…` : "Storing the image and metadata…"]);

    const request = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      uri: partial?.uri ?? "",
      quoteMint: quote.mint,
      devBuy: devBuyBase.toString(),
      ...(solPays ? { payWithSol: true } : {}),
      lockPercent,
      lockDurationSecs: lockSeconds,
    };

    try {
      // The coin's website is its Imagine page, so the mint is fixed before
      // the metadata is stored: this page's keypair, or for an Imagine wallet
      // one the API derives and will sign with.
      const accountMint = !partial && account ? await api.launchMint() : null;
      if (!partial && image) {
        const form = new FormData();
        form.append("image", image);
        form.append("mint", accountMint?.mint ?? mintKeypair.publicKey.toBase58());
        form.append("name", request.name);
        form.append("symbol", request.symbol);
        form.append("description", description.trim());
        form.append("twitter", twitter.trim());
        form.append("telegram", telegram.trim());
        // Proves this launch owns the mint, so a retry may replace what an earlier attempt stored.
        if (accountMint) form.append("mintNonce", accountMint.nonce);
        else {
          const proof = await signMintProof(mintKeypair);
          if (proof) form.append("mintSignature", proof);
        }
        const stored = await api.pinMetadata(form);
        request.uri = stored.uri;
        setProgress(["Metadata stored"]);
      }

      if (account) {
        // An Imagine wallet launches server-side: the API signs every
        // transaction with the account's wallet and the mint it chose, and
        // reports each one back. If it stops partway it tells us the mint,
        // and the next attempt finishes that coin.
        setProgress((prev) => [...prev, "Launching from your Imagine wallet…"]);
        try {
          const done = await api.launchFromAccount(
            partial ? { ...request, resume: partial.mint } : { ...request, mintNonce: accountMint?.nonce },
          );
          setProgress((prev) => [prev[0], ...done.signatures.map((s) => `${s.label} — ${s.signature.slice(0, 12)}…`)]);
          setResult({ mint: done.mint });
          setPartial(null);
          setPhase("done");
        } catch (cause) {
          if (cause instanceof ApiError && typeof cause.detail.resume === "string") {
            const completed = cause.detail.completed;
            setPartial({ mint: cause.detail.resume, uri: request.uri });
            setProgress((prev) => [
              prev[0],
              ...(Array.isArray(completed)
                ? completed.map((s: { label: string; signature: string }) => `${s.label} — ${s.signature.slice(0, 12)}…`)
                : []),
            ]);
          }
          throw cause;
        }
        return;
      }

      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("connect a wallet or sign in first");
      }
      const mint = mintKeypair.publicKey.toBase58();
      // One plan: an optional SOL→pair swap, then the launch itself — create
      // the coin on Raydium LaunchLab, the first buy and the founding lock, atomically.
      // Re-posting the same mint after a partial run returns only what is left.
      const plan = await post<LaunchPlan>("/api/tx/launch", { ...request, creator: wallet.publicKey.toBase58(), mint });
      for (const built of plan.transactions) {
        const label = built.label ?? "Transaction";
        setProgress((prev) => [...prev, `${label}…`]);
        try {
          const signature = await signAndSend(connection, wallet, built, [mintKeypair], {
            kind: "launch",
            mint: mintKeypair.publicKey,
            devBuy: devBuyBase,
            payWithSol: solPays,
          });
          setProgress((prev) => [...prev.slice(0, -1), `${label} — ${signature.slice(0, 12)}…`]);
        } catch (cause) {
          setPartial({ mint, uri: request.uri });
          throw cause;
        }
      }
      setResult({ mint });
      setPartial(null);
      setPhase("done");
    } catch (cause) {
      const again = reauthMessage(cause);
      if (again) setReauth(again);
      else setError(cause instanceof Error ? cause.message : "launch failed");
      setPhase("error");
    }
  }, [account, connection, description, devBuyBase, image, lockPercent, lockSeconds, mintKeypair, name, partial, quote, solPays, symbol, telegram, twitter, wallet]);

  // A finished launch goes straight to its coin page. The pool is on chain by
  // now, but a load-balanced RPC or the indexer's metadata read can trail by
  // a few seconds; wait for the page's own data (briefly) so it opens complete.
  useEffect(() => {
    if (phase !== "done" || !result) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 12 && !cancelled; attempt += 1) {
        const ready = await api.pool(result.mint).then((detail) => detail.metadata !== null, () => false);
        if (ready) break;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1_500);
        await promise;
      }
      if (cancelled) return;
      const share = new URLSearchParams({ launched: "1", pct: String(lockPercent), term: durationLabel(lockSeconds) });
      router.replace(`/coins/${result.mint}?${share.toString()}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [lockPercent, lockSeconds, phase, result, router]);

  if (phase === "done" && result) {
    return (
      <section className="card card-dream mt-10 p-8">
        <h2 className="t-h2">Launched on Raydium.</h2>
        <p className="mt-3 text-[14.5px] text-fg-soft">Your founding lock is in. Opening your coin page…</p>
        <p className="num mt-4 break-all text-[12px] text-muted">{result.mint}</p>
        <a href={`/coins/${result.mint}`} className="btn btn-dream mt-6">
          Open it now
        </a>
      </section>
    );
  }

  // Custom properties are legal in a style object but absent from CSSProperties.
  const lockFill: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${((lockPercent - 10) / 90) * 100}%`,
  };
  const payAsset = solPays || !quote ? { symbol: "SOL", logoUrl: null } : quote;

  return (
    <div className="mt-10 space-y-5">
      <section className="card p-6">
        <Step n={1} title="The coin" />
        <div className="mt-5 grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <ImagePicker file={image} onChange={setImage} locked={partial !== null} />
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} placeholder="Moon Cube" maxLength={32} />
              <Field
                label="Ticker"
                value={symbol}
                onChange={(v) => setSymbol(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="CUBE"
                maxLength={10}
                mono
              />
            </div>
            <div>
              <label htmlFor="description" className="text-[13px] text-fg-soft">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="What it is. One or two sentences is plenty."
                className="input mt-2 min-h-[108px] resize-y text-[14px] leading-relaxed"
              />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="X (optional)" value={twitter} onChange={setTwitter} placeholder="https://x.com/…" maxLength={200} />
          <Field label="Telegram (optional)" value={telegram} onChange={setTelegram} placeholder="https://t.me/…" maxLength={200} />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          The coin&apos;s website is set to its page on imagine.fun, so anyone who finds it on Raydium or a chart
          lands where it can be locked. The image and details are written onto the coin when it&apos;s created and
          can&apos;t be changed afterwards.
        </p>
      </section>

      <section className="card p-6">
        <Step n={2} title="Pick the pair" />
        <p className="mt-2 text-[13px] leading-relaxed text-fg-soft">
          What your coin is priced in on Raydium LaunchLab — and what everyone who locks it gets paid in.
        </p>
        <div className="mt-4">
          <QuotePicker quotes={quotes} error={quotesError} onRetry={loadQuotes} selected={quote} onSelect={(next) => {
            setQuote(next);
            setDevBuy("");
          }} />
        </div>
        {quote ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-fg-soft">
            <PairPill quote={quote} />
            <span>
              Lock the meme, earn <span className="num font-semibold text-mint">{quote.symbol}</span>.
            </span>
          </p>
        ) : null}
      </section>

      <section className="card p-6">
        <Step n={3} title="Your first buy and founding lock" />

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="devbuy" className="text-[13px] text-fg-soft">
                First buy
              </label>
              {payHeld !== null ? (
                <span className="num text-[12px] text-muted">
                  {formatAmount(payHeld, buyDecimals)} {payAsset.symbol} held
                </span>
              ) : null}
            </div>
            <div className="relative mt-2">
              <input
                id="devbuy"
                inputMode="decimal"
                value={devBuy}
                onChange={(event) => setDevBuy(decimalInput(event.target.value))}
                placeholder="0"
                className="input num pr-28 text-[16px]"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[13px] text-fg-soft">
                <QuoteLogo quote={payAsset} size={16} />
                <span className="num">{payAsset.symbol}</span>
              </span>
            </div>
            {quote && !nativeQuote ? (
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg-soft">
                <input
                  type="checkbox"
                  checked={payWithSol}
                  onChange={(event) => {
                    setPayWithSol(event.target.checked);
                    setDevBuy("");
                  }}
                  className="size-4 accent-[var(--steel)]"
                />
                Pay with SOL (swapped to {quote.symbol} through Jupiter first)
              </label>
            ) : null}
            {devBuyBase > 0n && quote && !solPays && usdSuffix(devBuyBase, quote) ? (
              <p className="num mt-1.5 text-[12px] text-muted">{usdSuffix(devBuyBase, quote)}</p>
            ) : null}
          </div>

          <div className="well px-4 py-3.5">
            <p className="eyebrow">Where the stream goes</p>
            <p className="num mt-2 text-[15px] text-fg">
              {formatPercent(lockersShare, 0)} lockers · {formatPercent(ECONOMICS.treasuryShareBps / 10_000, 0)} treasury · 0% creator
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              You take no cut. You earn the way everyone does: by locking. Your founding lock below is your position from
              the first block.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <label htmlFor="lock-pct" className="text-[13px] text-fg-soft">
              Lock {lockPercent}% of your first buy
            </label>
            <span className="num text-[12px] text-muted">min 10%</span>
          </div>
          <input
            id="lock-pct"
            type="range"
            min={10}
            max={100}
            value={lockPercent}
            onChange={(event) => setLockPercent(Number(event.target.value))}
            className="range mt-2"
            style={lockFill}
          />
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            A pool can&apos;t open without the creator locking first. Everyone can see what you committed and for how
            long.
          </p>
        </div>

        <div className="mt-6">
          <LockDial
            seconds={lockSeconds}
            onChange={setLockSeconds}
            min={ECONOMICS.minLockSecs}
            max={ECONOMICS.maxLockSecs}
            multiplierBps={multiplier}
          />
          <p className="mt-2 text-[12px] text-muted">
            {formatMultiplier(multiplier)} weight on your share of the stream for {durationLabel(lockSeconds)}.
          </p>
        </div>
      </section>

      <section className="card p-6">
        <Step n={4} title="Fees, plainly" />
        <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-fg-soft">
          <Fee label="On-chain pool fee" value={formatBps(fees.poolFeeBps)}>
            Every trade of your coin, wherever it happens — Raydium, Jupiter, bots — pays {formatBps(fees.poolFeeBps)}{" "}
            that Raydium LaunchLab sends to the coin&apos;s pool. Enforced on-chain; after graduation the Raydium pool&apos;s
            fee goes to the same place.
          </Fee>
          <Fee label="Imagine app fee" value={formatBps(fees.tradeFeeBps)}>
            Added to trades through imagine.fun and paid straight into the same pool, so those trades pay{" "}
            {formatBps(fees.poolFeeBps + fees.tradeFeeBps)} in all, in {quote?.symbol ?? "the pair asset"}.
          </Fee>
          <Fee label="Raydium protocol fee" value={formatBps(LAUNCHLAB_PROTOCOL_FEE_BPS)}>
            Raydium LaunchLab&apos;s own fee on curve trades, the same for every coin there.
          </Fee>
          <Fee label="Creator" value="0%">
            You earn nothing from fees. You earn only by locking, like everyone else.
          </Fee>
          <Fee label="Pool creation" value={`${formatAmount(ECONOMICS.poolCreationFeeLamports, 9)} SOL`}>
            Charged once when the pool opens, plus network fees and account rent.
          </Fee>
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Pool inflow splits {formatPercent(lockersShare, 0)} to lockers by weight and{" "}
          {formatPercent(ECONOMICS.treasuryShareBps / 10_000, 0)} to the treasury. The terms are frozen when the pool
          opens, there&apos;s no admin withdraw path, and claims and unlocks can&apos;t be paused.
        </p>
      </section>

      {account || wallet.publicKey ? (
        <button
          type="button"
          onClick={() => void launch()}
          disabled={!valid || phase === "signing"}
          className="btn btn-dream btn-lg w-full"
        >
          {phase === "signing"
            ? "Signing…"
            : partial
              ? "Finish launching this coin"
              : quote && devBuyBase > 0n && !solPays
                ? `Launch on Raydium · buy ${formatQuote(devBuyBase, quote)}`
                : "Launch on Raydium"}
        </button>
      ) : (
        <SignInPrompt what="launch" />
      )}

      {progress.length > 0 ? (
        <ol className="card space-y-2 p-5 text-[12px]">
          {progress.map((line) => (
            <li key={line} className="num text-fg-soft">
              {line}
            </li>
          ))}
        </ol>
      ) : null}

      {reauth ? <ReauthNotice message={reauth} /> : null}
      {error ? (
        <div className="rounded-[10px] border border-rose/40 bg-rose/10 px-5 py-4 text-[13px] text-rose">
          <p className="break-words">{error}</p>
          {partial ? (
            <p className="mt-2 text-fg-soft">
              The coin <span className="num">{partial.mint.slice(0, 8)}…</span> is reserved for you. Press{" "}
              <em className="not-italic text-fg">Finish launching this coin</em> to pick up where it stopped; nothing
              already done is repeated.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-[17px] font-bold tracking-[-0.02em]">
      <span className="num flex size-7 items-center justify-center rounded-full bg-ink-4 text-[12px] text-fg">{n}</span>
      {title}
    </h2>
  );
}

function Fee({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <span className="font-semibold text-fg">{label}</span>
      <span className="num text-right text-fg">{value}</span>
      <span className="col-span-2 text-[12.5px] text-muted">{children}</span>
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[13px] text-fg-soft">{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`input mt-2 text-[15px] ${mono ? "num" : ""}`}
      />
    </label>
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * The coin's image, straight from disk. Click or drop; a square preview shows
 * what wallets and charts will display. Rejections are explained inline rather than
 * after a round trip to the API.
 */
function ImagePicker({
  file,
  onChange,
  locked,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  /** A resumed launch already stored its image. */
  locked: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!IMAGE_TYPES.includes(candidate.type)) {
      setProblem("PNG, JPEG, GIF or WebP only.");
      return;
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      setProblem("Keep it under 4 MB.");
      return;
    }
    setProblem(null);
    onChange(candidate);
  };

  return (
    <div>
      <span className="text-[13px] text-fg-soft">Image</span>
      <button
        type="button"
        disabled={locked}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files[0]);
        }}
        className={`relative mt-2 flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-[14px] border transition-colors ${
          over ? "border-mint bg-mint/10" : "border-dashed border-line-strong bg-ink-1 hover:border-steel"
        }`}
        aria-label={file ? `Image: ${file.name}. Click to replace.` : "Choose an image"}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <span className="px-4 text-center text-[12.5px] leading-relaxed text-muted">
            Drop an image here or click to choose.
            <br />
            Square looks best.
          </span>
        )}
        {preview && !locked ? (
          <span className="absolute inset-x-0 bottom-0 bg-ink/80 px-2 py-1 text-[11px] text-fg-soft">Replace</span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        // The button above is the control; this input only opens the file dialog for it.
        tabIndex={-1}
        aria-label="Coin image"
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {problem ? <p className="mt-1.5 text-[12px] text-rose">{problem}</p> : null}
      {file && !problem ? (
        <p className="num mt-1.5 truncate text-[11.5px] text-muted">
          {file.name} · {(file.size / 1024).toFixed(0)} KB
        </p>
      ) : null}
    </div>
  );
}
