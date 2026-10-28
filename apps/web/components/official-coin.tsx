"use client";

import Link from "next/link";
import { useState } from "react";
import { IMAGINE_MINT } from "@/lib/official";
import { ImagineMark } from "./imagine-mark";

/** The official CA with a copy button. Renders nothing until a mint is configured. */
export function OfficialCa({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!IMAGINE_MINT) return null;
  const mint = IMAGINE_MINT;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(mint).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
      title="Copy the contract address"
      className={`num inline-flex max-w-full items-center gap-2 rounded-btn border border-line bg-ink-1 px-3 py-2 text-left text-[12px] text-fg-soft transition-colors hover:border-line-strong hover:text-fg ${className}`}
    >
      <span className="truncate">{mint}</span>
      <span className="shrink-0 text-mint">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** The official coin on the home page, shown only once its mint is configured. */
export function OfficialCoinBanner() {
  if (!IMAGINE_MINT) return null;
  return (
    <section className="container-x pt-10">
      <div className="card card-dream flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex min-w-0 items-start gap-4">
          <ImagineMark size={44} className="shrink-0" />
          <div className="min-w-0">
            <p className="eyebrow">Official</p>
            <h2 className="mt-1.5 text-[22px] leading-tight">$IMAGINE</h2>
            <p className="mt-1.5 max-w-[56ch] text-[13.5px] text-fg-soft">
              This is the only official $IMAGINE contract address. Anything else using the name is
              not ours.
            </p>
            <OfficialCa className="mt-4" />
          </div>
        </div>
        <Link href={`/coins/${IMAGINE_MINT}`} className="btn btn-dream">
          Buy &amp; lock $IMAGINE
        </Link>
      </div>
    </section>
  );
}
