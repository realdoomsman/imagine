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

  // Custom properties are legal in a style object but absent from CSSProperties.
  const fill: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${pct}%`,
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="rule-label">
          Lock duration
        </label>
        <span className="num text-[13px] text-steel-200">
          {days} {days === 1 ? "day" : "days"}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={days}
        onChange={handle}
        aria-valuetext={`${days} days`}
        className="vise-range mt-3 w-full"
        style={fill}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`num rounded-machined border px-2.5 py-1 text-[12px] transition-colors ${
              days === preset
                ? "border-torch bg-torch/10 text-torch"
                : "border-steel-700 text-steel-400 hover:border-steel-600/50 hover:text-steel-200"
            }`}
          >
            {preset}d
          </button>
        ))}
      </div>
    </div>
  );
}
