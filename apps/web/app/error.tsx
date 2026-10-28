"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ImagineMark } from "@/components/imagine-mark";

/**
 * Route error boundary. Says what broke and what still works: funds live
 * on-chain and claiming never depends on this site.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[760px] flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
      <ImagineMark size={44} className="opacity-60" />
      <p className="eyebrow mt-8">Something broke</p>
      <h1 className="t-h1 mt-3">This page couldn&apos;t load.</h1>
      <p className="t-lede mx-auto mt-5 text-center">
        Your locks and rewards are on-chain and untouched by this. Claiming and unlocking never
        depend on this site being up.
      </p>
      {error.digest ? <p className="num mt-5 text-[12px] text-muted">Reference {error.digest}</p> : null}
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
