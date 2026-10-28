"use client";

import { exactAmount, formatDuration, formatSol, formatTokenAmount, shortAddress } from "@imagine/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Holding, type WalletView } from "@/lib/api";
import { decimalInput, explorerTx, formatAmount, formatNumber, formatUsd, parseAmount } from "@/lib/format";
import { useAccount } from "./account-provider";
import { ImagineMark } from "./imagine-mark";
import { CopyButton } from "./copy-button";
import { PortfolioView } from "./portfolio-view";
import { PositionCard } from "./position-card";
import { Shimmer } from "./skeleton";
import { SignInPrompt } from "./sign-in-prompt";
import { ReauthNotice, reauthMessage } from "./reauth-notice";
import { BurnPanel, WalletBurnPanel } from "./burn-panel";

/**
 * The account page: the Imagine wallet held for a Google sign-in.
 *
 * Everything a person needs to run their money from here — the address to
 * deposit to, what is in it, what is locked and for how long, what it has
 * earned in each pair asset, and the controls to claim, unlock, withdraw or
 * take the key and leave. All figures are read from chain on every load.
 */
export function AccountView() {
  const { ready, account, logout, refresh: refreshAccount } = useAccount();
  const wallet = useWallet();
  const [view, setView] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Withdraw and export want a sign-in from the last few minutes; when the
  // API asks for one, this holds its message and the page offers the way.
  const [reauth, setReauth] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The last failed action and why, so a position can react to its own unlock failing.
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

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
      // A session that expired or was signed out elsewhere: fall back to the
      // sign-in prompt rather than showing a stale wallet with an error.
      if (cause instanceof ApiError && cause.status === 401) {
        setView(null);
        await refreshAccount();
        return;
      }
      setError(cause instanceof Error ? cause.message : "could not load your wallet");
    }
  }, [account, refreshAccount]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (key: string, work: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      setFailed(null);
      setReauth(null);
      try {
        await work();
        await refresh();
        // The first read can come from an RPC node a slot behind the action;
        // a second one shortly after shows the result without a manual reload.
        window.setTimeout(() => void refresh(), 2_500);
      } catch (cause) {
        const again = reauthMessage(cause);
        if (again) setReauth(again);
        else {
          const message = cause instanceof Error ? cause.message : "action failed";
          setError(message);
          setFailed({ key, message });
        }
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await logout();
    } catch (cause) {
      setError(`Sign-out did not go through, so you are still signed in: ${cause instanceof Error ? cause.message : "try again"}`);
    }
  }, [logout]);

  if (!ready) return <AccountSkeleton />;

  // An extension wallet has no Imagine wallet to show; its locks are read
  // from chain for whichever key is connected.
  if (!account && wallet.publicKey) {
    return (
      <>
        <PortfolioView />
        <WalletBurnPanel />
      </>
    );
  }

  if (!account) {
    return (
      <div className="card mt-10 flex flex-col items-center gap-4 px-8 py-20 text-center">
        <ImagineMark size={44} className="opacity-40" />
        <h2 className="t-h3">Your Imagine wallet lives here.</h2>
        <p className="max-w-[46ch] text-[14.5px] leading-relaxed text-muted">
          Sign in with Google and you get a Solana wallet held for you: send SOL or a pair asset to it, trade and lock
          from it, watch what it earns, withdraw whenever.
        </p>
        <div className="w-full max-w-md text-left">
          {error ? (
            <p className="mb-3 rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-2.5 text-[13px] text-rose">{error}</p>
          ) : null}
          <SignInPrompt what="open your wallet" />
        </div>
      </div>
    );
  }

  if (!view) {
    return error ? (
      <div className="card mt-8 px-6 py-10 text-center">
        <p className="break-words text-[13.5px] text-rose">{error}</p>
        <button type="button" onClick={() => void refresh()} className="btn btn-ghost btn-sm mt-4">
          Try again
        </button>
      </div>
    ) : (
      <AccountSkeleton />
    );
  }

  const sol = BigInt(view.sol);

  return (
    <div className="mt-8 space-y-6">
      {error ? (
        <p className="break-words rounded-[10px] border border-rose/40 bg-rose/10 px-5 py-3 text-[13px] text-rose">{error}</p>
      ) : null}
      {reauth ? <ReauthNotice message={reauth} /> : null}

      {/* Identity and the address to fund. */}
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            {account.picture ? (
              // eslint-disable-next-line @next/next/no-img-element -- Google-hosted avatar
              <img src={account.picture} alt="" className="size-12 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span
                className="flex size-12 items-center justify-center rounded-full text-[18px] font-extrabold text-ink"
                style={{ background: "var(--dream)" }}
              >
                {(account.name ?? account.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold text-fg">{account.name ?? account.email}</p>
              <p className="truncate text-[12.5px] text-muted">{account.email} · signed in with Google</p>
            </div>
          </div>
          <button type="button" onClick={() => void signOut()} className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </div>

        <div className="mt-6 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 bg-ink-1 px-5 py-4">
            <p className="eyebrow">Your Imagine wallet · send SOL, pair assets or coins here</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="num break-all text-[14px] text-fg">{view.wallet}</code>
              <CopyButton value={view.wallet} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              An ordinary Solana address. Anything sent here shows up below and can be traded, locked or withdrawn.
              Imagine holds the key for you, and you can take it with you any time.
            </p>
          </div>
          <div className="flex items-center gap-5 bg-ink-1 px-5 py-4">
            <DepositQr address={view.wallet} />
            <div>
              <p className="eyebrow">SOL</p>
              <p className="num mt-1 text-[28px] leading-none text-fg">{formatSol(sol)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Earnings across every lock, in USD since the pair assets differ. */}
      <dl className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3">
        <Summary label="Earning · unclaimed" value={formatUsd(view.totals.pendingUsd)} accent />
        <Summary label="Claimed to date" value={formatUsd(view.totals.claimedUsd)} />
        <Summary label="Open locks" value={String(view.totals.positions)} />
      </dl>

      {/* Locks. */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="t-h3">Locked</h2>
          <Link href="/coins" className="text-[13px] font-semibold text-steel-hi hover:text-fg">
            Lock more →
          </Link>
        </div>
        {view.positions.length === 0 ? (
          <p className="card mt-3 px-6 py-8 text-[13.5px] text-muted">
            Nothing locked yet. Send a coin to the address above, or buy one on its page, and lock it from there.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {view.positions.map((position) => {
              const key = `${position.mint}-${position.index}`;
              const base = { mint: position.mint, index: position.index };
              return (
                <PositionCard
                  key={key}
                  position={position}
                  earlyExitBurn={position.earlyExitBurn}
                  busy={busy}
                  unlockError={failed?.key === `unlock-${key}` ? failed.message : null}
                  onClaim={() => void run(`claim-${key}`, () => api.act({ kind: "claim", ...base }))}
                  onUnlock={(early) => void run(`unlock-${key}`, () => api.act({ kind: "unlock", ...base, early }))}
                  onExtend={(seconds) =>
                    void run(`extend-${key}`, () => api.act({ kind: "extend", ...base, durationSecs: seconds }))
                  }
                  onRenounce={() => void run(`renounce-${key}`, () => api.act({ kind: "renounce", ...base }))}
                  onLockForever={() => void run(`forever-${key}`, () => api.act({ kind: "lockForever", ...base }))}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Holdings. */}
      <section>
        <h2 className="t-h3">In the wallet</h2>
        {view.holdings.length === 0 ? (
          <p className="card mt-3 px-6 py-8 text-[13.5px] text-muted">
            No tokens yet. Anything sent to your address appears here.
          </p>
        ) : (
          <div className="card mt-3 divide-y divide-line overflow-hidden">
            {view.holdings.map((holding) => (
              <HoldingRow key={holding.mint} holding={holding} />
            ))}
          </div>
        )}
      </section>

      <WithdrawPanel holdings={view.holdings} sol={BigInt(view.solAvailable)} busy={busy} run={run} />

      <BurnPanel
        holdings={view.holdings.filter((holding) => holding.hasPool && !holding.asset)}
        busy={busy}
        burn={(mint, amount) => run("burn", () => api.act({ kind: "burn", mint, amount: amount.toString() }))}
      />

      <KeyPanel wallet={view.wallet} busy={busy} run={run} />

      {view.actions.length > 0 ? (
        <section>
          <h2 className="t-h3">Activity</h2>
          <ol className="card mt-3 divide-y divide-line overflow-hidden">
            {view.actions.map((action, index) => (
              <li key={`${action.at}-${index}`} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                <span className="num w-20 shrink-0 text-muted">
                  {new Date(action.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className="min-w-0 truncate text-fg">{describeAction(action.kind, action.detail)}</span>
                {action.signature ? (
                  <a
                    href={explorerTx(action.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="num ml-auto shrink-0 text-[12px] text-muted hover:text-steel-hi"
                  >
                    {action.signature.slice(0, 8)}…
                  </a>
                ) : action.failed ? (
                  <span className="ml-auto shrink-0 text-[12px] text-rose">failed</span>
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
  const coin = `${String(detail.mint).slice(0, 6)}…`;
  const term = typeof detail.durationSecs === "number" ? formatDuration(detail.durationSecs) : "";
  switch (kind) {
    case "lock":
      return `Locked ${coin}${term ? ` for ${term}` : ""}`;
    case "claim":
      return `Claimed rewards on ${coin}`;
    case "renounce":
      return `Gave up earnings on ${coin}`;
    case "lockForever":
      return `Locked forever on ${coin}`;
    case "burn":
      return `Burned ${coin}`;
    case "extend":
      return `Extended the lock on ${coin}${term ? ` to ${term}` : ""}`;
    case "increase":
      return `Added to the lock on ${coin}`;
    case "unlock":
      return `${detail.early ? "Broke the lock" : "Unlocked"} on ${coin}`;
    case "swap":
      return `${detail.side === "buy" ? "Bought" : "Sold"} ${coin}`;
    case "sync":
      return `Synced the pool on ${coin}`;
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

/** A pair asset's symbol and logo when the holding is one; the coin's own otherwise. */
function holdingLabel(holding: Holding): string {
  return holding.asset?.symbol ?? holding.symbol ?? shortAddress(holding.mint);
}

function HoldingRow({ holding }: { holding: Holding }) {
  const amount = BigInt(holding.amount);
  const whole = Number(amount) / 10 ** holding.decimals;
  const usd =
    holding.priceUsd !== null
      ? whole * holding.priceUsd
      : holding.asset?.usdPrice != null
        ? whole * holding.asset.usdPrice
        : null;
  const inQuote = holding.priceQuote !== null && holding.quote ? whole * holding.priceQuote : null;
  const image = holding.asset?.logoUrl ?? holding.imageUrl;
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- coin images and token logos come from many hosts
        <img src={image} alt="" className="size-9 rounded-[8px] border border-line bg-ink-3 object-cover" />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-[8px] border border-line bg-ink-3 text-[13px] font-bold text-muted">
          {holdingLabel(holding).slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="num truncate text-[14px] font-semibold text-fg">{holdingLabel(holding)}</p>
        <p className="truncate text-[12px] text-muted">
          {holding.asset ? `Pair asset · ${holding.asset.name}` : (holding.name ?? holding.mint)}
        </p>
      </div>
      <div className="text-right">
        <p className="num text-[14px] text-fg">{formatTokenAmount(amount, holding.decimals)}</p>
        {usd !== null ? (
          <p className="num text-[11.5px] text-muted">≈ {formatUsd(usd)}</p>
        ) : inQuote !== null && holding.quote ? (
          <p className="num text-[11.5px] text-muted">
            ≈ {formatNumber(inQuote)} {holding.quote.symbol}
          </p>
        ) : null}
      </div>
      {holding.hasPool ? (
        <Link href={`/coins/${holding.mint}`} className="btn btn-ghost btn-sm">
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
  const parsed = parseAmount(amount, decimals);
  const symbol = holding ? holdingLabel(holding) : "SOL";

  return (
    <section className="card p-6">
      <h2 className="t-h3">Withdraw</h2>
      <p className="mt-1 text-[12.5px] text-muted">Send SOL, a pair asset or any coin in this wallet to another address.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)_160px]">
        <select
          value={asset}
          onChange={(event) => {
            setAsset(event.target.value);
            setAmount("");
          }}
          className="input text-[14px]"
          aria-label="Asset"
        >
          <option value="SOL">SOL</option>
          {holdings.map((h) => (
            <option key={h.mint} value={h.mint}>
              {holdingLabel(h)}
            </option>
          ))}
        </select>
        <input
          value={to}
          onChange={(event) => setTo(event.target.value.trim())}
          placeholder="Destination address"
          aria-label="Destination address"
          className="input num text-[14px]"
        />
        <div className="relative">
          <input
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(decimalInput(event.target.value))}
            placeholder="Amount"
            aria-label="Amount"
            className="input num pr-14 text-[14px]"
          />
          <button
            type="button"
            onClick={() => setAmount(exactAmount(max, decimals))}
            className="num absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-steel-hi"
          >
            MAX
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || parsed === 0n || parsed > max || to.length < 32}
          onClick={() =>
            void run("withdraw", async () => {
              const { signature } = await api.withdraw({ to, amount: parsed.toString(), mint: holding ? holding.mint : undefined });
              setDone(signature);
              setAmount("");
            })
          }
          className="btn btn-primary btn-sm"
        >
          {busy === "withdraw" ? "Sending…" : "Send"}
        </button>
        <span className="num text-[12px] text-muted">
          Available {formatAmount(max, decimals)} {symbol}
          {holding ? null : " · rent and fee stay behind"}
        </span>
        {done ? (
          <a href={explorerTx(done)} target="_blank" rel="noreferrer" className="num text-[12px] text-mint">
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
  return (
    <section className="card p-6">
      <h2 className="t-h3">Take your key</h2>
      <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
        This wallet is yours. Export its secret key to import it into Phantom, Solflare or anything else, and it keeps
        working here too. Anyone with the key controls the wallet — treat it like cash.
      </p>
      {secret ? (
        <div className="mt-4">
          <code className="num block break-all rounded-[10px] border border-rose/40 bg-ink-1 px-4 py-3 text-[12px] text-fg">
            {secret}
          </code>
          <div className="mt-2 flex gap-2">
            <CopyButton value={secret} />
            <button type="button" onClick={() => setSecret(null)} className="btn btn-ghost btn-sm">
              Hide
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run("export", async () => {
              const { secretKey } = await api.exportKey();
              setSecret(secretKey);
            })
          }
          className="btn btn-ghost btn-sm mt-4"
        >
          Reveal secret key for {shortAddress(wallet)}
        </button>
      )}
    </section>
  );
}

/** The address as a QR, for sending from a phone wallet without typing it. */
function DepositQr({ address }: { address: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toString(`solana:${address}`, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#f3f8f8", light: "#00000000" },
    }).then((out) => {
      if (live) setSvg(out);
    });
    return () => {
      live = false;
    };
  }, [address]);
  if (!svg) return <div className="size-[72px] shrink-0 rounded-[8px] bg-ink-3" />;
  return (
    <div
      className="size-[72px] shrink-0 rounded-[8px] border border-line bg-ink p-1.5 [&_svg]:size-full"
      title="Scan to send to this wallet"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-ink-2 px-5 py-4">
      <dt className="eyebrow">{label}</dt>
      <dd className={`num mt-1.5 text-[22px] leading-none ${accent ? "text-mint" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="mt-8 space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <Shimmer className="size-12 rounded-full" />
          <div>
            <Shimmer className="h-4 w-40" />
            <Shimmer className="mt-2 h-3 w-56" />
          </div>
        </div>
        <Shimmer className="mt-6 h-24 w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
