"use client";

import { useCallback, useId } from "react";

/**
 * The lock-duration control, styled as the vise's crank track.
 *
 * A real `<input type="range">` underneath so keyboard and screen-reader users
 * get the native behaviour; the visible track is painted on top.
 */
export function LockDial({
  days,
  onChange,
  min,
  max,
  presets,
}: {
  days: number;
  onChange: (days: number) => void;
  min: number;
  max: number;
  presets: readonly number[];
}) {
  const id = useId();
  const pct = ((days - min) / (max - min)) * 100;

  const handle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(event.target.value));
    },
    [onChange],
  );

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="rule-label">
          Lock duration
        </label>
        <span className="num text-[13px] text-steel-400">
          {min}–{max} days
        </span>
      </div>

      <div className="relative mt-3 h-9">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 border border-steel-700 bg-steel-950">
          <div
            className="knurl h-full bg-torch-dim/60"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div
          className="pointer-events-none absolute top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 border border-torch bg-torch"
          style={{ left: `${pct}%` }}
        />

        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={days}
          onChange={handle}
          aria-valuetext={`${days} days`}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`num rounded-machined border px-2.5 py-1 text-[12px] transition-colors ${
              days === preset
                ? "border-torch bg-torch/10 text-torch"
                : "border-steel-700 text-steel-400 hover:border-steel-500 hover:text-steel-200"
            }`}
          >
            {preset}d
          </button>
        ))}
      </div>
    </div>
  );
}
