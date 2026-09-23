import { AccountView } from "@/components/account-view";

export const metadata = { title: "Your wallet" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-16 sm:px-8 lg:py-20">
      <p className="rule-label">Account</p>
      <h1 className="t-section mt-5">Your wallet.</h1>
      <AccountView />
    </div>
  );
}
