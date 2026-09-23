"use client";

import { LOCK_PRESETS, formatMultiplier } from "@vise/sdk";
import Link from "next/link";
import { useState } from "react";
import { ViseCanvas } from "./vise-canvas";
import { LockDial } from "./lock-dial";

const MIN_DAYS = 7;
const MAX_DAYS = 365;
const MAX_MULTIPLIER_BPS = 40_000;

/** Same linear ramp the program uses, expressed in days for the UI. */
function multiplierForDays(days: number): number {
  const travelled = (days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS);
  return 10_000 + (MAX_MULTIPLIER_BPS - 10_000) * travelled;
}

export function Hero() {
  const [days, setDays] = useState(90);
  const grip = (days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS);
  const multiplier = multiplierForDays(days);

  return (
    <section className="relative overflow-hidden border-b border-steel-700">
      <div className="knurl pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto grid max-w-[1400px] gap-12 px-5 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:py-28">
        <div>
          <p className="rule-label">Lock-to-earn for pump.fun</p>
          <h1 className="mt-5 text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.95]">
            Hold under
            <br />
            pressure.
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-steel-300">
            Every trade on a VISE coin pays a fee. That fee goes to the people
            holding it — not to a dev wallet. Clamp your bags for longer and your
            share of it gets bigger.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/launch" className="btn btn-primary">
              Launch a coin
            </Link>
            <Link href="/coins" className="btn btn-ghost">
              Browse coins
            </Link>
          </div>

          <dl className="mt-12 grid max-w-md grid-cols-3 gap-px overflow-hidden border border-steel-700 bg-steel-700">
            <Stat label="App fee" value="2%" note="of every routed trade" />
            <Stat label="To lockers" value="72%" note="of that fee" />
            <Stat label="Max weight" value="4.0×" note="at a 365-day lock" />
          </dl>
        </div>

        <div className="relative">
          <div className="panel knurl relative overflow-hidden">
            <ViseCanvas grip={grip} className="block h-[340px] w-full" />

            <div className="pointer-events-none absolute left-5 top-5">
              <p className="rule-label">Weight multiplier</p>
              <p className="num mt-1 text-[42px] leading-none text-torch">
                {formatMultiplier(multiplier)}
              </p>
            </div>

            <div className="pointer-events-none absolute right-5 top-5 text-right">
              <p className="rule-label">Lock term</p>
              <p className="num mt-1 text-[42px] leading-none text-steel-50">
                {days}
                <span className="text-[18px] text-steel-500">d</span>
              </p>
            </div>
          </div>

          <div className="panel mt-3 p-5">
            <LockDial
              days={days}
              onChange={setDays}
              min={MIN_DAYS}
              max={MAX_DAYS}
              presets={LOCK_PRESETS.map((p) => p.days)}
            />
            <p className="mt-4 text-[13px] text-steel-500">
              Turn the handle. A 7-day lock counts as 1.0× its size. A 365-day
              lock counts as 4.0×. Same coins, four times the claim on the same
              fee stream.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-steel-900 px-4 py-3.5">
      <dt className="rule-label">{label}</dt>
      <dd className="num mt-1 text-[22px] text-steel-50">{value}</dd>
      <dd className="mt-0.5 text-[11px] text-steel-600">{note}</dd>
    </div>
  );
}
