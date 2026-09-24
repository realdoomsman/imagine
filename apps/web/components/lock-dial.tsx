"use client";

import { DAY, HOUR, LOCK_PRESETS } from "@vise/sdk";
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
 * The lock-duration control, styled as the vise's crank track.
 *
 * A real `<input type="range">` underneath so keyboard and screen-reader users
 * get the native behaviour; the visible track is painted on top. Values are
 * seconds throughout.
 */
export function LockDial({
  seconds,
  onChange,
  min,
  max,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
  min: number;
  max: number;
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
  const fill: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${pct}%`,
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="rule-label">
          Lock duration
        </label>
        <span className="num text-[13px] text-steel-200">{durationLabel(seconds)}</span>
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
        className="vise-range mt-3 w-full"
        style={fill}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            onClick={() => onChange(preset.seconds)}
            className={`num rounded-machined border px-2.5 py-1 text-[12px] transition-colors ${
              seconds === preset.seconds
                ? "border-torch bg-torch/10 text-torch"
                : "border-steel-700 text-steel-400 hover:border-steel-600/50 hover:text-steel-200"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
