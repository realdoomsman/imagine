"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImagineLogo } from "./imagine-mark";
import { ConnectButton } from "./connect-button";
import { NAV, X_URL } from "./site-header-links";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur-xl">
      <div className="container-x flex h-16 items-center gap-6">
        <Link href="/" className="shrink-0 rounded-btn" aria-label="IMAGINE home">
          <ImagineLogo size={28} />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-btn px-3 py-2 text-[14px] font-semibold transition-colors duration-150 ${
                  active ? "bg-ink-3 text-fg" : "text-fg-soft hover:text-fg"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {X_URL ? (
            <SocialIcon href={X_URL} label="IMAGINE on X">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </SocialIcon>
          ) : null}
          <Link href="/launch" className="btn btn-primary btn-sm hidden font-bold sm:inline-flex">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Launch coin
          </Link>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function SocialIcon({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="hidden size-9 items-center justify-center rounded-btn border border-line bg-ink-2 text-fg-soft transition-colors duration-150 hover:border-line-strong hover:text-fg sm:flex"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </a>
  );
}

const TABS = [
  { href: "/coins", label: "Coins" },
  { href: "/launch", label: "Launch" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/how-it-works", label: "Learn" },
  { href: "/account", label: "Wallet" },
] as const;

/**
 * Phone navigation: the header has no room for links below `lg`, so the
 * destinations sit in a bar at the bottom of the screen where a thumb already
 * is. Docs stay one tap away through "Learn" and the footer.
 */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  active ? "text-fg" : "text-muted"
                }`}
              >
                <TabGlyph href={item.href} active={active} />
                {item.label}
                {active ? (
                  <span className="absolute inset-x-5 top-0 h-[2px] rounded-full" style={{ background: "var(--dream)" }} />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TabGlyph({ href, active }: { href: string; active: boolean }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: active ? "var(--mint)" : "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (href) {
    case "/coins":
      return (
        <svg {...common}>
          <path d="M3 17l5-5 4 3 8-8" />
          <path d="M15 7h5v5" />
        </svg>
      );
    case "/launch":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="5" />
          <path d="M12 8.5v7M8.5 12h7" />
        </svg>
      );
    case "/leaderboard":
      return (
        <svg {...common}>
          <path d="M4 20h16M7 20V11M12 20V5M17 20v-6" />
        </svg>
      );
    case "/how-it-works":
      return (
        <svg {...common}>
          <circle cx="12" cy="6.5" r="2" />
          <rect x="10" y="11" width="4" height="9" rx="2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M16 12.5h5" />
        </svg>
      );
  }
}
