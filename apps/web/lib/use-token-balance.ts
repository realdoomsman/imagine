"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { CHAIN_CHANGED } from "./signer.ts";

/**
 * What `owner` holds of `mint`, kept current across actions.
 *
 * Every panel on a coin page reads the same balance, and any of them can
 * change it, so each re-reads when `act` announces a landed transaction. The
 * second read covers an RPC node that answers before it has seen that slot.
 */
export function useTokenBalance(mint: string, owner: PublicKey | null): bigint | null {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!owner) {
      setBalance(null);
      return;
    }
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, TOKEN_2022_PROGRAM_ID);
    let cancelled = false;
    const read = () => {
      void connection
        .getTokenAccountBalance(ata)
        .then((result) => {
          if (!cancelled) setBalance(BigInt(result.value.amount));
        })
        .catch(() => {
          if (!cancelled) setBalance(0n);
        });
    };
    const timers: number[] = [];
    const onChange = () => {
      read();
      timers.push(window.setTimeout(read, 2_500));
    };
    read();
    window.addEventListener(CHAIN_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAIN_CHANGED, onChange);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [connection, mint, owner]);

  return balance;
}
