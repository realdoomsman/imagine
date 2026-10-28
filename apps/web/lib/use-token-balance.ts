"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { CHAIN_CHANGED } from "./signer.ts";

/**
 * What `owner` holds of `mint` (base units), kept current across actions.
 *
 * `tokenProgram` is the mint's program: Token-2022 for an IMAGINE coin, either
 * one for a pair asset. For the wrapped-SOL mint the wallet's native SOL is
 * read instead, since that is what a SOL-paired trade spends.
 *
 * Every panel on a coin page reads the same balances, and any of them can
 * change them, so each re-reads when `act` announces a landed transaction.
 * The second read covers an RPC node that answers before it has seen that slot.
 */
export function useTokenBalance(mint: string, tokenProgram: string, owner: PublicKey | null): bigint | null {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!owner) {
      setBalance(null);
      return;
    }
    const native = mint === NATIVE_MINT.toBase58();
    const ata = native
      ? null
      : getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, new PublicKey(tokenProgram));
    let cancelled = false;
    const read = () => {
      const pending = ata
        ? connection.getTokenAccountBalance(ata).then((result) => BigInt(result.value.amount))
        : connection.getBalance(owner).then((lamports) => BigInt(lamports));
      void pending
        .then((amount) => {
          if (!cancelled) setBalance(amount);
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
  }, [connection, mint, owner, tokenProgram]);

  return balance;
}
