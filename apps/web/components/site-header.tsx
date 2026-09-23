"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ViseMark } from "./vise-mark";
import { ConnectButton } from "./connect-button";

const NAV = [
  { href: "/coins", label: "Coins" },
  { href: "/launch", label: "Launch" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-steel-700 bg-steel-950/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-8 px-5">
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-steel-50"
          aria-label="VISE home"
        >
          <span className="text-torch transition-transform duration-200 group-hover:scale-95">
            <ViseMark size={22} grip={0.5} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">
            VISE
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-machined px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-steel-850 text-steel-50"
                    : "text-steel-400 hover:text-steel-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://x.com/visedotfun"
            target="_blank"
            rel="noreferrer"
            className="hidden text-[13px] text-steel-500 transition-colors hover:text-steel-200 sm:block"
          >
            X
          </a>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
