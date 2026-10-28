import { formatDuration, formatMultiplier, formatTokenAmount, shortAddress } from "@imagine/sdk";
import Link from "next/link";
import { api, type Leaderboard } from "@/lib/api";
import { formatQuote, formatUsd } from "@/lib/format";
import { ImagineMark } from "@/components/imagine-mark";
import { PairPill } from "@/components/pair-pill";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/leaderboard",
  title: "Leaderboard",
  description:
    "Top earners, top coins and the longest locks on Imagine — ranked on rewards actually paid and live on-chain commitments.",
});

export const dynamic = "force-dynamic";

const BOARDS = [
  { key: "earners", label: "Top earners", note: "Rewards actually claimed, in every pair asset, ranked by USD value." },
  { key: "coins", label: "Top coins", note: "Earned by each coin's lockers (claimed or not), in its pair asset, ranked by USD value." },
  { key: "diamond", label: "Longest locks", note: "Live positions, ranked by the term they committed to." },
] as const;

type BoardKey = (typeof BOARDS)[number]["key"];

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const params = await searchParams;
  const active = BOARDS.find((b) => b.key === params.board) ?? BOARDS[0];

  let data: Leaderboard | null = null;
  let failed = false;
  try {
    // Tag the rows with the board that was asked for, whatever the response echoes.
    const { rows } = await api.leaderboard<BoardKey>(active.key);
    data = { board: active.key, rows } as Leaderboard;
  } catch (cause) {
    // The reason stays in the server log; visitors get a plain sentence.
    console.error("leaderboard: load failed", cause);
    failed = true;
  }

  return (
    <div className="container-x max-w-[1100px] py-14 lg:py-20">
      <p className="eyebrow">Leaderboard</p>
      <h1 className="t-h1 mt-4">
        Ranked on what was <span className="dream-text">paid.</span>
      </h1>
      <p className="t-lede mt-4">
        Every board is built from rewards that actually landed or locks that are live on chain. No points, no season,
        nothing to farm.
      </p>

      <nav className="mt-8 flex flex-wrap gap-1.5" aria-label="Board">
        {BOARDS.map((option) => (
          <Link
            key={option.key}
            href={`/leaderboard?board=${option.key}`}
            aria-current={active.key === option.key ? "page" : undefined}
            className={`pill transition-colors ${
              active.key === option.key ? "border-transparent bg-steel text-ink" : "hover:border-line-strong hover:text-fg"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-[12.5px] text-muted">{active.note}</p>

      {failed ? (
        <Empty
          title="The leaderboard isn't answering"
          body="The index didn't answer. Every claim and lock is on-chain either way; try again in a moment."
        />
      ) : !data || data.rows.length === 0 ? (
        <Empty
          title="Nothing to rank yet"
          body={
            active.key === "coins"
              ? "Coins show up here once their lockers have been paid. The first coin launched through IMAGINE leads this board."
              : active.key === "diamond"
                ? "Live locks show up here, longest term first. The first one is the founding lock of the first coin launched."
                : "Claims show up here as lockers collect what their locks earned. The first coin launched starts the stream."
          }
        >
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link href="/launch" className="btn btn-dream btn-sm">
              Launch the first coin
            </Link>
            <Link href="/coins" className="btn btn-ghost btn-sm">
              Browse coins
            </Link>
          </div>
        </Empty>
      ) : (
        <ol className="card mt-6 divide-y divide-line overflow-hidden">
          {data.board === "earners"
            ? data.rows.map((row, index) => (
                <Row key={row.owner} index={index}>
                  <div className="min-w-0 flex-1">
                    <p className="num text-[14px] text-fg">{shortAddress(row.owner)}</p>
                    <p className="num mt-0.5 truncate text-[12px] text-muted">
                      {row.earned.map((entry) => formatQuote(entry.amount, entry.quote)).join(" · ") || "—"}
                    </p>
                  </div>
                  <Value primary={formatUsd(row.earned_usd)} secondary={`${row.coins} coin${row.coins === 1 ? "" : "s"}`} />
                </Row>
              ))
            : data.board === "coins"
              ? data.rows.map((row, index) => (
                  <Row key={row.mint} index={index}>
                    <CoinThumb src={row.image_url} symbol={row.symbol} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/coins/${row.mint}`} className="text-[14px] font-semibold text-fg hover:text-steel-hi">
                        ${row.symbol ?? shortAddress(row.mint)}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <PairPill quote={row.quote} label="" className="h-[22px] px-2 text-[11px]" />
                        <span className="text-[12px] text-muted">
                          {row.open_positions} lock{row.open_positions === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    <Value
                      primary={formatQuote(row.lifetime_rewards, row.quote)}
                      secondary={row.lifetime_rewards_usd !== null ? `≈ ${formatUsd(row.lifetime_rewards_usd)}` : null}
                    />
                  </Row>
                ))
              : data.rows.map((row, index) => (
                  <Row key={`${row.owner}-${row.mint}-${index}`} index={index}>
                    <CoinThumb src={row.image_url} symbol={row.symbol} />
                    <div className="min-w-0 flex-1">
                      <p className="num text-[14px] text-fg">{shortAddress(row.owner)}</p>
                      <p className="mt-0.5 truncate text-[12px] text-muted">
                        <Link href={`/coins/${row.mint}`} className="hover:text-fg">
                          ${row.symbol ?? shortAddress(row.mint)}
                        </Link>{" "}
                        · <span className="num">{formatTokenAmount(BigInt(row.amount), row.token_decimals)}</span> ·{" "}
                        <span className="num text-steel-hi">{formatMultiplier(row.multiplier_bps)}</span>
                      </p>
                    </div>
                    <Value
                      primary={formatDuration(row.term_secs)}
                      secondary={`until ${new Date(row.lock_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                    />
                  </Row>
                ))}
        </ol>
      )}
    </div>
  );
}

function Row({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5 transition-colors duration-200 hover:bg-ink-3/60 sm:px-6">
      {/* The top three earn the signature; the rest are a ranked list. */}
      <span className={`num w-7 shrink-0 text-[13px] ${index < 3 ? "dream-text font-semibold" : "text-muted"}`}>
        {String(index + 1).padStart(2, "0")}
      </span>
      {children}
    </li>
  );
}

function Value({ primary, secondary }: { primary: string; secondary: string | null }) {
  return (
    <div className="shrink-0 text-right">
      <p className="num text-[15px] text-fg">{primary}</p>
      {secondary ? <p className="num mt-0.5 text-[11.5px] text-muted">{secondary}</p> : null}
    </div>
  );
}

function CoinThumb({ src, symbol }: { src: string | null; symbol: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- coin images live on the API's file host
    <img src={src} alt="" className="size-9 shrink-0 rounded-[8px] border border-line bg-ink-3 object-cover" loading="lazy" />
  ) : (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-line bg-ink-3 text-[13px] font-bold text-muted">
      {(symbol ?? "?").slice(0, 1)}
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card mt-6 flex flex-col items-center gap-3 px-8 py-16 text-center">
      <ImagineMark size={40} className="opacity-40" />
      <h2 className="t-h3">{title}</h2>
      <p className="max-w-[52ch] break-words text-[13.5px] text-muted">{body}</p>
      {children}
    </div>
  );
}
