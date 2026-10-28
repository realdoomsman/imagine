"use client";

import { ConnectionProvider, WalletProvider as BaseWalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useMemo } from "react";
// Vendored without upstream's Google Fonts @import; see the file's header.
import "./wallet-adapter.css";

// IMAGINE coins live on mainnet only. Production points both at the API's proxy
// (https://api.imagine.fun/rpc, wss://api.imagine.fun/rpc-ws) so no keyed RPC
// URL ships in the bundle; a local fork sets NEXT_PUBLIC_RPC_URL directly.
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.mainnet-beta.solana.com";
// Unset: web3.js derives the websocket from the RPC URL.
const WS = process.env.NEXT_PUBLIC_WS_URL || undefined;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Wallet Standard auto-discovers Phantom, Solflare, Backpack and friends, so
  // no adapter list is needed and none is bundled.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC} config={{ commitment: "confirmed", wsEndpoint: WS }}>
      <BaseWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </BaseWalletProvider>
    </ConnectionProvider>
  );
}
