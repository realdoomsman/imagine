"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * "Imagine the chart" — the hero's one interactive idea.
 *
 * A seeded simulation of a stock-paired meme. One control: how many holders
 * lock. At 0% the sell-offs land in full and the chart bleeds out; as the
 * share rises the same sell orders shrink (locked coins cannot be sold), the
 * line steadies, and a sample locker's stream keeps accruing in the pair
 * asset. Everything is deterministic and labelled illustrative: it shows the
 * mechanism, not a market.
 */

const PAIR = "NVDAx";
const POINTS = 96;
const SEED = 2026;
/** Pair-asset units a sample locker accrues per tick per unit of price. */
const STREAM_PER_TICK = 0.00034;
const PLAY_MS = 14_000;
const HOLD_MS = 3_200;

const W = 640;
const H = 280;
const PAD_T = 18;
const PAD_B = 18;
const PAD_R = 14;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tape {
  /** Standard-normal churn per tick. */
  noise: number[];
  /** Size of the sell order landing at each tick (log-price), 0 when none. */
  sells: number[];
}

/** The market's raw moves: per-tick noise and the sell orders that hit it. */
function marketTape(): Tape {
  const random = mulberry32(SEED);
  const noise: number[] = [];
  const sells: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const u1 = Math.max(random(), 1e-9);
    const u2 = random();
    noise.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    const hit = random();
    const size = random();
    sells.push(i > 3 && hit < 0.11 ? 0.07 + 0.15 * size : 0);
  }
  return { noise, sells };
}

/**
 * Share of the market's sell orders that still land when `locked` of holders
 * have locked. Slightly convex, so the first locks visibly matter.
 */
const sellingShare = (locked: number) => Math.pow(1 - locked, 1.3);

/**
 * Price path for a given locked share. Locked supply cannot be sold, so every
 * sell order and the general churn shrink with it; buyers are unchanged.
 */
function pricePath(tape: Tape, locked: number) {
  const selling = sellingShare(locked);
  const close = [1];
  const low = [1];
  const dips = [0];
  let logPrice = 0;
  for (let i = 1; i < POINTS; i++) {
    const vol = 0.009 + 0.02 * selling;
    const drift = 0.0034 + 0.0016 * locked;
    const dip = tape.sells[i] * selling;
    logPrice += drift + vol * tape.noise[i] - dip;
    close.push(Math.exp(logPrice));
    low.push(Math.exp(logPrice - dip * 0.8));
    dips.push(dip);
  }
  return { close, low, dips };
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ImagineChart({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const tape = useMemo(marketTape, []);
  // One y-domain for every slider position, so the difference is visible
  // rather than rescaled away.
  const domain = useMemo(() => {
    const worst = pricePath(tape, 0);
    const best = pricePath(tape, 1);
    const lo = Math.min(...worst.low, ...best.low);
    const hi = Math.max(...worst.close, ...best.close);
    return { lo: Math.log(lo) - 0.08, hi: Math.log(hi) + 0.08 };
  }, [tape]);

  const [target, setTarget] = useState(25);
  const [shown, setShown] = useState(25);
  const [head, setHead] = useState(Math.round(POINTS * 0.4));
  const root = useRef<HTMLDivElement>(null);
  const shownRef = useRef(25);
  const targetRef = useRef(25);
  targetRef.current = target;

  useEffect(() => {
    if (reducedMotion()) {
      setHead(POINTS - 1);
      return;
    }
    let frame = 0;
    let visible = true;
    let started = performance.now() - (Math.round(POINTS * 0.4) / (POINTS - 1)) * PLAY_MS;
    let pausedAt: number | null = null;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden) {
        pausedAt ??= now;
        return;
      }
      if (pausedAt !== null) {
        started += now - pausedAt;
        pausedAt = null;
      }
      const elapsed = (now - started) % (PLAY_MS + HOLD_MS);
      setHead(Math.min(elapsed / PLAY_MS, 1) * (POINTS - 1));
      const next = shownRef.current + (targetRef.current - shownRef.current) * 0.12;
      shownRef.current = Math.abs(next - targetRef.current) < 0.05 ? targetRef.current : next;
      setShown(shownRef.current);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    if (root.current) io.observe(root.current);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, []);

  const locked = shown / 100;
  const path = useMemo(() => pricePath(tape, locked), [tape, locked]);

  // Rounded to a tenth of a unit: server and browser floating point can differ
  // in the last digit, which would otherwise fail hydration.
  const x = (i: number) => Math.round((i / (POINTS - 1)) * (W - PAD_R) * 10) / 10;
  const y = (price: number) =>
    Math.round(
      (PAD_T + (1 - (Math.log(price) - domain.lo) / (domain.hi - domain.lo)) * (H - PAD_T - PAD_B)) * 10,
    ) / 10;

  const whole = Math.floor(head);
  const frac = head - whole;
  const headPrice =
    whole >= POINTS - 1
      ? path.close[POINTS - 1]
      : path.close[whole] + (path.close[whole + 1] - path.close[whole]) * frac;

  let line = "";
  for (let i = 0; i <= whole; i++) line += `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(path.close[i]).toFixed(1)}`;
  if (whole < POINTS - 1) line += `L${x(head).toFixed(1)},${y(headPrice).toFixed(1)}`;
  const area = `${line}L${x(head).toFixed(1)},${H}L0,${H}Z`;

  const wicks = [];
  for (let i = 1; i <= whole; i++) {
    if (path.dips[i] < 0.012) continue;
    wicks.push({
      x: x(i),
      top: y(path.close[i - 1]),
      bottom: y(path.low[i]),
      strength: Math.min(path.dips[i] / 0.12, 1),
    });
  }

  let earned = 0;
  if (target > 0) {
    for (let i = 0; i <= whole; i++) earned += path.close[i];
    earned = (earned + (whole < POINTS - 1 ? headPrice * frac : 0)) * STREAM_PER_TICK;
  }
  const change = (headPrice - 1) * 100;
  const fill = { "--fill": `${target}%` } as React.CSSProperties;

  return (
    <div ref={root} className={`card overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-ink"
            style={{ background: "var(--dream)" }}
            aria-hidden="true"
          >
            D
          </span>
          <div className="min-w-0">
            <p className="num text-[13px] font-semibold text-steel-hi">$DREAM</p>
            <span className="pill pill-pair mt-1 h-6 px-2 text-[11px]">
              <span className="pill-label">Paired with</span>
              <i className="pill-dot" aria-hidden="true" />
              <b>{PAIR}</b>
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`num text-[18px] font-semibold leading-none ${change >= 0 ? "up" : "down"}`}>
            {`${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`}
          </p>
          <p className="eyebrow mt-1.5 text-[9.5px]">Illustrative</p>
        </div>
      </div>

      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Simulated chart: with ${Math.round(target)}% of holders locked the sample coin is ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% from open.`}>
          <defs>
            <linearGradient id={`${uid}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#8CC8DC" />
              <stop offset="0.55" stopColor="#5EE9B5" />
              <stop offset="1" stopColor="#C7F9E5" />
            </linearGradient>
            <linearGradient id={`${uid}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#5EE9B5" stopOpacity="0.22" />
              <stop offset="1" stopColor="#5EE9B5" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={PAD_T + f * (H - PAD_T - PAD_B)} y2={PAD_T + f * (H - PAD_T - PAD_B)} stroke="rgba(164,197,207,0.07)" />
          ))}
          <line x1="0" x2={W} y1={y(1)} y2={y(1)} stroke="rgba(164,197,207,0.35)" strokeDasharray="5 6" />

          <path d={area} fill={`url(#${uid}-area)`} />
          {wicks.map((wick) => (
            <line
              key={wick.x}
              x1={wick.x}
              x2={wick.x}
              y1={wick.top}
              y2={wick.bottom}
              stroke="#FB7185"
              strokeWidth={2.4}
              strokeLinecap="round"
              opacity={Math.round((0.35 + 0.65 * wick.strength) * 100) / 100}
            />
          ))}
          <path d={line} fill="none" stroke={`url(#${uid}-line)`} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />

          <circle cx={x(head)} cy={y(headPrice)} r={9} fill="#5EE9B5" opacity={0.18} />
          <circle cx={x(head)} cy={y(headPrice)} r={4.2} fill="#C7F9E5" stroke="#071013" strokeWidth={1.5} />
        </svg>
      </div>

      <div className="border-t border-line px-5 pb-5 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${uid}-lock`} className="text-[14px] font-semibold text-fg">
            How many holders lock?
          </label>
          <span className="num text-[20px] font-semibold text-fg">{Math.round(target)}%</span>
        </div>
        <input
          id={`${uid}-lock`}
          type="range"
          min={0}
          max={100}
          step={1}
          value={target}
          onChange={(event) => {
            const value = Number(event.target.value);
            setTarget(value);
            if (reducedMotion()) {
              shownRef.current = value;
              setShown(value);
            }
          }}
          aria-valuetext={`${Math.round(target)}% of holders lock`}
          className="range mt-2"
          style={fill}
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="well px-3 py-2.5">
            <p className="eyebrow text-[10px]">Sell orders landing</p>
            <p className={`num mt-1 text-[16px] font-semibold ${target < 50 ? "down" : "text-fg"}`}>
              {Math.round(sellingShare(target / 100) * 100)}%
            </p>
          </div>
          <div className="well px-3 py-2.5">
            <p className="eyebrow text-[10px]">A locker&apos;s stream</p>
            <p className={`num mt-1 text-[16px] font-semibold ${target > 0 ? "up" : "text-muted"}`}>
              +{earned.toFixed(4)} <span className="text-[12px] text-fg-soft">{PAIR}</span>
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-muted">
          {target === 0
            ? "Nobody locked, so every sell order lands and nobody is earning."
            : "Seeded simulation, not market data. Locked coins can't be sold, so the same sell orders shrink."}
        </p>
      </div>
    </div>
  );
}
