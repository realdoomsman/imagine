import Link from "next/link";
import { ViseMark } from "./vise-mark";

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-steel-700">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-5 py-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 text-steel-50">
            <span className="text-torch">
              <ViseMark size={20} grip={0.6} />
            </span>
            <span className="font-display text-[15px] font-bold">VISE</span>
          </div>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-steel-500">
            Lock pump.fun coins. Earn the fees they generate. Longer locks take a
            larger share.
          </p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { href: "/coins", label: "Coins" },
            { href: "/launch", label: "Launch" },
            { href: "/portfolio", label: "Portfolio" },
            { href: "/leaderboard", label: "Leaderboard" },
          ]}
        />
        <FooterColumn
          title="Learn"
          links={[
            { href: "/how-it-works", label: "How it works" },
            { href: "/docs/fees", label: "Fees" },
            { href: "/docs/security", label: "Security" },
          ]}
        />
        <FooterColumn
          title="Elsewhere"
          links={[
            { href: "https://x.com/visedotfun", label: "X", external: true },
            {
              href: "https://github.com/pump-fun/pump-public-docs",
              label: "pump.fun docs",
              external: true,
            },
          ]}
        />
      </div>

      <div className="border-t border-steel-800">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-5 py-5 text-[11px] text-steel-600 sm:flex-row sm:items-center sm:justify-between">
          <span className="num">
            Program VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb
          </span>
          <span>
            Locked tokens are at risk. Memecoins can go to zero. Nothing here is
            financial advice.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div>
      <h3 className="rule-label">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-steel-400 transition-colors hover:text-steel-100"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-[13px] text-steel-400 transition-colors hover:text-steel-100"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
