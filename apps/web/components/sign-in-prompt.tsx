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
    <div className="well @container p-4">
      <p className="text-[13px] leading-relaxed text-fg-soft">
        Sign in to {what}. A Google account gets an Imagine wallet; an extension wallet works as it is.
      </p>
      <div className="mt-3 grid gap-2 @sm:grid-cols-2">
        <GoogleSignIn />
        <button type="button" onClick={() => setVisible(true)} className="btn btn-ghost w-full">
          Connect a wallet
        </button>
      </div>
    </div>
  );
}
