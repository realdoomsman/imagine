import Link from "next/link";
import { ViseMark } from "./vise-mark";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-steel-780 pb-16 md:pb-0">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 text-steel-50">
            <span className="text-torch">
              <ViseMark size={20} grip={0.6} />
            </span>
            <span className="font-display text-[16px] font-bold tracking-[-0.04em]">
              VISE
            </span>
          </div>
          <p className="mt-4 max-w-[34ch] text-[13.5px] leading-relaxed text-steel-500">
            Lock pump.fun coins. Earn the fees they generate. Longer locks take a
            larger share.
          </p>
          <p className="rule-label mt-6">Hold under pressure</p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { href: "/coins", label: "Coins" },
            { href: "/launch", label: "Launch" },
            { href: "/account", label: "Wallet" },
            { href: "/leaderboard", label: "Leaderboard" },
          ]}
        />
        <FooterColumn
          title="Learn"
          links={[
            { href: "/how-it-works", label: "How it works" },
            { href: "/docs/fees", label: "Fees" },
            { href: "/docs/security", label: "Security" },
            { href: "/privacy", label: "Privacy" },
            { href: "/terms", label: "Terms" },
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

      {/*
        A wordmark at the very bottom, cropped by the viewport. Gives the page
        an ending instead of trailing off into legal text.
      */}
      <div className="relative select-none overflow-hidden" aria-hidden="true">
        <div className="font-display text-[clamp(5rem,21vw,17rem)] font-bold leading-[0.78] tracking-[-0.06em] text-steel-900">
          VISE
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-steel-990 to-transparent" />
      </div>

      <div className="relative border-t border-steel-860">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 py-5 text-[11px] text-steel-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
