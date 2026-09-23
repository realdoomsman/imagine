"use client";

import { ConnectionProvider, WalletProvider as BaseWalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useMemo } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Wallet Standard auto-discovers Phantom, Solflare, Backpack and friends, so
  // no adapter list is needed and none is bundled.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC} config={{ commitment: "confirmed" }}>
      <BaseWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </BaseWalletProvider>
    </ConnectionProvider>
  );
}
