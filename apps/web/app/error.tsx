"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ViseMark } from "@/components/vise-mark";

/**
 * Route error boundary.
 *
 * Says what broke and what still works. A memecoin site that swallows an error
 * behind "something went wrong" teaches people their money might be gone; being
 * explicit that funds live on-chain and the program never stops is the point.
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
    <div className="mx-auto flex min-h-[70vh] max-w-[760px] flex-col items-center justify-center px-5 py-28 text-center sm:px-8">
      <span className="text-rust">
        <ViseMark size={40} grip={0.2} />
      </span>
      <p className="rule-label mt-8">Something slipped</p>
      <h1 className="t-section mt-4">This page could not load.</h1>
      <p className="t-lede mx-auto mt-6 text-center">
        Your locks and rewards are on-chain and untouched by this. Claiming and
        unlocking never depend on this site being up.
      </p>
      {error.digest ? (
        <p className="num mt-6 text-[12px] text-steel-600">
          Reference {error.digest}
        </p>
      ) : null}
      <div className="mt-10 flex flex-wrap justify-center gap-3">
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
