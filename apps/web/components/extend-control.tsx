"use client";

import { LOCK_PRESETS } from "@imagine/sdk";
import { useState } from "react";

/**
 * Extend a live lock.
 *
 * The program re-locks from now for the chosen term and re-prices the
 * multiplier for it, so only terms inside the pool's window that end after
 * the current unlock date are offered. Pending rewards are paid out as part of
 * the same instruction, which the copy says so nobody thinks they were lost.
 */
export function ExtendControl({
  lockEnd,
  minLockSecs,
  maxLockSecs,
  busy,
  onExtend,
}: {
  lockEnd: number;
  /** The pool's window; null when the pool could not be read. */
  minLockSecs: number | null;
  maxLockSecs: number | null;
  busy: boolean;
  onExtend: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (minLockSecs === null || maxLockSecs === null) return null;
  const now = Math.floor(Date.now() / 1000);
  const options = LOCK_PRESETS.filter(
    (preset) => preset.seconds >= minLockSecs && preset.seconds <= maxLockSecs,
  ).map((preset) => ({ ...preset, allowed: now + preset.seconds > lockEnd + 60 }));
  if (!options.some((option) => option.allowed)) return null;

  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className="btn btn-ghost h-9 text-[13px]">
        Extend
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11.5px] text-steel-500">Re-lock from now for</span>
      {options.map((option) => (
        <button
          key={option.seconds}
          type="button"
          disabled={busy || !option.allowed}
          onClick={() => {
            setOpen(false);
            onExtend(option.seconds);
          }}
          title={option.allowed ? undefined : "Ends before the current unlock date"}
          className="btn btn-ghost h-8 px-2.5 text-[12px] disabled:opacity-40"
        >
          {option.label}
        </button>
      ))}
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost h-8 px-2.5 text-[12px]">
        Cancel
      </button>
      <span className="basis-full text-[11.5px] text-steel-500">
        Unclaimed rewards are paid to you in the same transaction; the multiplier is re-priced for the new term.
      </span>
    </span>
  );
}
