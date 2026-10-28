import { QUOTE_CATEGORIES } from "@imagine/sdk";
import Link from "next/link";
import { api, type PoolSummary } from "@/lib/api";
import { categoryLabel } from "@/lib/quotes";
import { IMAGINE_MINT } from "@/lib/official";
import { CoinCard } from "@/components/coin-card";
import { ImagineMark } from "@/components/imagine-mark";

export const metadata = {
  title: "Coins",
  description:
    "Every coin launched on Raydium through Imagine, paired with SOL, USDC or a tokenized stock. See how much of each is locked and what its lockers have been paid.",
};

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "new", label: "Newest" },
  { key: "mcap", label: "Market cap" },
  { key: "rewards", label: "Most paid out" },
  { key: "locked", label: "Most locked" },
  { key: "lockers", label: "Most lockers" },
] as const;

type Params = { sort?: string; q?: string; cat?: string };

function href(params: Params, change: Params): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...change })) if (value) next.set(key, value);
  const query = next.toString();
  return query ? `/coins?${query}` : "/coins";
}

export default async function CoinsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort = SORTS.some((s) => s.key === params.sort) ? params.sort! : "new";
  const search = params.q?.trim() || undefined;
  const category = params.cat?.trim().toLowerCase() || undefined;
  const current: Params = { sort: sort === "new" ? undefined : sort, q: search, cat: category };

  let pools: PoolSummary[] = [];
  let error: string | null = null;
  const [poolsResult, quotesResult] = await Promise.allSettled([
    api.pools({ sort, search, category, limit: 60 }),
    api.quotes(),
  ]);
  if (poolsResult.status === "fulfilled") {
    pools = category
      ? poolsResult.value.pools.filter((pool) => pool.quote.category.toLowerCase() === category)
      : poolsResult.value.pools;
    // The official coin leads the unfiltered list, once there is one.
    if (IMAGINE_MINT && !search && !category) {
      const official = pools.find((pool) => pool.mint === IMAGINE_MINT);
      if (official) pools = [official, ...pools.filter((pool) => pool.mint !== IMAGINE_MINT)];
    }
  } else {
    error = poolsResult.reason instanceof Error ? poolsResult.reason.message : "could not reach the indexer";
  }

  // Filter chips for the categories actually offered as pairs; the full list
  // when the pair list is unavailable.
  const known: string[] = QUOTE_CATEGORIES.map((entry) => entry.id);
  const offered =
    quotesResult.status === "fulfilled"
      ? [...new Set(quotesResult.value.map((quote) => quote.category.toLowerCase()))]
      : known;
  const categories = known
    .filter((id) => offered.includes(id))
    .concat(offered.filter((id) => !known.includes(id)));
  if (category && !categories.includes(category)) categories.push(category);

  return (
    <div className="container-x py-14 lg:py-20">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Coins</p>
          <h1 className="t-h1 mt-4">
            Imagine everyone <span className="dream-text">locks.</span>
          </h1>
          <p className="t-lede mt-4">
            Coins launched on Raydium with an Imagine pool. Each one pays its lockers in the asset it&apos;s paired with.
          </p>
        </div>
        <form action="/coins" className="flex w-full gap-2 sm:w-auto" role="search">
          {current.sort ? <input type="hidden" name="sort" value={current.sort} /> : null}
          {category ? <input type="hidden" name="cat" value={category} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search name, ticker or mint"
            aria-label="Search coins"
            className="input w-full text-[14px] sm:w-[300px]"
          />
          <button type="submit" className="btn btn-ghost shrink-0">
            Search
          </button>
        </form>
      </header>

      <div className="mt-8 space-y-3">
        <nav aria-label="Pair category" className="flex flex-wrap gap-1.5">
          <Chip href={href(current, { cat: undefined })} active={!category}>
            All pairs
          </Chip>
          {categories.map((slug) => (
            <Chip key={slug} href={href(current, { cat: slug })} active={category === slug}>
              {categoryLabel(slug)}
            </Chip>
          ))}
        </nav>
        <nav aria-label="Sort" className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1">Sort</span>
          {SORTS.map((option) => (
            <Chip
              key={option.key}
              href={href(current, { sort: option.key === "new" ? undefined : option.key })}
              active={sort === option.key}
              subtle
            >
              {option.label}
            </Chip>
          ))}
        </nav>
      </div>

      {error ? (
        <EmptyState title="The indexer isn't answering" body={`Coins can't be listed right now. ${error}`} />
      ) : pools.length === 0 ? (
        search || category ? (
          <EmptyState
            title="Nothing matches"
            body={`No coin${category ? ` paired with ${categoryLabel(category)}` : ""}${search ? ` matches “${search}”` : ""} yet.`}
            action={{ href: "/coins", label: "Clear filters" }}
          />
        ) : (
          <EmptyState
            title="No coins yet"
            body="Nothing has launched through Imagine yet. Pick a pair, launch on Raydium, and be the first pool."
            action={{ href: "/launch", label: "Launch a coin" }}
          />
        )
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pools.map((pool) => (
            <CoinCard key={pool.mint} pool={pool} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  subtle = false,
  children,
}: {
  href: string;
  active: boolean;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`pill shrink-0 transition-colors ${
        active
          ? subtle
            ? "pill-steel"
            : "border-transparent bg-steel text-ink"
          : "hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </Link>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="card mt-10 flex flex-col items-center gap-4 px-8 py-20 text-center">
      <ImagineMark size={44} className="opacity-40" />
      <h2 className="t-h3 max-w-[26ch]">{title}</h2>
      <p className="max-w-[52ch] break-words text-[14.5px] leading-relaxed text-muted">{body}</p>
      {action ? (
        <Link href={action.href} className="btn btn-primary mt-2">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
