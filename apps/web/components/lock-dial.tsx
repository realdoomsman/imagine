"use client";

import { DAY, formatMultiplier, HOUR, LOCK_PRESETS } from "@imagine/sdk";
import { useCallback, useId, useMemo } from "react";

/**
 * Every term the dial can land on: whole hours below a day, whole days above.
 * The track moves by index, so four hours and a year both stay reachable on
 * one slider instead of the hours vanishing into the first pixel.
 */
export function durationStops(min: number, max: number): number[] {
  const stops: number[] = [];
  for (let hours = Math.ceil(min / HOUR); hours < 24 && hours * HOUR <= max; hours += 1) {
    stops.push(hours * HOUR);
  }
  for (let days = Math.max(1, Math.ceil(min / DAY)); days * DAY <= max; days += 1) {
    stops.push(days * DAY);
  }
  if (stops[0] !== min) stops.unshift(min);
  if (stops.at(-1) !== max) stops.push(max);
  return stops;
}

/** "4 hours", "1 day", "30 days". */
export function durationLabel(seconds: number): string {
  if (seconds % DAY === 0) {
    const days = seconds / DAY;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const hours = Math.round(seconds / HOUR);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * The lock-duration control: how long you commit, and what that commitment
 * is worth as a multiplier on your share of the stream.
 *
 * A real `<input type="range">` underneath so keyboard and screen-reader users
 * get the native behaviour. Values are seconds throughout.
 */
export function LockDial({
  seconds,
  onChange,
  min,
  max,
  multiplierBps,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
  min: number;
  max: number;
  /** The weight this term earns, shown beside the term when given. */
  multiplierBps?: number;
}) {
  const id = useId();
  const stops = useMemo(() => durationStops(min, max), [min, max]);
  const presets = useMemo(
    () => LOCK_PRESETS.filter((preset) => preset.seconds >= min && preset.seconds <= max),
    [min, max],
  );
  // The stop at or just below the value, so an off-grid value still places.
  const index = Math.max(0, stops.findLastIndex((stop) => stop <= seconds));
  const pct = stops.length > 1 ? (index / (stops.length - 1)) * 100 : 100;

  const handle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(stops[Number(event.target.value)] ?? min);
    },
    [min, onChange, stops],
  );

  // Custom properties are legal in a style object but absent from CSSProperties.
  const fill: React.CSSProperties & Record<"--fill", string> = { "--fill": `${pct}%` };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="eyebrow">
          Lock for
        </label>
        <span className="num text-[13.5px] text-fg">
          {durationLabel(seconds)}
          {multiplierBps !== undefined ? (
            <span className="dream-text ml-2 font-semibold">{formatMultiplier(multiplierBps)}</span>
          ) : null}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={handle}
        aria-valuetext={durationLabel(seconds)}
        className="range mt-2"
        style={fill}
      />

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            onClick={() => onChange(preset.seconds)}
            aria-pressed={seconds === preset.seconds}
            className={`pill num cursor-pointer transition-colors ${
              seconds === preset.seconds ? "pill-steel" : "hover:border-line-strong hover:text-fg"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
