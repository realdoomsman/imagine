import type { Metadata } from "next";
import { AccountView } from "@/components/account-view";

// A signed-in view with nothing to index; the sitemap and robots.txt leave it out too.
export const metadata: Metadata = {
  title: "Your wallet",
  description: "Your locks, what they're earning in each pair asset, and your Imagine wallet.",
  robots: { index: false, follow: true },
};

export default function AccountPage() {
  return (
    <div className="container-x max-w-[1100px] py-14 lg:py-20">
      <p className="eyebrow">Account</p>
      <h1 className="t-h1 mt-4">
        Your <span className="dream-text">stream.</span>
      </h1>
      <p className="t-lede mt-4">Your locks, what they&apos;re earning in each pair asset, and your Imagine wallet.</p>
      <AccountView />
    </div>
  );
}
