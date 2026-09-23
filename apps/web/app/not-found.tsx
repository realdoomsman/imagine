import Link from "next/link";
import { ViseMark } from "@/components/vise-mark";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[820px] flex-col items-start px-5 py-28">
      <span className="text-torch">
        <ViseMark size={34} grip={1} />
      </span>
      <p className="rule-label mt-8">404</p>
      <h1 className="mt-3 text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.02]">
        Nothing clamped here.
      </h1>
      <p className="mt-5 max-w-lg text-[16px] text-steel-400">
        This page does not exist, or the coin you were looking for has no pool on
        VISE.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
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
