"use client";

import Link from "next/link";
import { DAY, ECONOMICS, durationMultiplierBps, combinedMultiplierBps } from "@vise/sdk";
import { useEffect, useState } from "react";
import { ViseShader } from "./vise-shader";
import { Magnetic, Ticker } from "./motion";

const MIN_DAYS = ECONOMICS.minLockSecs / DAY;
const MAX_DAYS = ECONOMICS.maxLockSecs / DAY;

const PRESETS = [
  { days: 7, label: "1W" },
  { days: 30, label: "1M" },
  { days: 90, label: "3M" },
  { days: 180, label: "6M" },
  { days: 365, label: "1Y" },
];

/** Size tiers, as the pool defaults stamp them: share of supply → bonus. */
const TIERS = ECONOMICS.sizeTierBps.map((tier, index) => ({
  shareBps: tier,
  bonusBps: ECONOMICS.sizeBonusBps[index],
}));

export function Hero() {
  const [days, setDays] = useState(90);
  const [tier, setTier] = useState(0);
  const [entered, setEntered] = useState(false);
  const grip = (days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS);
  // The same arithmetic the program runs, from the SDK mirror it is pinned to.
  const durationBps = durationMultiplierBps(days * DAY, ECONOMICS);
  const bonusBps = tier === 0 ? 0 : TIERS[tier - 1].bonusBps;
  const multiplier = combinedMultiplierBps(durationBps, bonusBps) / 10_000;

  // Custom properties are legal in a style object but absent from CSSProperties.
  const fillStyle: React.CSSProperties & Record<"--fill", string> = {
    "--fill": `${grip * 100}%`,
  };

  // Only after mount: Date.now() on the server would not match the client.
  const unlockDate = entered
    ? new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      })
    : "—";

  // Stagger the opening so the mechanism is already lit before the type lands.
  useEffect(() => {
    const id = window.setTimeout(() => setEntered(true), 90);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <section
      data-entered={entered}
      className="group relative isolate -mt-[84px] min-h-[100svh] overflow-hidden"
    >
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1440px] flex-col justify-between gap-8 px-5 pb-8 pt-28 sm:px-8 sm:pb-10 lg:gap-10 lg:pt-40">
        <div className="max-w-[860px]">
          <p
            className="rule-label mb-5 translate-y-3 opacity-0 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-data-[entered=true]:translate-y-0 group-data-[entered=true]:opacity-100"
            style={{ transitionDelay: "60ms" }}
          >
            Proof of belief · built on pump.fun
          </p>

          <h1 className="t-hero">
            {["Hold under", "pressure."].map((line, index) => (
              <span key={line} className="block overflow-hidden">
                <span
                  className="block translate-y-full transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-data-[entered=true]:translate-y-0"
                  style={{ transitionDelay: `${120 + index * 90}ms` }}
                >
                  {index === 1 ? (
                    <>
                      <span className="text-torch">pressure.</span>
                    </>
                  ) : (
                    line
                  )}
                </span>
              </span>
            ))}
          </h1>

          <p
            className="t-lede mt-6 translate-y-3 opacity-0 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-data-[entered=true]:translate-y-0 group-data-[entered=true]:opacity-100 sm:mt-8"
            style={{ transitionDelay: "380ms" }}
          >
            Every trade on a VISE coin pays a fee. That fee goes to the holders who
            locked — and the longer the lock, the bigger the cut. Selling is still
            free. It just costs you the stream.
          </p>

          <div
            className="mt-8 flex flex-wrap items-center gap-3 opacity-0 transition-opacity duration-700 group-data-[entered=true]:opacity-100 sm:mt-10"
            style={{ transitionDelay: "480ms" }}
          >
            <Magnetic>
              <Link href="/launch" className="btn btn-primary h-[52px] px-7">
                Launch a coin
              </Link>
            </Magnetic>
            <Magnetic strength={0.2}>
              <Link href="/coins" className="btn btn-ghost h-[52px] px-7">
                Browse live coins
              </Link>
            </Magnetic>
          </div>
        </div>

        {/*
         * The mechanism.
         *
         * On a wide screen it is full-bleed behind everything, escaping this
         * padded container with a viewport-width absolute. On a phone there is
         * no room to put type over it, so it takes its own band in the flow
         * between the call to action and the control.
         */}
        <div className="relative -mx-5 h-[34svh] min-h-[180px] sm:-mx-8 lg:absolute lg:left-1/2 lg:top-0 lg:-z-10 lg:mx-0 lg:h-full lg:w-screen lg:min-h-0 lg:-translate-x-1/2">
          <ViseShader grip={grip} className="h-full w-full" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-steel-990 to-transparent lg:h-40" />
        </div>

        {/* The control sits at the bottom of the fold: grab it, the scene reacts. */}
        <div
          className="opacity-0 transition-opacity duration-700 group-data-[entered=true]:opacity-100"
          style={{ transitionDelay: "620ms" }}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-xl">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="rule-label">Lock duration</span>
                <span className="num text-[13px] text-steel-400">
                  {days} {days === 1 ? "day" : "days"}
                </span>
              </div>

              <input
                type="range"
                min={MIN_DAYS}
                max={MAX_DAYS}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                aria-label="Lock duration in days"
                className="vise-range w-full"
                style={fillStyle}
              />

              <div className="mt-3 flex gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    onClick={() => setDays(preset.days)}
                    aria-pressed={days === preset.days}
                    className={`num h-7 flex-1 rounded-[2px] border text-[11px] transition-colors duration-200 ${
                      days === preset.days
                        ? "border-torch/60 bg-torch/12 text-torch-pale"
                        : "border-steel-700 text-steel-500 hover:border-steel-600/50 hover:text-steel-300"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Size tier: a bigger share of supply earns more per token. */}
              <div className="mt-5 flex items-baseline justify-between">
                <span className="rule-label">Position size</span>
                <span className="num text-[12px] text-steel-500">share of supply</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                {[{ shareBps: 0, bonusBps: 0 }, ...TIERS].map((option, index) => (
                  <button
                    key={option.shareBps}
                    type="button"
                    onClick={() => setTier(index)}
                    aria-pressed={tier === index}
                    className={`num h-7 flex-1 rounded-[2px] border text-[11px] transition-colors duration-200 ${
                      tier === index
                        ? "border-torch/60 bg-torch/12 text-torch-pale"
                        : "border-steel-700 text-steel-500 hover:border-steel-600/50 hover:text-steel-300"
                    }`}
                  >
                    {index === 0 ? "any" : `≥${option.shareBps / 100}%`}
                    {index === 0 ? "" : ` +${option.bonusBps / 100}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-10">
              <div>
                <span className="rule-label">Your weight</span>
                <div className="num mt-1 text-[clamp(2.75rem,6vw,4.5rem)] leading-[0.85] text-steel-50">
                  <Ticker value={multiplier} decimals={2} suffix="×" duration={450} />
                </div>
              </div>
              <div className="hidden pb-2 sm:block">
                <span className="rule-label">Unlocks</span>
                <div className="num mt-1 text-[20px] leading-none text-steel-200">
                  {unlockDate}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
