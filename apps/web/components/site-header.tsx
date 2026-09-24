"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { VISE_MINT } from "@/lib/official";
import { ViseMark } from "./vise-mark";
import { ConnectButton } from "./connect-button";

const NAV = [
  { href: "/coins", label: "Coins" },
  { href: "/launch", label: "Launch" },
  { href: "/account", label: "Wallet" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [lifted, setLifted] = useState(false);

  // The bar is transparent over the hero and condenses into glass once the
  // page has moved — so the mechanism is never fighting a chrome bar for
  // attention at the top of the fold.
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:pt-5">
      <div
        data-lifted={lifted}
        className="pointer-events-auto flex h-[54px] w-full max-w-[1180px] items-center gap-2 rounded-full border px-2.5 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] data-[lifted=false]:border-transparent data-[lifted=false]:bg-transparent data-[lifted=true]:border-white/8 data-[lifted=true]:bg-steel-900/72 data-[lifted=true]:shadow-[0_18px_50px_-24px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.07)] data-[lifted=true]:backdrop-blur-xl"
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-full px-2.5 py-1.5 text-steel-50"
          aria-label="VISE home"
        >
          <span className="text-torch transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-90">
            <ViseMark size={20} grip={0.5} />
          </span>
          <span className="font-display text-[16px] font-bold tracking-[-0.04em]">
            VISE
          </span>
        </Link>

        <nav className="hidden items-center md:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors duration-200 ${
                  active ? "text-steel-50" : "text-steel-400 hover:text-steel-100"
                }`}
              >
                {item.label}
                {/* The active marker is a lit filament, not a filled chip. */}
                <span
                  className={`absolute inset-x-3.5 -bottom-px h-px transition-opacity duration-300 ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, var(--color-torch), transparent)",
                  }}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/coins/${VISE_MINT}`}
            className="num rounded-full border border-torch/50 bg-torch/10 px-3 py-1.5 text-[12.5px] font-semibold text-torch transition-colors duration-200 hover:bg-torch/20"
          >
            $VISE
          </Link>
          <a
            href="https://x.com/visedotfun"
            target="_blank"
            rel="noreferrer"
            aria-label="VISE on X"
            className="hidden size-9 items-center justify-center rounded-full text-steel-500 transition-colors duration-200 hover:bg-white/5 hover:text-steel-100 sm:flex"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

/**
 * Phone navigation: the floating pill has no room for links below `md`, so
 * the same four destinations sit in a bar at the bottom of the screen where
 * a thumb already is. Hidden from `md` up, where the header carries them.
 */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-steel-990/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-1 text-[11.5px] font-medium tracking-[0.02em] ${
                  active ? "text-steel-50" : "text-steel-500"
                }`}
              >
                <NavGlyph name={item.label} active={active} />
                {item.label}
                {active ? (
                  <span
                    className="absolute inset-x-6 top-0 h-px"
                    style={{ background: "linear-gradient(90deg, transparent, var(--color-torch), transparent)" }}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavGlyph({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? "var(--color-torch)" : "currentColor";
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "Coins":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M9 12h6M12 9v6" />
        </svg>
      );
    case "Launch":
      return (
        <svg {...common}>
          <path d="M5 19l4-4M14 4l6 6-8 8-6-6z" />
        </svg>
      );
    case "Wallet":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M16 12h5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 20h16M7 20V10M12 20V4M17 20v-7" />
        </svg>
      );
  }
}
