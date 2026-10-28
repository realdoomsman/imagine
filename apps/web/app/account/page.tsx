import { AccountView } from "@/components/account-view";

export const metadata = { title: "Your wallet" };

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
