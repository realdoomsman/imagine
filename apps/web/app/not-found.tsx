import Link from "next/link";
import { ViseMark } from "@/components/vise-mark";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[760px] flex-col items-center justify-center px-5 py-28 text-center sm:px-8">
      {/* Jaws open on nothing. */}
      <span className="text-steel-700">
        <ViseMark size={46} grip={0} />
      </span>
      <p className="rule-label mt-9">404</p>
      <h1 className="t-section mt-4">Nothing clamped here.</h1>
      <p className="t-lede mx-auto mt-6 text-center">
        This page does not exist, or the coin you were looking for has no pool on
        VISE.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Link href="/coins" className="btn btn-primary">
          Browse coins
        </Link>
        <Link href="/" className="btn btn-ghost">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
