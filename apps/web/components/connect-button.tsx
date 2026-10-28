"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { shortAddress } from "@imagine/sdk";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-provider";
import { GoogleSignIn } from "./google-signin";

/**
 * The identity control in the header.
 *
 * Signed out: one button opening a small sheet with both ways in. Signed in
 * with a VISE account: the avatar, linking to the account page. Connected
 * with an extension: the address, with disconnect. Deliberately not the
 * wallet-adapter default button — that component ships its own purple styling
 * and is one of the clearest "template site" tells.
 */
export function ConnectButton() {
  const { ready, account } = useAccount();
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!sheet.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (account) {
    return (
      <Link
        href="/account"
        className="btn btn-ghost h-[38px] gap-2.5 rounded-full pl-1.5 pr-4 text-[12.5px]"
        title={account.email}
      >
        {account.picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- Google-hosted avatar
          <img src={account.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-torch text-[12px] font-bold text-[#190600]">
            {(account.name ?? account.email).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="num">{shortAddress(account.wallet)}</span>
      </Link>
    );
  }

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={() => void disconnect()}
        className="btn btn-ghost num h-[38px] rounded-full px-4 text-[12.5px]"
        title="Disconnect"
      >
        <span className="size-1.5 rounded-full bg-verdi" />
        {shortAddress(publicKey.toBase58())}
      </button>
    );
  }

  return (
    <div className="relative" ref={sheet}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!ready || connecting}
        className="btn btn-primary h-[38px] rounded-full px-5 text-[13.5px]"
        aria-expanded={open}
      >
        {connecting ? "Connecting" : "Sign in"}
      </button>
      {open ? (
        <div className="surface-raised absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] rounded-[6px] p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
          <p className="px-1 pb-2 text-[12px] leading-relaxed text-steel-400">
            A Google account gets a VISE wallet you can deposit to, lock from
            and withdraw from. Or connect the wallet you already have.
          </p>
          <GoogleSignIn />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setVisible(true);
            }}
            className="btn btn-ghost mt-2 h-[46px] w-full"
          >
            Connect a wallet
          </button>
        </div>
      ) : null}
    </div>
  );
}
