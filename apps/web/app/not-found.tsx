import Link from "next/link";
import { ImagineMark } from "@/components/imagine-mark";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[760px] flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
      <ImagineMark size={48} className="opacity-60" />
      <p className="eyebrow mt-8">404</p>
      <h1 className="t-h1 mt-3">Imagine a page here.</h1>
      <p className="t-lede mx-auto mt-5 text-center">
        This page doesn&apos;t exist, or the coin you were looking for has no pool on IMAGINE.
      </p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
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
