"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { GoogleSignIn } from "./google-signin";

/**
 * The two ways in, side by side. Shown wherever an action needs someone to be
 * acting: Google for people without a wallet, the modal for people with one.
 */
export function SignInPrompt({ what }: { what: string }) {
  const { setVisible } = useWalletModal();
  return (
    <div className="rounded-machined border border-steel-780 bg-steel-950/60 p-4">
      <p className="text-[13px] text-steel-400">
        Sign in to {what}. A Google account gets a VISE wallet; an extension
        wallet works as it is.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <GoogleSignIn />
        <button type="button" onClick={() => setVisible(true)} className="btn btn-ghost h-[46px] w-full">
          Connect a wallet
        </button>
      </div>
    </div>
  );
}
