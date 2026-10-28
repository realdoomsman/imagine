import { AbsoluteFill } from "remotion";
import { Chart, Mark } from "../kit";
import { COLORS, FONTS } from "../theme";
import {
  BAR,
  Brand,
  Browser,
  Chip,
  COIN_FULL,
  COIN_LOCK,
  Dream,
  EXPLORER_PLATFORM,
  EXPLORER_PROGRAM,
  Eyebrow,
  Framed,
  GITHUB,
  H,
  Header,
  HOME_HERO,
  LAUNCH_NVDAX,
  PAD,
  Page,
  Panel,
  Shot,
  shotHeight,
  Tag,
  Title,
  W,
} from "./parts";

const mono: React.CSSProperties = { fontFamily: FONTS.mono, fontWeight: 500 };

// --- cover (1500×600) ----------------------------------------------------------

export function Cover() {
  return (
    <Page glowX={50} glowY={42} glow={1}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -24, opacity: 0.13 }}>
        <Chart width={1500} height={230} calm={1} count={64} seed={7} line={1} />
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,16,19,0) 55%, rgba(7,16,19,0.75) 100%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <Mark size={74} id="cover-mark" />
        <div style={{ marginTop: 30, fontWeight: 800, fontSize: 104, letterSpacing: "-0.045em", lineHeight: 0.98 }}>
          Imagine
          <br />
          everyone <Dream>locks.</Dream>
        </div>
        <div style={{ marginTop: 34, fontSize: 36, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.fgSoft }}>
          Lock the meme. <span style={{ color: COLORS.fg }}>Earn its pair.</span>
        </div>
      </AbsoluteFill>
    </Page>
  );
}

// --- a01: the homepage ----------------------------------------------------------------

/** home-hero.png (1.5306 px per CSS px): the hero's simulation card only. */
const HERO_CARD: [number, number, number, number] = [1238, 254, 636, 696];

export function A01Hero() {
  const cardW = 640;
  const cardH = shotHeight(HERO_CARD, cardW);
  const cardLeft = W - PAD - cardW;
  return (
    <Page glowX={74} glowY={45} glow={0.9}>
      <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, width: cardLeft - PAD - 60, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark size={52} id="a01-mark" />
          <Tag color={COLORS.mint}>Live on mainnet</Tag>
        </div>
        <div style={{ ...mono, fontSize: 30, color: COLORS.steelHi, marginTop: 34 }}>imagine.fun</div>
        <Title size={76} style={{ marginTop: 14, letterSpacing: "-0.045em", lineHeight: 1 }}>
          Imagine the chart
          <br />
          <Dream>if nobody sold.</Dream>
        </Title>
        <div style={{ fontSize: 27, lineHeight: 1.45, color: COLORS.fgSoft, marginTop: 30 }}>
          The homepage opens on a seeded simulation, labelled illustrative, with one slider: <span style={{ color: COLORS.fg, fontWeight: 600 }}>"How many holders lock?"</span>
        </div>
      </div>
      <Framed style={{ position: "absolute", left: cardLeft, top: (H - cardH) / 2, width: cardW, borderColor: "rgba(94,233,181,0.45)", boxShadow: "0 0 90px rgba(94,233,181,0.12), 0 40px 90px rgba(0,0,0,0.55)" }}>
        <Shot src={HOME_HERO} crop={HERO_CARD} width={cardW} />
      </Framed>
    </Page>
  );
}

// --- a02: where the money goes ---------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };

const FLOW = {
  anywhere: { x: 64, y: 206, w: 496, h: 158 },
  site: { x: 64, y: 384, w: 496, h: 158 },
  graduated: { x: 64, y: 562, w: 496, h: 130 },
  pool: { x: 650, y: 344, w: 356, h: 218 },
  lockers: { x: 1096, y: 206, w: 440, h: 176 },
  treasury: { x: 1096, y: 402, w: 440, h: 104 },
  creator: { x: 1096, y: 526, w: 440, h: 166 },
} satisfies Record<string, Box>;

function edge(a: Box, b: Box, toY = b.y + b.h / 2) {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x - 10;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${toY} ${x2},${toY}`;
}

function FlowNode({ box, children, tone = "plain", dashed }: { box: Box; children: React.ReactNode; tone?: "plain" | "dream"; dashed?: boolean }) {
  return (
    <Panel
      tone={tone}
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        padding: "18px 26px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        ...(dashed ? { border: `2px dashed ${COLORS.lineStrong}`, background: "rgba(16,33,39,0.6)" } : {}),
      }}
    >
      {children}
    </Panel>
  );
}

const nodeTitle: React.CSSProperties = { fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 };
const nodeSub: React.CSSProperties = { fontSize: 21, color: COLORS.fgSoft, lineHeight: 1.35, marginTop: 8 };
const flowPct: React.CSSProperties = { ...mono, fontSize: 40, lineHeight: 1, color: COLORS.mint };

export function A02Flow() {
  const f = FLOW;
  const poolMid = f.pool.y + f.pool.h / 2;
  return (
    <Page>
      <Brand />
      <Header eyebrow="Where the money goes">
        Every trade pays the pool. <Dream>90% to lockers.</Dream>
      </Header>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.steel} />
          </marker>
          <marker id="arrow-mint" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.mint} />
          </marker>
          <marker id="arrow-muted" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={COLORS.lineStrong} />
          </marker>
        </defs>
        <path d={edge(f.anywhere, f.pool, poolMid - 50)} stroke={COLORS.steel} strokeWidth={3} fill="none" markerEnd="url(#arrow)" />
        <path d={edge(f.site, f.pool, poolMid)} stroke={COLORS.steel} strokeWidth={3} fill="none" markerEnd="url(#arrow)" />
        <path d={edge(f.graduated, f.pool, poolMid + 50)} stroke={COLORS.steel} strokeWidth={2.5} strokeDasharray="7 8" fill="none" markerEnd="url(#arrow)" />
        <path d={edge(f.pool, f.lockers)} stroke={COLORS.mint} strokeWidth={5} fill="none" markerEnd="url(#arrow-mint)" />
        <path d={edge(f.pool, f.treasury)} stroke={COLORS.steel} strokeWidth={3} fill="none" markerEnd="url(#arrow)" />
        <path d={edge(f.pool, f.creator)} stroke={COLORS.lineStrong} strokeWidth={2.5} strokeDasharray="6 8" fill="none" markerEnd="url(#arrow-muted)" />
      </svg>

      <FlowNode box={f.anywhere}>
        <Eyebrow size={16}>A trade anywhere</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 10 }}>
          <span style={flowPct}>0.5%</span>
          <span style={{ ...nodeTitle, fontSize: 27, whiteSpace: "nowrap" }}>on-chain trading fee</span>
        </div>
        <div style={nodeSub}>Raydium, Jupiter, any wallet or bot</div>
      </FlowNode>

      <FlowNode box={f.site}>
        <Eyebrow size={16}>A trade on imagine.fun</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 10 }}>
          <span style={flowPct}>2%</span>
          <span style={nodeTitle}>into the pool</span>
        </div>
        <div style={nodeSub}>the same 0.5% plus a 1.5% app fee</div>
      </FlowNode>

      <FlowNode box={f.graduated} dashed>
        <Eyebrow size={16} color={COLORS.muted}>
          After graduation
        </Eyebrow>
        <div style={{ ...nodeTitle, fontSize: 27, marginTop: 10 }}>Its Raydium pool's fee share</div>
      </FlowNode>

      <FlowNode box={f.pool} tone="dream">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={40} id="flow-mark" />
          <div style={{ ...nodeTitle, whiteSpace: "nowrap" }}>The coin's pool</div>
        </div>
        <div style={nodeSub}>one per coin, in the pair asset; split by terms frozen at launch</div>
      </FlowNode>

      <FlowNode box={f.lockers} tone="dream">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ ...mono, fontSize: 56, color: COLORS.mint, lineHeight: 1 }}>90%</span>
          <span style={nodeTitle}>lockers</span>
        </div>
        <div style={nodeSub}>by weight, streamed over 1 hour</div>
      </FlowNode>

      <FlowNode box={f.treasury}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ ...mono, fontSize: 44, color: COLORS.fg, lineHeight: 1 }}>10%</span>
          <span style={nodeTitle}>treasury</span>
        </div>
      </FlowNode>

      <FlowNode box={f.creator}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ ...mono, fontSize: 44, color: COLORS.muted, lineHeight: 1 }}>0%</span>
          <span style={{ ...nodeTitle, color: COLORS.fgSoft }}>creator</span>
        </div>
        <div style={nodeSub}>earns only by locking</div>
      </FlowNode>

      <div style={{ position: "absolute", left: PAD, top: 724, width: 960 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 24, fontWeight: 600, color: COLORS.fgSoft, marginRight: 4 }}>All of it in the coin's pair asset:</span>
          <Chip ticker="NVDAx" size={22} />
          <Chip ticker="SOL" size={22} />
          <Chip ticker="USDC" size={22} />
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.fg, marginTop: 22 }}>
          The <span style={{ ...mono, color: COLORS.mint }}>0.5%</span> is enforced on-chain by Raydium LaunchLab.
        </div>
      </div>
      <Panel style={{ position: "absolute", left: 1096, top: 724, width: 440, padding: "18px 24px", boxSizing: "border-box" }}>
        <Eyebrow size={15} color={COLORS.muted}>
          Not paid to the pool
        </Eyebrow>
        <div style={{ fontSize: 20, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 8 }}>
          Raydium LaunchLab protocol fee <span style={{ ...mono, color: COLORS.fg }}>0.25%</span>, Raydium's.
          <br />
          IMAGINE platform fee <span style={{ ...mono, color: COLORS.fg }}>0%</span>.
        </div>
      </Panel>
    </Page>
  );
}

// --- a03: the multiplier curve ---------------------------------------------------

const HOUR = 3600;
const DAY = 86400;
const MIN = 4 * HOUR;
const MAX = 365 * DAY;

const TERMS: Array<{ label: string; long: string; secs: number; m: string }> = [
  { label: "4h", long: "4 hours", secs: 4 * HOUR, m: "1.00" },
  { label: "1d", long: "1 day", secs: DAY, m: "1.14" },
  { label: "7d", long: "7 days", secs: 7 * DAY, m: "1.41" },
  { label: "30d", long: "30 days", secs: 30 * DAY, m: "1.86" },
  { label: "90d", long: "90 days", secs: 90 * DAY, m: "2.49" },
  { label: "180d", long: "180 days", secs: 180 * DAY, m: "3.11" },
  { label: "365d", long: "365 days", secs: 365 * DAY, m: "4.00" },
];

const sqrtCurve = (secs: number) => 1 + 3 * Math.sqrt((secs - MIN) / (MAX - MIN));
const linear = (secs: number) => 1 + (3 * (secs - MIN)) / (MAX - MIN);

export function A03Curve() {
  const plot = { x: 150, y: 250, w: 880, h: 440 };
  const lo = 0.85;
  const hi = 4.15;
  const X = (secs: number) => plot.x + (secs / MAX) * plot.w;
  const Y = (m: number) => plot.y + plot.h - ((m - lo) / (hi - lo)) * plot.h;
  const samples = Array.from({ length: 401 }, (_, i) => MIN + ((MAX - MIN) * i) / 400);
  const curve = samples.map((s, i) => `${i ? "L" : "M"}${X(s).toFixed(1)},${Y(sqrtCurve(s)).toFixed(1)}`).join(" ");
  const area = `${curve} L${X(MAX)},${Y(lo)} L${X(MIN)},${Y(lo)} Z`;
  const t30 = 30 * DAY;
  const labels: Record<string, { dx: number; dy: number; anchor: "start" | "end" | "middle" }> = {
    "30d": { dx: 18, dy: 8, anchor: "start" },
    "90d": { dx: 14, dy: 40, anchor: "start" },
    "180d": { dx: 14, dy: 40, anchor: "start" },
    "365d": { dx: -20, dy: -24, anchor: "end" },
  };
  return (
    <Page>
      <Brand />
      <Header eyebrow="The math · duration">
        A square-root curve, <Dream>1.00× to 4.00×.</Dream>
      </Header>

      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <linearGradient id="curve-dream" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8CC8DC" />
            <stop offset="0.55" stopColor="#5EE9B5" />
            <stop offset="1" stopColor="#C7F9E5" />
          </linearGradient>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(94,233,181,0.18)" />
            <stop offset="1" stopColor="rgba(94,233,181,0)" />
          </linearGradient>
        </defs>
        {[1, 2, 3, 4].map((m) => (
          <g key={m}>
            <line x1={plot.x} x2={plot.x + plot.w} y1={Y(m)} y2={Y(m)} stroke={COLORS.line} strokeWidth={1.5} strokeDasharray="4 8" />
            <text x={plot.x - 18} y={Y(m) + 8} textAnchor="end" fill={COLORS.muted} style={{ ...mono, fontSize: 22 }}>
              {m}.00×
            </text>
          </g>
        ))}
        <line x1={plot.x} x2={plot.x + plot.w} y1={Y(lo)} y2={Y(lo)} stroke={COLORS.lineStrong} strokeWidth={2} />
        {[
          { s: MIN, t: "4h" },
          { s: 30 * DAY, t: "30d" },
          { s: 90 * DAY, t: "90d" },
          { s: 180 * DAY, t: "180d" },
          { s: 365 * DAY, t: "365d" },
        ].map(({ s, t }) => (
          <g key={t}>
            <line x1={X(s)} x2={X(s)} y1={Y(lo)} y2={Y(lo) + 10} stroke={COLORS.lineStrong} strokeWidth={2} />
            <text x={X(s)} y={Y(lo) + 40} textAnchor="middle" fill={COLORS.muted} style={{ ...mono, fontSize: 22 }}>
              {t}
            </text>
          </g>
        ))}
        <text x={plot.x + plot.w / 2} y={Y(lo) + 78} textAnchor="middle" fill={COLORS.muted} style={{ fontFamily: FONTS.sans, fontSize: 20 }}>
          lock term (time, to scale)
        </text>

        {/* the straight-line comparison, faint */}
        <line x1={X(MIN)} y1={Y(1)} x2={X(MAX)} y2={Y(4)} stroke={COLORS.fgSoft} strokeOpacity={0.3} strokeWidth={2.5} strokeDasharray="8 10" />
        <line x1={X(t30)} x2={X(t30)} y1={Y(linear(t30))} y2={Y(sqrtCurve(t30))} stroke={COLORS.mint} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 6" />
        <circle cx={X(t30)} cy={Y(linear(t30))} r={6} fill={COLORS.ink} stroke={COLORS.fgSoft} strokeOpacity={0.6} strokeWidth={2.5} />
        <text x={1020} y={600} textAnchor="end" fill={COLORS.fgSoft} fillOpacity={0.8} style={{ fontFamily: FONTS.sans, fontSize: 21 }}>
          <tspan x={1020}>dashed: a straight line, where 30d</tspan>
          <tspan x={1020} dy={30}>
            would be about <tspan style={mono}>1.25×</tspan>. On the curve: <tspan style={{ ...mono, fill: COLORS.mint }}>1.86×</tspan>
          </tspan>
        </text>

        <path d={area} fill="url(#curve-fill)" />
        <path d={curve} fill="none" stroke="url(#curve-dream)" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />

        {TERMS.map((t) => (
          <circle key={t.label} cx={X(t.secs)} cy={Y(Number(t.m))} r={t.label === "30d" ? 10 : 8} fill={COLORS.ink} stroke={COLORS.mint} strokeWidth={4} />
        ))}
        {TERMS.filter((t) => labels[t.label]).map((t) => {
          const l = labels[t.label];
          return (
            <text key={t.label} x={X(t.secs) + l.dx} y={Y(Number(t.m)) + l.dy} textAnchor={l.anchor} style={{ ...mono, fontSize: 26 }}>
              <tspan fill={COLORS.fgSoft}>{t.label} </tspan>
              <tspan fill={COLORS.mint}>{t.m}×</tspan>
            </text>
          );
        })}
        {/* 4h, 1d and 7d sit within the first few pixels of a 365-day axis */}
        <path d={`M${X(MIN)},${Y(1.41) - 18} L${X(MIN)},${Y(1.41) - 160} L${X(MIN) + 8},${Y(1.41) - 160}`} fill="none" stroke={COLORS.lineStrong} strokeWidth={2} />
        <text x={X(MIN) + 14} y={Y(1.41) - 152} style={{ ...mono, fontSize: 22 }} fill={COLORS.fgSoft}>
          4h · 1d · 7d
        </text>
      </svg>

      <Panel style={{ position: "absolute", left: 1112, top: 236, width: 424, padding: "22px 30px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Eyebrow size={16} color={COLORS.muted}>
            Term
          </Eyebrow>
          <Eyebrow size={16} color={COLORS.muted}>
            Multiplier
          </Eyebrow>
        </div>
        {TERMS.map((t, i) => (
          <div
            key={t.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              padding: "12px 0",
              borderTop: i === 0 ? undefined : `1px solid ${COLORS.line}`,
              marginTop: i === 0 ? 10 : 0,
            }}
          >
            <span style={{ fontSize: 27, fontWeight: 600, color: COLORS.fg }}>{t.long}</span>
            <span style={{ ...mono, fontSize: 30, color: t.label === "365d" ? COLORS.mint : COLORS.fg }}>{t.m}×</span>
          </div>
        ))}
      </Panel>

      <div style={{ position: "absolute", left: PAD, right: PAD, top: 812, fontSize: 24, lineHeight: 1.4, color: COLORS.fgSoft }}>
        <span style={{ color: COLORS.fg, fontWeight: 700 }}>Size bonus on top:</span> +10% at 0.1% of supply, +25% at 0.5%, +50% at 1%. It multiplies:{" "}
        a year-long lock of 1% of supply is <span style={{ ...mono, color: COLORS.mint, whiteSpace: "nowrap" }}>4.00 × 1.5 = 6.00×</span>.
      </div>
    </Page>
  );
}

// --- a04: the worked example -----------------------------------------------------

const EX_COLS = "190px 250px 100px 290px 220px 170px 196px";

function ExCell({ children, align = "left", style }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties }) {
  return <div style={{ textAlign: align, ...style }}>{children}</div>;
}

export function A04Example() {
  const rows = [
    { name: "Ana", role: "creator", amount: "10,000,000", pct: "1% of supply", term: "365d", mult: "4.00 × 1.5 = 6.00×", weight: "60,000,000", share: "67.9%", share_n: 67.9, usdc: "~611" },
    { name: "Ben", role: "", amount: "10,000,000", pct: "1% of supply", term: "30d", mult: "1.86 × 1.5 = 2.79×", weight: "~27,870,000", share: "31.5%", share_n: 31.5, usdc: "~284" },
    { name: "Cleo", role: "", amount: "500,000", pct: "0.05%, no tier", term: "4h", mult: "1.00×", weight: "500,000", share: "0.6%", share_n: 0.6, usdc: "~5" },
  ];
  const head: React.CSSProperties = { ...mono, fontSize: 16, letterSpacing: "0.14em", textTransform: "uppercase", color: COLORS.muted };
  return (
    <Page>
      <Brand />
      <Header eyebrow="The math · a worked example" badge={<Tag color={COLORS.rose}>Illustrative · no real coin</Tag>}>
        Three locks share 900 USDC.
      </Header>

      <div style={{ position: "absolute", left: PAD, right: PAD, top: 176, fontSize: 22, color: COLORS.fgSoft, lineHeight: 1.45 }}>
        A USDC-paired coin, supply <span style={mono}>1,000,000,000</span> · <span style={mono}>1,000 USDC</span> reaches the pool:{" "}
        <span style={mono}>100</span> to the treasury, <span style={{ ...mono, color: COLORS.mint }}>900</span> to lockers.
        <br />
        <span style={{ color: COLORS.muted }}>
          For scale: <span style={mono}>1,000 USDC</span> = 2% of <span style={mono}>50,000 USDC</span> traded on imagine.fun, or 0.5% of{" "}
          <span style={mono}>200,000 USDC</span> traded elsewhere on the curve
        </span>
      </div>

      <Panel style={{ position: "absolute", left: PAD, right: PAD, top: 254, padding: "0 28px", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: EX_COLS, alignItems: "center", padding: "18px 0 14px", borderBottom: `1px solid ${COLORS.line}`, ...head }}>
          <ExCell>Locker</ExCell>
          <ExCell>Locks</ExCell>
          <ExCell>Term</ExCell>
          <ExCell>Multiplier</ExCell>
          <ExCell align="right">Weight</ExCell>
          <ExCell align="right">Share</ExCell>
          <ExCell align="right">Of 900 USDC</ExCell>
        </div>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: EX_COLS, alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${COLORS.line}`, position: "relative" }}>
            <ExCell>
              <div style={{ fontSize: 29, fontWeight: 700 }}>{r.name}</div>
              {r.role && <div style={{ fontSize: 18, color: COLORS.muted, marginTop: 2 }}>{r.role}</div>}
            </ExCell>
            <ExCell>
              <div style={{ ...mono, fontSize: 25 }}>{r.amount}</div>
              <div style={{ fontSize: 18, color: COLORS.muted, marginTop: 2 }}>{r.pct}</div>
            </ExCell>
            <ExCell style={{ ...mono, fontSize: 25 }}>{r.term}</ExCell>
            <ExCell style={{ ...mono, fontSize: 24, color: COLORS.fgSoft }}>{r.mult}</ExCell>
            <ExCell align="right" style={{ ...mono, fontSize: 25 }}>
              {r.weight}
            </ExCell>
            <ExCell align="right">
              <div style={{ ...mono, fontSize: 25 }}>{r.share}</div>
              <div style={{ marginTop: 8, marginLeft: "auto", width: 120, height: 6, borderRadius: 999, background: COLORS.ink4 }}>
                <div style={{ width: `${Math.max(r.share_n, 2)}%`, height: 6, borderRadius: 999, background: COLORS.steel }} />
              </div>
            </ExCell>
            <ExCell align="right" style={{ ...mono, fontSize: 30, color: COLORS.mint }}>
              {r.usdc}
            </ExCell>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: EX_COLS, alignItems: "center", padding: "12px 0 14px", fontSize: 20, color: COLORS.muted }}>
          <ExCell style={{ gridColumn: "1 / 5" }}>Weight = amount × duration multiplier × (1 + size bonus)</ExCell>
          <ExCell align="right" style={{ ...mono, fontSize: 22, color: COLORS.fgSoft }}>
            ~88,370,000
          </ExCell>
          <ExCell align="right" style={{ ...mono, fontSize: 22, color: COLORS.fgSoft }}>
            100%
          </ExCell>
          <ExCell align="right" style={{ ...mono, fontSize: 22, color: COLORS.fgSoft }}>
            900 USDC
          </ExCell>
        </div>
      </Panel>

      <div style={{ position: "absolute", left: PAD, right: PAD, top: 646, display: "flex", gap: 24 }}>
        <Panel style={{ flex: 1, padding: "22px 30px", boxSizing: "border-box", height: 214 }}>
          <Eyebrow size={17}>The earnings cap</Eyebrow>
          <div style={{ fontSize: 22, color: COLORS.fgSoft, marginTop: 12, lineHeight: 1.35 }}>If each 10,000,000 bag was worth 500 USDC when locked:</div>
          <div style={{ display: "flex", gap: 40, marginTop: 18 }}>
            <div>
              <div style={{ fontSize: 20, color: COLORS.muted }}>Ana can earn at most</div>
              <div style={{ ...mono, fontSize: 30, marginTop: 4 }}>
                500 × 6.00 = <span style={{ color: COLORS.mint }}>3,000</span> <span style={{ fontSize: 22, color: COLORS.fgSoft }}>USDC</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 20, color: COLORS.muted }}>Ben, about</div>
              <div style={{ ...mono, fontSize: 30, marginTop: 4 }}>
                <span style={{ color: COLORS.mint }}>1,393</span> <span style={{ fontSize: 22, color: COLORS.fgSoft }}>USDC</span>
              </div>
            </div>
          </div>
        </Panel>
        <Panel style={{ flex: 1, padding: "22px 30px", boxSizing: "border-box", height: 214 }}>
          <Eyebrow size={17} color={COLORS.rose}>
            Ben leaves early, on day 6
          </Eyebrow>
          <div style={{ fontSize: 22, color: COLORS.fgSoft, marginTop: 12, lineHeight: 1.35 }}>
            24 of 30 days left: <span style={{ ...mono, color: COLORS.fg }}>25% × 24/30 = 20%</span> of his principal burns.
          </div>
          <div style={{ display: "flex", gap: 40, marginTop: 18 }}>
            <div>
              <div style={{ fontSize: 20, color: COLORS.muted }}>back to Ben</div>
              <div style={{ ...mono, fontSize: 30, marginTop: 4 }}>8,000,000</div>
            </div>
            <div>
              <div style={{ fontSize: 20, color: COLORS.muted }}>burned</div>
              <div style={{ ...mono, fontSize: 30, marginTop: 4, color: COLORS.rose }}>2,000,000</div>
            </div>
            <div style={{ fontSize: 20, color: COLORS.fgSoft, lineHeight: 1.35, alignSelf: "flex-end" }}>
              his unclaimed USDC
              <br />
              streams to Ana and Cleo
            </div>
          </div>
        </Panel>
      </div>
    </Page>
  );
}

// --- a05: the four rules ----------------------------------------------------------

const RULES = [
  {
    title: "No admin withdraw path.",
    body: "No instruction moves a pool's rewards or locked coins to an admin. It isn't disabled or timelocked; it doesn't exist.",
  },
  {
    title: "Terms are frozen per pool.",
    body: "Fee split, multiplier curve, size tiers, lock bounds, exit penalty, stream window and treasury are copied onto the pool at launch and never rewritten.",
  },
  {
    title: "Claims and unlocks can't be paused.",
    body: "The pause switch stops new launches. Claiming and unlocking don't consult it.",
  },
  {
    title: "The creator locks first.",
    body: "No pool opens without the creator's founding lock, made in the launch transaction.",
  },
];

export function A05Rules() {
  return (
    <Page>
      <Brand />
      <Header eyebrow="Properties of the deployed program">
        What the program <Dream>will never do.</Dream>
      </Header>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 206, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {RULES.map((r, i) => (
          <Panel key={r.title} tone={i === 0 ? "dream" : "plain"} style={{ padding: "28px 34px", height: 252, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span
                style={{
                  ...mono,
                  fontSize: 20,
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: COLORS.ink3,
                  border: `1px solid ${COLORS.lineStrong}`,
                  color: COLORS.mint,
                }}
              >
                0{i + 1}
              </span>
              <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.025em" }}>{r.title}</span>
            </div>
            <div style={{ fontSize: 25, lineHeight: 1.45, color: COLORS.fgSoft, marginTop: 18 }}>{r.body}</div>
          </Panel>
        ))}
      </div>
      <Panel style={{ position: "absolute", left: PAD, right: PAD, top: 754, height: 80, padding: "0 34px", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ ...mono, fontSize: 20, color: COLORS.mint }}>+</span>
        <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em" }}>The creator earns nothing from fees.</span>
        <span style={{ fontSize: 23, color: COLORS.fgSoft }}>They earn only by locking.</span>
        <span style={{ marginLeft: "auto", fontSize: 19, color: COLORS.muted }}>
          Check it all: <span style={{ ...mono, color: COLORS.fgSoft }}>github.com/realdoomsman/imagine</span>
        </span>
      </Panel>
    </Page>
  );
}

// --- a06: the launch page -----------------------------------------------------------

/**
 * launch-nvdax.png is 2400px wide for a 1568px-wide view: 1.5306 px per CSS px.
 * From the pair search box down through the founding lock; the step-2 intro
 * line and the old fees section are outside the crop.
 */
const LAUNCH_CROP: [number, number, number, number] = [465, 236, 897, 1062];

const LAUNCH_STEPS: Array<{ title: string; body: string }> = [
  { title: "Pick the pair", body: "What the coin is priced in, and what its lockers are paid in." },
  { title: "Make the first buy", body: "In the transaction that creates the coin on Raydium LaunchLab and opens its pool." },
  { title: "Set the founding lock", body: "At least 10% of the first buy. Nobody can lock until it exists." },
];

const LAUNCH_FEES: Array<{ label: string; value: string; note: string; tone?: "mint" | "muted" }> = [
  { label: "On-chain trading fee", value: "0.5%", note: "every curve trade → the pool", tone: "mint" },
  { label: "App fee", value: "1.5%", note: "trades on imagine.fun → the pool", tone: "mint" },
  { label: "Raydium protocol fee", value: "0.25%", note: "Raydium LaunchLab's" },
  { label: "Pool creation", value: "0.05 SOL", note: "once, at launch" },
  { label: "Creator", value: "0%", note: "earns nothing from fees, only by locking", tone: "muted" },
];

export function A06Launch() {
  const top = 36;
  const imgH = H - top * 2 - BAR;
  const width = Math.round(LAUNCH_CROP[2] * (imgH / LAUNCH_CROP[3]));
  const left = W - PAD - width;
  const colW = left - PAD - 48;
  return (
    <Page glowX={80} glowY={30}>
      <div style={{ position: "absolute", left: PAD, top: 52, width: colW }}>
        <Eyebrow>The launch page · imagine.fun</Eyebrow>
        <Title size={46} style={{ marginTop: 14 }}>
          Pick the pair. Buy.
          <br />
          <Dream>Lock first.</Dream> Sign once.
        </Title>
      </div>
      <div style={{ position: "absolute", left: PAD, top: 214, width: colW, display: "flex", flexDirection: "column", gap: 18 }}>
        {LAUNCH_STEPS.map((s, i) => (
          <div key={s.title} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <span
              style={{
                ...mono,
                fontSize: 19,
                width: 36,
                height: 36,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: COLORS.mint,
                color: COLORS.ink,
                flex: "none",
                marginTop: 2,
              }}
            >
              {i + 1}
            </span>
            <div>
              <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em" }}>{s.title}</div>
              <div style={{ fontSize: 20, lineHeight: 1.38, color: COLORS.fgSoft, marginTop: 4 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>
      <Panel tone="dream" style={{ position: "absolute", left: PAD, top: 530, width: colW, padding: "20px 26px", boxSizing: "border-box" }}>
        <Eyebrow size={16}>Every fee, before you sign</Eyebrow>
        {LAUNCH_FEES.map((f, i) => (
          <div key={f.label} style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "9px 0", marginTop: i ? 0 : 8, borderTop: i ? `1px solid ${COLORS.line}` : undefined }}>
            <span style={{ ...mono, fontSize: 23, width: 118, flex: "none", color: f.tone === "mint" ? COLORS.mint : f.tone === "muted" ? COLORS.muted : COLORS.fg }}>{f.value}</span>
            <span style={{ fontSize: 20, lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, color: COLORS.fg }}>{f.label}</span> <span style={{ color: COLORS.fgSoft }}>· {f.note}</span>
            </span>
          </div>
        ))}
      </Panel>
      <div style={{ position: "absolute", left, top }}>
        <Browser url="imagine.fun/launch">
          <Shot src={LAUNCH_NVDAX} crop={LAUNCH_CROP} width={width} />
        </Browser>
      </div>
    </Page>
  );
}

// --- a07: a coin page and its lock panel (mainnet-fork demo) ------------------------

/** coin-lock.png: 1.5306 px per CSS px. coin-full.png: 2.0339 px per CSS px. */
const LOCK_PANEL: [number, number, number, number] = [1436, 153, 499, 811];
const TERMS_CARD: [number, number, number, number] = [465, 490, 945, 369];
/** Header down to the description line; stops above the button row, which links out to the launchpad. */
const COIN_HEAD: [number, number, number, number] = [437, 134, 1499, 211];

export function A07Coin() {
  const leftW = 900;
  const lockW = 520;
  const lockLeft = W - PAD - lockW;
  return (
    <Page glowX={85} glowY={20}>
      <div style={{ position: "absolute", left: PAD, top: 52, width: leftW }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Eyebrow>A coin page</Eyebrow>
          <Tag color="#F5B85C">Mainnet-fork demo · not a live coin</Tag>
        </div>
        <Title size={46} style={{ marginTop: 14 }}>
          Choose an amount and a term.
          <br />
          <Dream>Watch your weight before you sign.</Dream>
        </Title>
      </div>
      <div style={{ position: "absolute", left: PAD, top: 254, width: leftW }}>
        <Browser url="imagine.fun">
          <Shot src={COIN_FULL} crop={COIN_HEAD} width={leftW} />
        </Browser>
      </div>
      <Framed style={{ position: "absolute", left: PAD, top: 254 + BAR + shotHeight(COIN_HEAD, leftW) + 26, width: leftW }}>
        <Shot src={COIN_LOCK} crop={TERMS_CARD} width={leftW} />
      </Framed>
      <Framed style={{ position: "absolute", left: lockLeft, top: (H - shotHeight(LOCK_PANEL, lockW)) / 2, width: lockW, borderColor: "rgba(94,233,181,0.5)", boxShadow: "0 0 80px rgba(94,233,181,0.14), 0 30px 80px rgba(0,0,0,0.5)" }}>
        <Shot src={COIN_LOCK} crop={LOCK_PANEL} width={lockW} />
      </Framed>
    </Page>
  );
}

// --- a08: plain Raydium LaunchLab coin vs IMAGINE coin --------------------------------

/** Rows exactly as in the article; `plain: null` means "the same for both". */
const COMPARE: Array<{ label: string; plain: string | null; imagine: string }> = [
  { label: "Where it trades", plain: null, imagine: "The same for both: a LaunchLab curve, then a Raydium CPMM pool after graduation" },
  { label: "Who the coin's fee is paid to", plain: "The creator's wallet", imagine: "The coin's pool vault" },
  { label: "Trading fee on the curve", plain: "Whatever its platform sets, paid to the creator", imagine: "0.5% of every trade, paid to the pool" },
  { label: "After graduation", plain: "The Raydium pool's fee share goes to the creator", imagine: "The Raydium pool's fee share goes to the pool" },
  { label: "What the creator earns from fees", plain: "That fee", imagine: "Nothing. They earn only by locking" },
  { label: "Extra fee", plain: "None", imagine: "1.5% on trades made on imagine.fun, all of it into the pool" },
  { label: "What holders earn for holding", plain: "Nothing", imagine: "90% of everything that reaches the pool, by weight, in the pair asset" },
  { label: "The creator's commitment", plain: "None required", imagine: "A public founding lock before anyone else can lock" },
  { label: "Payout terms", plain: "None to speak of", imagine: "Frozen on the pool at launch" },
  { label: "Getting out", plain: "Sell any time", imagine: "The same for unlocked coins; locked coins wait for their term or pay the early-exit burn" },
];

const CMP_COLS = "300px 400px 1fr";

export function A08Compare() {
  return (
    <Page>
      <Brand top={46} />
      <div style={{ position: "absolute", left: PAD, top: 42 }}>
        <Title size={42}>
          A plain Raydium LaunchLab coin vs <Dream>an IMAGINE coin</Dream>
        </Title>
      </div>
      <Panel style={{ position: "absolute", left: PAD, right: PAD, top: 116, bottom: 30, padding: "0 30px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: CMP_COLS, padding: "16px 0 12px", borderBottom: `1px solid ${COLORS.lineStrong}`, alignItems: "center" }}>
          <span />
          <Eyebrow size={16} color={COLORS.muted}>
            Plain LaunchLab coin
          </Eyebrow>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Mark size={24} id="cmp-mark" />
            <Eyebrow size={16} color={COLORS.mint}>
              IMAGINE coin
            </Eyebrow>
          </div>
        </div>
        {COMPARE.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: CMP_COLS,
              alignItems: "center",
              minHeight: 67,
              borderBottom: i === COMPARE.length - 1 ? undefined : `1px solid ${COLORS.line}`,
              fontSize: 21,
              lineHeight: 1.28,
            }}
          >
            <span style={{ fontWeight: 700, color: COLORS.fg, paddingRight: 24 }}>{row.label}</span>
            {row.plain === null ? (
              <span style={{ gridColumn: "2 / 4", color: COLORS.fgSoft }}>{row.imagine}</span>
            ) : (
              <>
                <span style={{ color: COLORS.muted, paddingRight: 24 }}>{row.plain}</span>
                <span style={{ color: COLORS.fg, fontWeight: 600, display: "flex", gap: 14, alignItems: "baseline" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: COLORS.mint, flex: "none", transform: "translateY(-3px)" }} />
                  {row.imagine}
                </span>
              </>
            )}
          </div>
        ))}
      </Panel>
    </Page>
  );
}

// --- a09: proof ------------------------------------------------------------------------

/** Explorer captures (explorer-*-raydium.png): 1.25 px per CSS px. GitHub capture: 1.2755. */
const PROGRAM_TABLE: [number, number, number, number] = [370, 311, 765, 463];
const PLATFORM_TABLE: [number, number, number, number] = [370, 304, 765, 257];
const MAINNET_CHIP: [number, number, number, number] = [1217, 16, 212, 47];
/** Repo name, branch bar, last commit and the first folders; stops before the commit-message column. */
const REPO: [number, number, number, number] = [236, 236, 468, 434];

function ShotLabel({ kicker, value }: { kicker: string; value?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 10, whiteSpace: "nowrap" }}>
      <Eyebrow size={16} color={COLORS.muted}>
        {kicker}
      </Eyebrow>
      {value && <span style={{ ...mono, fontSize: 19, color: COLORS.fgSoft }}>{value}</span>}
    </div>
  );
}

/** `result` lines are copied from raw/cargo-test-raydium.txt and raw/sdk-test-raydium.txt. */
const CHECKS: Array<{ title: string; body: string; result?: string }> = [
  { title: "Rust unit tests", body: "the reward math", result: "test result: ok. 17 passed; 0 failed" },
  { title: "Integration", body: "real mainnet Raydium LaunchLab, CPMM, Token-2022 builds", result: "ℹ tests 115 · ℹ pass 115 · ℹ fail 0" },
  { title: "Randomised solvency check", body: "after every step" },
  { title: "Mainnet-fork rehearsal", body: "SOL + SPYx: buy, sell, lock, fee collection, claim, early exit" },
];

export function A09Proof() {
  const leftW = 640;
  const rightLeft = PAD + leftW + 36;
  const rightW = W - PAD - rightLeft;
  const repoW = 310;
  return (
    <Page>
      <Brand />
      <Header eyebrow="Proof · Solana mainnet" size={46}>
        Live on mainnet. <Dream>Tested against the real thing.</Dream>
      </Header>

      <div style={{ position: "absolute", left: PAD, top: 170, width: leftW }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <ShotLabel kicker="Program" value="imaguT3X…4pQQ3spa" />
          <Framed style={{ marginBottom: 10, borderRadius: 8, boxShadow: "none" }}>
            <Shot src={EXPLORER_PROGRAM} crop={MAINNET_CHIP} width={150} />
          </Framed>
        </div>
        <Framed>
          <Shot src={EXPLORER_PROGRAM} crop={PROGRAM_TABLE} width={leftW} />
        </Framed>
        <div style={{ height: 22 }} />
        <ShotLabel kicker="IMAGINE platform config on Raydium LaunchLab" />
        <Framed>
          <Shot src={EXPLORER_PLATFORM} crop={PLATFORM_TABLE} width={leftW} />
        </Framed>
      </div>

      <div style={{ position: "absolute", left: rightLeft, top: 170, width: rightW }}>
        <ShotLabel kicker="Open source" value="github.com/realdoomsman/imagine" />
        <div style={{ display: "flex", gap: 20 }}>
          <Framed style={{ flex: "none" }}>
            <Shot src={GITHUB} crop={REPO} width={repoW} />
          </Framed>
          <Panel style={{ flex: 1, padding: "20px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Eyebrow size={15} color={COLORS.muted}>
                In the repo
              </Eyebrow>
              <div style={{ fontSize: 20, lineHeight: 1.4, color: COLORS.fg, marginTop: 6 }}>The program, the SDK, the API and the site.</div>
            </div>
            <div>
              <Eyebrow size={15} color={COLORS.muted}>
                Config
              </Eyebrow>
              <div style={{ ...mono, fontSize: 16, color: COLORS.fg, marginTop: 6 }}>FjjucCXt…NLy2RZorHa</div>
              <div style={{ fontSize: 18, lineHeight: 1.4, color: COLORS.fgSoft, marginTop: 4 }}>
                names the platform config every launch is checked against:
              </div>
              <div style={{ ...mono, fontSize: 16, color: COLORS.mint, marginTop: 4 }}>DYtCiTPJ…tQHaQNULk</div>
            </div>
          </Panel>
        </div>
        <Panel style={{ marginTop: 16, padding: "14px 26px 16px", boxSizing: "border-box", background: COLORS.ink1 }}>
          <Eyebrow size={15} color={COLORS.muted}>
            Tested against the real thing, not mocks
          </Eyebrow>
          {CHECKS.map((c, i) => (
            <div key={c.title} style={{ display: "flex", gap: 14, alignItems: "flex-start", paddingTop: 10, marginTop: 8, borderTop: i ? `1px solid ${COLORS.line}` : undefined }}>
              <svg width={22} height={22} viewBox="0 0 22 22" style={{ flex: "none", marginTop: 2 }}>
                <circle cx={11} cy={11} r={10} fill="rgba(94,233,181,0.14)" stroke={COLORS.mint} strokeWidth={1.5} />
                <path d="M6.5 11.5 L9.5 14.5 L15.5 8" fill="none" stroke={COLORS.mint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <div style={{ fontSize: 19, lineHeight: 1.35, color: COLORS.fgSoft }}>
                  <span style={{ color: COLORS.fg, fontWeight: 700 }}>{c.title}</span> · {c.body}
                </div>
                {c.result && <div style={{ ...mono, fontSize: 22, color: COLORS.mint, marginTop: 4 }}>{c.result}</div>}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </Page>
  );
}
