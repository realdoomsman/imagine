"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { positionPda } from "@imagine/sdk";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useMemo } from "react";
import { api, post } from "./api.ts";
import { signAndSend, signAndSendAll, type BuiltTransaction, type Expectation } from "./send.ts";
import { useAccount } from "@/components/account-provider";

/**
 * Who is acting, and how their transactions get signed.
 *
 * Two identities can be present: an Imagine wallet (Google sign-in) whose key
 * the API holds and signs with, and an external wallet extension that signs
 * in the browser. The Imagine wallet wins when both are present — it is the
 * address the account page tells people to deposit into, so it must be the
 * one that acts. Components call `act` and never know which path ran.
 */
export interface Actor {
  /** Both identity sources have reported in. */
  ready: boolean;
  publicKey: PublicKey | null;
  /** "account" for an Imagine wallet, "wallet" for an extension, null for nobody. */
  via: "account" | "wallet" | null;
  /**
   * Run a protocol action; resolves to the transaction signature. `expect`
   * holds a wallet-signed trade to what the page showed (`assertTransactionAllowed`).
   */
  act: (action: Record<string, unknown>, expect?: Expectation) => Promise<string>;
  /**
   * Claim every lock with something to pay. `positions` are the locks the
   * page shows; a wallet signs only claims on those, each at most once.
   * `onSent` reports each transaction as it lands; resolves to all of them.
   */
  claimAll: (positions: Array<{ mint: string; index: number }>, onSent: (signature: string) => void) => Promise<string[]>;
}

/** Fired on `window` after any action lands, so panels re-read the chain. */
export const CHAIN_CHANGED = "imagine:chain-changed";

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
    async (action: Record<string, unknown>, expect?: Expectation) => {
      let signature: string;
      if (account) {
        ({ signature } = await api.act(action));
      } else {
        if (!wallet.publicKey) throw new Error("connect a wallet or sign in first");
        const built = await post<BuiltTransaction>("/api/tx/action", {
          owner: wallet.publicKey.toBase58(),
          ...action,
        });
        signature = await signAndSend(connection, wallet, built, [], expect);
      }
      window.dispatchEvent(new Event(CHAIN_CHANGED));
      return signature;
    },
    [account, wallet, connection],
  );

  const claimAll = useCallback(
    async (positions: Array<{ mint: string; index: number }>, onSent: (signature: string) => void) => {
      let signatures: string[];
      if (account) {
        ({ signatures } = await api.claimAll());
        signatures.forEach(onSent);
      } else {
        const owner = wallet.publicKey;
        if (!owner) throw new Error("connect a wallet or sign in first");
        const { transactions } = await post<{ transactions: BuiltTransaction[] }>("/api/tx/claim-all", {
          owner: owner.toBase58(),
        });
        const expect: Expectation = {
          kind: "claims",
          positions: new Set(positions.map((p) => positionPda(new PublicKey(p.mint), owner, p.index).toBase58())),
        };
        signatures = await signAndSendAll(connection, wallet, transactions, expect, onSent);
      }
      window.dispatchEvent(new Event(CHAIN_CHANGED));
      return signatures;
    },
    [account, wallet, connection],
  );

  return { ready, publicKey, via, act, claimAll };
}
