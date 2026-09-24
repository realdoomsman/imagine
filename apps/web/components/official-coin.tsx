"use client";

import Link from "next/link";
import { useState } from "react";
import { VISE_MINT } from "@/lib/official";

/** The official CA with a copy button. */
export function OfficialCa({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(VISE_MINT).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
      title="Copy the contract address"
      className={`num inline-flex max-w-full items-center gap-2 rounded-machined border border-steel-700 bg-steel-950/60 px-3 py-2 text-left text-[12px] text-steel-300 transition-colors hover:border-torch/60 hover:text-steel-50 ${className}`}
    >
      <span className="truncate">{VISE_MINT}</span>
      <span className="shrink-0 text-torch">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** The official coin, front and centre on the home page. */
export function OfficialCoinBanner() {
  return (
    <section className="relative mx-auto max-w-[1440px] px-5 pt-10 sm:px-8">
      <div className="panel flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="min-w-0">
          <p className="rule-label text-torch">Official</p>
          <h2 className="mt-2 text-[24px] leading-tight">$VISE is live</h2>
          <p className="mt-1.5 max-w-[56ch] text-[13.5px] text-steel-400">
            The first coin running on VISE. Lock it, earn SOL from its fees. This is the only official
            contract address; anything else called VISE is fake.
          </p>
          <OfficialCa className="mt-4" />
        </div>
        <Link href={`/coins/${VISE_MINT}`} className="btn btn-primary h-11 px-6">
          Buy &amp; lock $VISE
        </Link>
      </div>
    </section>
  );
}
