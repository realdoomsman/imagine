import Link from "next/link";
import { IMAGINE_PROGRAM_ID, STONKFUN_URL } from "@imagine/sdk";
import { IMAGINE_MINT } from "@/lib/official";
import { OfficialCa } from "./official-coin";
import { ImagineLogo } from "./imagine-mark";
import { NAV, X_URL } from "./site-header-links";

export function SiteFooter() {
  const elsewhere = [
    { href: STONKFUN_URL, label: "StonkFun" },
    ...(X_URL ? [{ href: X_URL, label: "X" }] : []),
  ];

  return (
    <footer className="relative border-t border-line bg-ink-1 pb-16 lg:pb-0">
      <div className="container-x grid gap-12 py-14 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <ImagineLogo size={28} />
          <p className="mt-4 max-w-[36ch] text-[14px] leading-relaxed text-fg-soft">
            Lock the meme. Earn its pair. Every trade on an IMAGINE coin pays the holders who
            locked it, in the asset it&apos;s paired with.
          </p>
          <a
            href={STONKFUN_URL}
            target="_blank"
            rel="noreferrer"
            className="pill pill-pair mt-6 h-8 px-3 transition-colors hover:border-line-strong"
          >
            <i className="pill-dot" aria-hidden="true" />
            <span className="pill-label">Coins launch on</span>
            <b className="font-sans">StonkFun</b>
            <span aria-hidden="true" className="text-muted">
              ↗
            </span>
          </a>
          {IMAGINE_MINT ? (
            <div className="mt-6">
              <p className="eyebrow">Official $IMAGINE contract</p>
              <OfficialCa className="mt-2" />
            </div>
          ) : null}
        </div>

        <FooterColumn title="Product" links={NAV.slice(0, 3)} />
        <FooterColumn
          title="Learn"
          links={[
            { href: "/how-it-works", label: "How it works" },
            { href: "/docs", label: "Docs" },
            { href: "/docs/fees", label: "Fees" },
            { href: "/docs/security", label: "Security" },
            { href: "/article", label: "The idea" },
          ]}
        />
        <FooterColumn
          title="Elsewhere"
          links={[
            ...elsewhere.map((link) => ({ ...link, external: true })),
            { href: "/terms", label: "Terms" },
            { href: "/privacy", label: "Privacy" },
          ]}
        />
      </div>

      <div className="border-t border-line">
        <div className="container-x flex flex-col gap-2 py-5 text-[11.5px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="num break-all">Program {IMAGINE_PROGRAM_ID.toBase58()}</span>
          <span>
            Locked tokens are at risk. Memecoins can go to zero. Nothing here is financial advice.
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
  const linkClass = "text-[13.5px] text-fg-soft transition-colors hover:text-fg";
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
                {link.label}
              </a>
            ) : (
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
