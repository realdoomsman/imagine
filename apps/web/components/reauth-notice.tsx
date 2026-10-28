"use client";

import { ApiError, googleSignInUrl } from "@/lib/api";

/** The API's answer when an Imagine-wallet action needs a sign-in from the last few minutes. */
export function reauthMessage(cause: unknown): string | null {
  return cause instanceof ApiError && cause.detail.reauth === true ? cause.message : null;
}

/** That answer, with the way back: a fresh Google sign-in that returns to this page. */
export function ReauthNotice({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-steel/40 bg-steel/10 px-5 py-3 text-[13px] text-fg ${className}`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          window.location.href = googleSignInUrl(`${window.location.pathname}${window.location.search}`);
        }}
        className="btn btn-primary btn-sm"
      >
        Sign in again
      </button>
    </div>
  );
}
