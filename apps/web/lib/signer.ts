"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useMemo } from "react";
import { api, post } from "./api.ts";
import { signAndSend, type BuiltTransaction } from "./send.ts";
import { useAccount } from "@/components/account-provider";

/**
 * Who is acting, and how their transactions get signed.
 *
 * Two identities can be present: a VISE account (Google) whose wallet the
 * API holds and signs with, and an external wallet extension that signs in
 * the browser. The account wins when both are present — it is the address
 * the account page tells people to deposit into, so it must be the one that
 * acts. Components call `act` and never know which path ran.
 */
export interface Actor {
  /** Both identity sources have reported in. */
  ready: boolean;
  publicKey: PublicKey | null;
  /** "account" for a VISE account, "wallet" for an extension, null for nobody. */
  via: "account" | "wallet" | null;
  /** Run a protocol action; resolves to the transaction signature. */
  act: (action: Record<string, unknown>) => Promise<string>;
}

/** Fired on `window` after any action lands, so panels re-read the chain. */
export const CHAIN_CHANGED = "vise:chain-changed";

export function useActor(): Actor {
  const { ready, account } = useAccount();
  const wallet = useWallet();
  const { connection } = useConnection();

  const publicKey = useMemo(() => {
    if (account) return new PublicKey(account.wallet);
    return wallet.publicKey;
  }, [account, wallet.publicKey]);

  const via: Actor["via"] = account ? "account" : wallet.publicKey ? "wallet" : null;

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      let signature: string;
      if (account) {
        ({ signature } = await api.act(action));
      } else {
        if (!wallet.publicKey) throw new Error("connect a wallet or sign in first");
        const built = await post<BuiltTransaction>("/api/tx/action", {
          owner: wallet.publicKey.toBase58(),
          ...action,
        });
        signature = await signAndSend(connection, wallet, built);
      }
      window.dispatchEvent(new Event(CHAIN_CHANGED));
      return signature;
    },
    [account, wallet, connection],
  );

  return { ready, publicKey, via, act };
}
