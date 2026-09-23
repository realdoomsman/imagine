"use client";

import { useEffect, useRef, useState } from "react";
import { Ticker } from "./motion";

const SPLIT = [
  {
    key: "lockers",
    pct: 90,
    label: "Lockers",
    note: "Paid by weight, streamed over 24 hours",
    hot: true,
  },
  {
    key: "treasury",
    pct: 10,
    label: "Treasury",
    note: "Indexing, hosting, audits, the keeper",
    hot: false,
  },
  {
    key: "creator",
    pct: 0,
    label: "Creator",
    note: "Nothing. Creators earn by locking like everyone else",
    hot: false,
  },
];

/**
 * The fee split, drawn as a schematic rather than a chart.
 *
 * One inbound trunk fans into three branches whose stroke widths *are* the
 * split, so the proportion is legible before a single number is read. Kept
 * deliberately thin and technical: the giant percentages below are the
 * statement, and a fat glowing bar here would just shout over them.
 */
export function FlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLive(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const draw = (delay: number) => ({
    strokeDasharray: 1300,
    strokeDashoffset: live ? 0 : 1300,
    transition: `stroke-dashoffset 1500ms ${delay}ms cubic-bezier(0.16,1,0.3,1)`,
  });

  return (
    <div ref={ref} className="mt-14 -mx-5 overflow-x-auto px-5 sm:mx-0 sm:overflow-visible sm:px-0">
      <svg
        viewBox="0 0 1200 150"
        className="w-full min-w-[720px] overflow-visible sm:min-w-0"
        role="img"
        aria-label="A trade fee splitting 90 percent to lockers, 10 percent to treasury, nothing to the creator"
      >
        <defs>
          <linearGradient id="vise-flow-hot" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0.2" />
            <stop offset="55%" stopColor="#ff5a1f" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ff7a45" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="vise-flow-cold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b4454" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b95a6" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Inbound trunk. */}
        <text x="0" y="66" className="num" fill="#5a6578" fontSize="10" letterSpacing="2.4">
          TRADE FEE
        </text>
        <path d="M 96 75 H 300" stroke="#4a5364" strokeWidth="11" fill="none" opacity="0.65" />

        {/* Branches: stroke width is the share. */}
        <path
          d="M 300 75 C 392 75, 400 22, 492 22 H 1042"
          stroke="url(#vise-flow-hot)"
          strokeWidth="19.8"
          fill="none"
          style={draw(0)}
        />
        <path
          d="M 300 75 H 1042"
          stroke="url(#vise-flow-cold)"
          strokeWidth="2.2"
          fill="none"
          style={draw(150)}
        />
        {/* The creator branch goes nowhere: a stub that stops short, dashed. */}
        <path
          d="M 300 75 C 340 75, 350 128, 400 128 H 470"
          stroke="#3b4454"
          strokeWidth="1"
          fill="none"
          strokeDasharray="3 5"
          opacity={live ? 0.9 : 0}
          style={{ transition: "opacity 900ms 400ms" }}
        />
        <text x="484" y="132" className="num" fill="#5a6578" fontSize="10" letterSpacing="1.6">
          0 — NOTHING ROUTES HERE
        </text>

        {/* A highlight that keeps travelling: fees are a stream, not a pie. */}
        <path
          d="M 300 75 C 392 75, 400 22, 492 22 H 1042"
          stroke="#ffd9bf"
          strokeWidth="1.6"
          fill="none"
          opacity={live ? 0.9 : 0}
          strokeDasharray="42 1258"
          className="flow-runner"
        />

        <g className="num" fontSize="11" letterSpacing="1.6">
          <text x="1064" y="26" fill="#ffc79e">LOCKERS 90%</text>
          <text x="1064" y="79" fill="#7d8798">TREASURY 10%</text>
        </g>
      </svg>

      <div className="mt-16 grid gap-10 sm:grid-cols-3 sm:gap-px">
        {SPLIT.map((row) => (
          <div
            key={row.key}
            className="border-t pt-6"
            style={{
              borderColor: row.hot ? "var(--color-torch)" : "var(--color-steel-700)",
            }}
          >
            <div
              className={`num text-[clamp(3rem,7vw,5.5rem)] leading-[0.82] ${
                row.hot ? "text-torch" : "text-steel-200"
              }`}
            >
              <Ticker value={row.pct} suffix="%" duration={1400} />
            </div>
            <div className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-steel-50">
              {row.label}
            </div>
            <div className="mt-1 max-w-[30ch] text-[13px] leading-relaxed text-steel-500">
              {row.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
