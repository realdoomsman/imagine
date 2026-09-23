"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { shortAddress } from "@vise/sdk";

/**
 * Deliberately not the wallet-adapter default button: that component ships its
 * own purple styling and is one of the clearest "template site" tells.
 */
export function ConnectButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => void disconnect()}
        className="btn btn-ghost num text-[13px]"
        title="Disconnect"
      >
        <span className="size-1.5 rounded-full bg-verdi" />
        {shortAddress(publicKey.toBase58())}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      disabled={connecting}
      className="btn btn-primary"
    >
      {connecting ? "Connecting" : "Connect"}
    </button>
  );
}
