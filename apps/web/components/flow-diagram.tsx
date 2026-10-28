/**
 * Where a coin's fees go: three inflows into one vault, one frozen split out.
 * An SVG on wide screens, a stacked list on phones; same facts in both.
 */

const SOURCES = [
  { title: "Every trade, anywhere", body: "0.5% on-chain trading fee, sent to the pool by Raydium LaunchLab" },
  { title: "Trades on imagine.fun", body: "+1.5% app fee, so 2% of each trade reaches the pool" },
  { title: "After graduation", body: "the Raydium pool's fee share keeps flowing, plus donations" },
];

const SPLIT = [
  { pct: "90%", title: "Lockers", body: "streamed by weight: amount × time" },
  { pct: "10%", title: "Treasury", body: "taken off the top, frozen per pool" },
];

const SRC_Y = [40, 162, 284];
const SRC_H = 84;
const VAULT = { x: 385, y: 128, w: 230, h: 152 };
const OUT = [
  { y: 58, h: 118 },
  { y: 248, h: 92 },
];

export function FlowDiagram() {
  const vaultMidY = VAULT.y + VAULT.h / 2;
  return (
    <div className="mt-12">
      <svg
        viewBox="0 0 1000 400"
        className="hidden h-auto w-full md:block"
        role="img"
        aria-label="A 0.5% on-chain trading fee on every trade anywhere, a 1.5% app fee on imagine.fun trades, and after graduation the Raydium pool's fee share flow into the coin's vault; 90% streams to lockers by weight and 10% goes to the treasury."
      >
        <defs>
          <linearGradient id="flow-dream" x1="0" y1="0" x2="1" y2="0.58">
            <stop offset="0" stopColor="#8CC8DC" />
            <stop offset="0.55" stopColor="#5EE9B5" />
            <stop offset="1" stopColor="#C7F9E5" />
          </linearGradient>
        </defs>

        {SRC_Y.map((top, i) => {
          const d = `M300 ${top + SRC_H / 2} C 345 ${top + SRC_H / 2}, 345 ${vaultMidY}, ${VAULT.x} ${vaultMidY}`;
          return (
            <g key={top}>
              <path d={d} fill="none" stroke="#2F4F58" strokeWidth="1.5" />
              <path d={d} fill="none" stroke="#69AAC1" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="14 161" className="flow-runner" style={{ animationDelay: `${i * -0.9}s` }} />
              <rect x="20" y={top} width="280" height={SRC_H} rx="14" fill="#102127" stroke="#20363D" />
              <text x="40" y={top + 33} fill="#F3F8F8" fontSize="16" fontWeight="700">
                {SOURCES[i].title}
              </text>
              <foreignObject x="40" y={top + 42} width="246" height="40">
                <p className="text-[12.5px] leading-[1.35] text-fg-soft">{SOURCES[i].body}</p>
              </foreignObject>
            </g>
          );
        })}

        {OUT.map((box, i) => {
          const d = `M${VAULT.x + VAULT.w} ${vaultMidY} C 660 ${vaultMidY}, 660 ${box.y + box.h / 2}, 700 ${box.y + box.h / 2}`;
          return (
            <g key={box.y}>
              <path d={d} fill="none" stroke="#2F4F58" strokeWidth={i === 0 ? 3 : 1.5} />
              <path d={d} fill="none" stroke={i === 0 ? "#5EE9B5" : "#69AAC1"} strokeWidth={i === 0 ? 3.5 : 2.5} strokeLinecap="round" strokeDasharray="14 161" className="flow-runner" style={{ animationDelay: `${i * -1.4}s` }} />
              <rect x="700" y={box.y} width="280" height={box.h} rx="14" fill={i === 0 ? "#0F2A27" : "#102127"} stroke={i === 0 ? "url(#flow-dream)" : "#20363D"} strokeWidth={i === 0 ? 1.5 : 1} />
              <text x="722" y={box.y + (i === 0 ? 52 : 40)} fill={i === 0 ? "#5EE9B5" : "#A4C5CF"} fontSize={i === 0 ? 38 : 26} fontWeight="800" fontFamily="var(--font-mono)">
                {SPLIT[i].pct}
              </text>
              <text x={i === 0 ? 830 : 800} y={box.y + (i === 0 ? 50 : 38)} fill="#F3F8F8" fontSize="17" fontWeight="700">
                {SPLIT[i].title}
              </text>
              <text x="722" y={box.y + box.h - (i === 0 ? 30 : 22)} fill="#768A93" fontSize="12.5">
                {SPLIT[i].body}
              </text>
            </g>
          );
        })}

        <rect x={VAULT.x} y={VAULT.y} width={VAULT.w} height={VAULT.h} rx="18" fill="#0B171B" stroke="url(#flow-dream)" strokeWidth="2" />
        <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 46} textAnchor="middle" fill="#768A93" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2">
          ONE PER COIN
        </text>
        <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 78} textAnchor="middle" fill="#F3F8F8" fontSize="22" fontWeight="800">
          The coin&apos;s vault
        </text>
        <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 108} textAnchor="middle" fill="#A4C5CF" fontSize="13">
          holds the pair asset
        </text>
        <text x={VAULT.x + VAULT.w / 2} y={VAULT.y + 130} textAnchor="middle" fill="#5EE9B5" fontSize="12" fontFamily="var(--font-mono)">
          NVDAx · SPYx · USDC · SOL
        </text>
      </svg>

      {/* Phones: the same flow, top to bottom. */}
      <ol className="space-y-2 md:hidden">
        {SOURCES.map((source) => (
          <li key={source.title} className="card px-4 py-3">
            <p className="text-[15px] font-bold text-fg">{source.title}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-fg-soft">{source.body}</p>
          </li>
        ))}
        <li aria-hidden="true" className="flex justify-center py-1 text-steel">
          ↓
        </li>
        <li className="card card-dream px-4 py-4 text-center">
          <p className="eyebrow">One per coin</p>
          <p className="mt-1 text-[20px] font-extrabold text-fg">The coin&apos;s vault</p>
          <p className="num mt-1 text-[12px] text-mint">holds the pair asset</p>
        </li>
        <li aria-hidden="true" className="flex justify-center py-1 text-mint">
          ↓
        </li>
        <li className="grid grid-cols-2 gap-2">
          {SPLIT.map((part, i) => (
            <div key={part.title} className={`card px-4 py-3 ${i === 0 ? "card-dream" : ""}`}>
              <p className={`num text-[26px] font-extrabold ${i === 0 ? "text-mint" : "text-fg-soft"}`}>{part.pct}</p>
              <p className="text-[14px] font-bold text-fg">{part.title}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted">{part.body}</p>
            </div>
          ))}
        </li>
      </ol>
    </div>
  );
}
