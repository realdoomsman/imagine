"use client";

import { useState } from "react";

const PRESETS = [30, 90, 180, 365];
const DAY = 86_400;

/**
 * Extend a live lock.
 *
 * The program re-locks from now for the chosen term and re-prices the
 * multiplier for it, so only terms that end after the current unlock date are
 * offered. Pending rewards are paid out as part of the same instruction,
 * which the copy says so nobody thinks they were lost.
 */
export function ExtendControl({
  lockEnd,
  busy,
  onExtend,
}: {
  lockEnd: number;
  busy: boolean;
  onExtend: (days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = Math.floor(Date.now() / 1000);
  const options = PRESETS.map((days) => ({ days, allowed: now + days * DAY > lockEnd + 60 }));
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
      <span className="mr-1 text-[11.5px] text-steel-500">Re-lock from today for</span>
      {options.map((option) => (
        <button
          key={option.days}
          type="button"
          disabled={busy || !option.allowed}
          onClick={() => {
            setOpen(false);
            onExtend(option.days);
          }}
          title={option.allowed ? undefined : "Ends before the current unlock date"}
          className="btn btn-ghost h-8 px-2.5 text-[12px] disabled:opacity-40"
        >
          {option.days}d
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
