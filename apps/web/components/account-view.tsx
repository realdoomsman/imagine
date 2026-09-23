"use client";

import {
  exactAmount,
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatSol,
  formatTokenAmount,
  shortAddress,
} from "@vise/sdk";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Holding, type WalletPosition, type WalletView } from "@/lib/api";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccount } from "./account-provider";
import { PortfolioView } from "./portfolio-view";
import { Shimmer } from "./skeleton";
import { SignInPrompt } from "./sign-in-prompt";
import { ViseMark } from "./vise-mark";

const EXPLORER = process.env.NEXT_PUBLIC_CLUSTER === "mainnet-beta" ? "" : "?cluster=devnet";
const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${EXPLORER}`;

/**
 * The account page: the wallet VISE holds for a Google sign-in.
 *
 * Everything a person needs to run their money from here — the address to
 * deposit to, what is in it, what is locked and for how long, what it has
 * earned, and the controls to claim, unlock, withdraw or take the key and
 * leave. All figures are read from chain on every load.
 */
export function AccountView() {
  const { ready, account, logout } = useAccount();
  const wallet = useWallet();
  const [view, setView] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The sign-in callback lands here with `?error=` when Google or the
  // handshake refused; say so once and clean the address bar.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("error");
    if (!code) return;
    setError(
      code === "cancelled"
        ? "Sign-in was cancelled."
        : code === "access_denied"
          ? "Google did not grant access."
          : "Sign-in could not be completed. Try again.",
    );
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      setView(await api.wallet());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not load your wallet");
    }
  }, [account]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (key: string, work: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await work();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "action failed");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  if (!ready) return <AccountSkeleton />;

  // An extension wallet has no VISE-held wallet to show; its locks are read
  // from chain for whichever key is connected.
  if (!account && wallet.publicKey) return <PortfolioView />;

  if (!account) {
    return (
      <div className="panel mt-10 flex flex-col items-center gap-5 px-8 py-20 text-center">
        <span className="text-steel-700">
          <ViseMark size={44} grip={0} />
        </span>
        <h2 className="t-sub">Your VISE wallet lives here.</h2>
        <p className="max-w-[46ch] text-[14.5px] leading-relaxed text-steel-500">
          Sign in with Google and you get a Solana wallet held for you: send
          coins to it, lock from it, watch what it earns, withdraw whenever.
        </p>
        <div className="w-full max-w-md text-left">
          {error ? (
            <p className="mb-3 rounded-machined border border-rust/40 bg-rust/10 px-4 py-2.5 text-[13px] text-rust">{error}</p>
          ) : null}
          <SignInPrompt what="open your wallet" />
        </div>
      </div>
    );
  }

  if (!view) return <AccountSkeleton />;

  const sol = BigInt(view.sol);
  const pending = BigInt(view.totals.pending);
  const claimed = BigInt(view.totals.claimed);

  return (
    <div className="mt-8 space-y-6">
      {error ? (
        <p className="rounded-machined border border-rust/40 bg-rust/10 px-5 py-3 text-[13px] text-rust">{error}</p>
      ) : null}

      {/* Identity and the address to fund. */}
      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {account.picture ? (
              // eslint-disable-next-line @next/next/no-img-element -- Google-hosted avatar
              <img src={account.picture} alt="" className="size-12 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-torch text-[18px] font-bold text-[#190600]">
                {(account.name ?? account.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-[16px] font-semibold text-steel-50">{account.name ?? account.email}</p>
              <p className="text-[12.5px] text-steel-500">{account.email} · signed in with Google</p>
            </div>
          </div>
          <button type="button" onClick={() => void logout()} className="btn btn-ghost h-9 text-[13px]">
            Sign out
          </button>
        </div>

        <div className="mt-6 grid gap-px border border-steel-700 bg-steel-700 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="bg-steel-900 px-5 py-4">
            <p className="rule-label">Your VISE wallet · send SOL or coins here</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="num break-all text-[14px] text-steel-50">{view.wallet}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(view.wallet);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
                className="btn btn-ghost h-8 px-3 text-[12px]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-steel-500">
              An ordinary Solana address. Anything sent here shows up below and
              can be locked, traded, or withdrawn. VISE holds the key for you
              and you can take it with you any time.
            </p>
          </div>
          <div className="bg-steel-900 px-5 py-4">
            <p className="rule-label">SOL</p>
            <p className="num mt-1 text-[28px] leading-none text-steel-50">{formatSol(sol)}</p>
          </div>
        </div>
      </section>

      {/* Earnings across every lock. */}
      <dl className="grid gap-px border border-steel-700 bg-steel-700 sm:grid-cols-3">
        <Summary label="Earning · unclaimed" value={`${formatSol(pending)} SOL`} accent />
        <Summary label="Claimed to date" value={`${formatSol(claimed)} SOL`} />
        <Summary label="Open locks" value={String(view.totals.positions)} />
      </dl>

      {/* Locks. */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px]">Locked</h2>
          <Link href="/coins" className="text-[13px] text-torch">
            Lock more →
          </Link>
        </div>
        {view.positions.length === 0 ? (
          <p className="panel mt-3 px-6 py-8 text-[13.5px] text-steel-500">
            Nothing locked yet. Send a coin to the address above, or buy one on
            its page, and clamp it from there.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {view.positions.map((position) => (
              <PositionCard
                key={`${position.mint}-${position.index}`}
                position={position}
                busy={busy}
                onClaim={() =>
                  run(`claim-${position.mint}-${position.index}`, () =>
                    api.act({ kind: "claim", mint: position.mint, index: position.index }),
                  )
                }
                onUnlock={() =>
                  run(`unlock-${position.mint}-${position.index}`, () =>
                    api.act({ kind: "unlock", mint: position.mint, index: position.index, early: !position.matured }),
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Holdings. */}
      <section>
        <h2 className="text-[17px]">In the wallet</h2>
        {view.holdings.length === 0 ? (
          <p className="panel mt-3 px-6 py-8 text-[13.5px] text-steel-500">
            No coins yet. Anything sent to your address appears here.
          </p>
        ) : (
          <div className="panel mt-3 divide-y divide-steel-860">
            {view.holdings.map((holding) => (
              <HoldingRow key={holding.mint} holding={holding} />
            ))}
          </div>
        )}
      </section>

      <WithdrawPanel holdings={view.holdings} sol={BigInt(view.solAvailable)} busy={busy} run={run} />

      <KeyPanel wallet={view.wallet} busy={busy} run={run} />

      {/* Activity. */}
      {view.actions.length > 0 ? (
        <section>
          <h2 className="text-[17px]">Activity</h2>
          <ol className="panel mt-3 divide-y divide-steel-860">
            {view.actions.map((action, index) => (
              <li key={`${action.at}-${index}`} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                <span className="num w-24 shrink-0 text-steel-500">
                  {new Date(action.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className="text-steel-200">{describeAction(action.kind, action.detail)}</span>
                {action.signature ? (
                  <a
                    href={explorerTx(action.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="num ml-auto text-[12px] text-steel-500 hover:text-torch"
                  >
                    {action.signature.slice(0, 8)}…
                  </a>
                ) : action.failed ? (
                  <span className="ml-auto text-[12px] text-rust">failed</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function describeAction(kind: string, detail: Record<string, unknown>): string {
  switch (kind) {
    case "lock":
      return `Locked ${String(detail.mint).slice(0, 6)}… for ${String(detail.durationDays)} days`;
    case "claim":
      return `Claimed rewards on ${String(detail.mint).slice(0, 6)}…`;
    case "unlock":
      return `${detail.early ? "Broke the lock" : "Unlocked"} on ${String(detail.mint).slice(0, 6)}…`;
    case "swap":
      return `${detail.side === "buy" ? "Bought" : "Sold"} ${String(detail.mint).slice(0, 6)}…`;
    case "withdraw":
      return `Withdrew to ${String(detail.to).slice(0, 6)}…`;
    case "launch":
      return `Launched ${String(detail.symbol ?? "a coin")}`;
    case "export-key":
      return "Exported the wallet key";
    default:
      return kind;
  }
}

function PositionCard({
  position,
  busy,
  onClaim,
  onUnlock,
}: {
  position: WalletPosition;
  busy: string | null;
  onClaim: () => void;
  onUnlock: () => void;
}) {
  const term = position.lockEnd - position.lockStart;
  const elapsed = term > 0 ? Math.min(Math.max((term - position.secondsLeft) / term, 0), 1) : 1;
  const key = `${position.mint}-${position.index}`;
  const pending = BigInt(position.pending);
  const burn = BigInt(position.earlyExitBurn);
  const [confirming, setConfirming] = useState(false);

  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-start gap-4">
        {position.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
          <img src={position.imageUrl} alt="" className="size-10 rounded-machined border border-steel-700 object-cover" />
        ) : (
          <div className="size-10 rounded-machined border border-steel-700 bg-steel-860" />
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/coins/${position.mint}`} className="text-[15px] font-semibold text-steel-50 hover:text-torch">
            {position.symbol ?? shortAddress(position.mint ?? "")}
          </Link>
          <p className="num text-[12px] text-steel-500">
            {formatTokenAmount(BigInt(position.amount), position.decimals)} locked ·{" "}
            {formatMultiplier(position.multiplierBps)} · {formatPercent(position.share, 2)} of the pool
          </p>
        </div>
        <div className="text-right">
          <p className="rule-label">Earning</p>
          <p className="num text-[20px] leading-none text-verdi">{formatSol(pending)} SOL</p>
          <p className="num mt-1 text-[11px] text-steel-500">{formatSol(BigInt(position.claimed))} claimed so far</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-steel-500">
            {position.matured ? "Matured — your coins are free" : `Unlocks in ${formatDuration(position.secondsLeft)}`}
          </span>
          <span className="num text-steel-500">
            {new Date(position.lockEnd * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-[2px] bg-steel-990 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]">
          <div
            className="knurl h-full bg-torch transition-[width] duration-700"
            style={{ width: `${elapsed * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null || pending === 0n}
          onClick={onClaim}
          className="btn btn-primary h-9 text-[13px]"
        >
          {busy === `claim-${key}` ? "Claiming…" : "Claim"}
        </button>
        {position.matured ? (
          <button type="button" disabled={busy !== null} onClick={onUnlock} className="btn btn-ghost h-9 text-[13px]">
            {busy === `unlock-${key}` ? "Working…" : "Unlock"}
          </button>
        ) : confirming ? (
          // Breaking a lock is irreversible and costs principal: the second
          // click is a different button that says exactly what it does.
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setConfirming(false);
                onUnlock();
              }}
              className="btn h-9 border-rust/60 bg-rust/15 text-[13px] text-rust hover:bg-rust/25"
            >
              {busy === `unlock-${key}`
                ? "Breaking…"
                : `Burn ${formatTokenAmount(burn, position.decimals)} and leave`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost h-9 text-[13px]">
              Keep it locked
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
            className="btn btn-ghost h-9 text-[13px]"
          >
            Break the lock
          </button>
        )}
        {!position.matured ? (
          <span className="text-[11.5px] text-steel-500">
            {confirming ? "This cannot be undone. " : "Breaking it now "}
            burns {formatTokenAmount(burn, position.decimals)} of your{" "}
            {formatTokenAmount(BigInt(position.amount), position.decimals)} and forfeits {formatSol(pending)} SOL to
            the lockers who stayed.
          </span>
        ) : null}
      </div>
    </article>
  );
}

function HoldingRow({ holding }: { holding: Holding }) {
  const amount = BigInt(holding.amount);
  const value =
    holding.priceLamports !== null
      ? (Number(amount) / 10 ** holding.decimals) * holding.priceLamports
      : null;
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      {holding.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary IPFS hosts
        <img src={holding.imageUrl} alt="" className="size-9 rounded-machined border border-steel-700 object-cover" />
      ) : (
        <div className="size-9 rounded-machined border border-steel-700 bg-steel-860" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-steel-50">{holding.symbol ?? shortAddress(holding.mint)}</p>
        <p className="num truncate text-[12px] text-steel-500">{holding.name ?? holding.mint}</p>
      </div>
      <div className="text-right">
        <p className="num text-[14px] text-steel-100">{formatTokenAmount(amount, holding.decimals)}</p>
        {value !== null ? (
          <p className="num text-[11.5px] text-steel-500">≈ {formatSol(BigInt(Math.round(value)))} SOL</p>
        ) : null}
      </div>
      {holding.hasPool ? (
        <Link href={`/coins/${holding.mint}`} className="btn btn-ghost h-8 px-3 text-[12px]">
          Lock
        </Link>
      ) : null}
    </div>
  );
}

function WithdrawPanel({
  holdings,
  sol,
  busy,
  run,
}: {
  holdings: Holding[];
  sol: bigint;
  busy: string | null;
  run: (key: string, work: () => Promise<unknown>) => Promise<void>;
}) {
  const [asset, setAsset] = useState("SOL");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const holding = holdings.find((h) => h.mint === asset) ?? null;
  const decimals = holding ? holding.decimals : 9;
  const max = holding ? BigInt(holding.amount) : sol;
  const parsed = (() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 10 ** decimals));
  })();

  return (
    <section className="panel p-6">
      <h2 className="text-[17px]">Withdraw</h2>
      <p className="mt-1 text-[12.5px] text-steel-500">Send SOL or any coin in this wallet to another address.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_140px]">
        <select value={asset} onChange={(e) => { setAsset(e.target.value); setAmount(""); }} className="input text-[14px]">
          <option value="SOL">SOL</option>
          {holdings.map((h) => (
            <option key={h.mint} value={h.mint}>{h.symbol ?? shortAddress(h.mint)}</option>
          ))}
        </select>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="Destination address"
          className="input num text-[14px]"
        />
        <div className="relative">
          <input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Amount"
            className="input num pr-14 text-[14px]"
          />
          <button
            type="button"
            onClick={() => setAmount(exactAmount(max, decimals))}
            className="num absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-torch"
          >
            MAX
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || parsed === 0n || to.length < 32}
          onClick={() =>
            void run("withdraw", async () => {
              const { signature } = await api.withdraw({ to, amount: parsed.toString(), mint: holding ? holding.mint : undefined });
              setDone(signature);
              setAmount("");
            })
          }
          className="btn btn-primary h-10"
        >
          {busy === "withdraw" ? "Sending…" : "Send"}
        </button>
        <span className="num text-[12px] text-steel-500">
          Available {formatTokenAmount(max, decimals)} {holding ? holding.symbol ?? "" : "SOL"}
          {holding ? null : <span className="text-steel-600"> · rent and fee stay behind</span>}
        </span>
        {done ? (
          <a href={explorerTx(done)} target="_blank" rel="noreferrer" className="num text-[12px] text-verdi">
            Sent · {done.slice(0, 10)}…
          </a>
        ) : null}
      </div>
    </section>
  );
}

function KeyPanel({
  wallet,
  busy,
  run,
}: {
  wallet: string;
  busy: string | null;
  run: (key: string, work: () => Promise<unknown>) => Promise<void>;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <section className="panel p-6">
      <h2 className="text-[17px]">Take your key</h2>
      <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-steel-500">
        This wallet is yours. Export its secret key to import it into Phantom,
        Solflare or anything else, and it keeps working here too. Anyone with
        the key controls the wallet — treat it like cash.
      </p>
      {secret ? (
        <div className="mt-4">
          <code className="num block break-all rounded-machined border border-torch/40 bg-steel-950 px-4 py-3 text-[12px] text-torch-pale">
            {secret}
          </code>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(secret); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}
              className="btn btn-ghost h-8 px-3 text-[12px]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => setSecret(null)} className="btn btn-ghost h-8 px-3 text-[12px]">
              Hide
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("export", async () => { const { secretKey } = await api.exportKey(); setSecret(secretKey); })}
          className="btn btn-ghost mt-4 h-10"
        >
          Reveal secret key for {shortAddress(wallet)}
        </button>
      )}
    </section>
  );
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-steel-900 px-5 py-4">
      <dt className="rule-label">{label}</dt>
      <dd className={`num mt-1.5 text-[22px] leading-none ${accent ? "text-verdi" : "text-steel-50"}`}>{value}</dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="mt-8 space-y-6">
      <div className="panel p-6">
        <div className="flex items-center gap-4">
          <Shimmer className="size-12 rounded-full" />
          <div>
            <Shimmer className="h-4 w-40" />
            <Shimmer className="mt-2 h-3 w-56" />
          </div>
        </div>
        <Shimmer className="mt-6 h-24 w-full" />
      </div>
      <div className="grid gap-px sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Shimmer key={i} className="h-20 w-full" />)}
      </div>
    </div>
  );
}
