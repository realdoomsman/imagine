import { useEffect, useState } from "react";
import { AbsoluteFill, Img, cancelRender, continueRender, delayRender, staticFile } from "remotion";
import { Dream } from "../kit";
import { COLORS, FONTS } from "../theme";
import { Ground, SignOff } from "./common";

/**
 * p04, 1600×900: proof. Addresses from posts.json p04; the Explorer pane is a
 * crop of the real capture; the terminal lines are read verbatim from captured
 * post-pivot test output in out/x/raw (file names are props, so the render
 * fails rather than falls back if the capture is missing). The IMAGINE
 * platform config is shown only once Main fills it (out/x/facts-todo.md).
 */

const ADDRESSES: Array<[string, string]> = [
  ["Program", "imaguT3XXBk1MuKQA6XCk1KJsGM2YgfM1tA4pQQ3spa"],
  ["Upgrade authority", "E1MQZaMhRELUihUffFCUbuARpTy53fJv8hpB98MoYhZc"],
  ["Config", "FjjucCXttbwBzNdBkxHS6wtQYqaUpwxtAjNLy2RZorHa"],
];

const CHECKS = [
  "Real mainnet Raydium LaunchLab, CPMM and Token-2022 builds",
  "Randomised solvency check after every step",
  "Mainnet-fork rehearsal: SOL- and SPYx-paired coins, buy / sell / lock / fee collection / claim / early exit",
];

export type P04Props = {
  /** Captured `cargo test` output in out/x/raw. */
  cargoFile: string;
  /** Captured SDK LiteSVM (`node --test`) output in out/x/raw. */
  sdkFile: string;
  /** The SDK suite shown above the summary, verbatim from "▶ name" to "✔ name". */
  sdkSuite: string;
  /** IMAGINE platform config on Raydium LaunchLab; null until Main fills it. */
  platformConfig: string | null;
};

const mono = (size: number, color: string): React.CSSProperties => ({ fontFamily: FONTS.mono, fontWeight: 500, fontSize: size, color });
const card: React.CSSProperties = {
  position: "absolute",
  background: COLORS.ink2,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 60px rgba(0,0,0,0.35)",
  boxSizing: "border-box",
  overflow: "hidden",
};
const eyebrow: React.CSSProperties = { ...mono(17, COLORS.steelHi), letterSpacing: "0.18em", textTransform: "uppercase" };

/** A window onto part of a capture: region (x, y, w, h) in source pixels, shown `width` wide. */
function Crop({ src, srcW, srcH, region, width }: { src: string; srcW: number; srcH: number; region: [number, number, number, number]; width: number }) {
  const [x, y, w, h] = region;
  const s = width / w;
  return (
    <div style={{ position: "relative", width, height: h * s, overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left: -x * s, top: -y * s, width: srcW * s, height: srcH * s }} />
    </div>
  );
}

function useText(file: string): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null);
  const [handle] = useState(() => delayRender(`load ${file}`));
  useEffect(() => {
    fetch(staticFile(file))
      .then((r) => {
        if (!r.ok) throw new Error(`missing capture ${file} (${r.status})`);
        return r.text();
      })
      .then((t) => {
        setLines(t.replace(/\r/g, "").split("\n"));
        continueRender(handle);
      })
      .catch((err) => cancelRender(err));
  }, [file, handle]);
  return lines;
}

function Term({ lines, pass }: { lines: string[]; pass: (line: string) => boolean }) {
  return (
    <div style={{ ...mono(15, COLORS.fgSoft), lineHeight: 1.5, whiteSpace: "pre" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", color: pass(l) ? COLORS.mint : COLORS.fgSoft }}>
          {l || " "}
        </div>
      ))}
    </div>
  );
}

export function P04({ cargoFile, sdkFile, sdkSuite, platformConfig }: P04Props) {
  const cargo = useText(cargoFile);
  const sdk = useText(sdkFile);
  if (!cargo || !sdk) return null;
  const cargoResult = cargo.findIndex((l) => l.startsWith("test result:"));
  const cargoLines = [cargo.find((l) => l.startsWith("running ")) ?? "", "…", ...cargo.slice(cargoResult - 4, cargoResult + 1).filter((l) => l.trim())];
  const sdkLines = sdk.filter((l) => /^ℹ (tests|suites|pass|fail) /.test(l));
  const suiteStart = sdk.indexOf(`▶ ${sdkSuite}`);
  const suiteEnd = sdk.findIndex((l, i) => i > suiteStart && l.startsWith(`✔ ${sdkSuite} (`));
  if (suiteStart < 0 || suiteEnd < 0) throw new Error(`suite "${sdkSuite}" not found in ${sdkFile}`);
  const sdkHead = sdk.slice(suiteStart, suiteEnd + 1);
  const addresses: Array<[string, string]> = platformConfig ? [...ADDRESSES, ["IMAGINE platform config (Raydium LaunchLab)", platformConfig]] : ADDRESSES;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, fontFamily: FONTS.sans, color: COLORS.fg }}>
      <Ground glowX={60} glowY={30} glow={0.55} grain={false} />
      <div style={{ position: "absolute", left: 72, top: 54, fontWeight: 800, fontSize: 60, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
        Live on mainnet. <Dream>Open source. Tested.</Dream>
      </div>

      {/* left: on-chain */}
      <div style={{ position: "absolute", left: 72, top: 158, width: 728, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, position: "relative", padding: "20px 28px 12px" }}>
        <div style={eyebrow}>Live on Solana mainnet</div>
        {addresses.map(([label, addr]) => (
          <div key={label} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 16, color: COLORS.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ ...mono(21, COLORS.fg), marginTop: 2, letterSpacing: "0.01em" }}>{addr}</div>
          </div>
        ))}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.line}`, display: "flex", alignItems: "center", gap: 12 }}>
          <svg width={24} height={24} viewBox="0 0 16 16" fill={COLORS.fg}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span style={mono(21, COLORS.fg)}>github.com/realdoomsman/imagine</span>
        </div>
      </div>

      {/* left: the Explorer, as captured */}
      <div style={{ ...card, position: "relative", padding: "14px 20px 18px", background: "#141a1d" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ ...eyebrow, color: COLORS.fgSoft }}>Solana Explorer · program account</span>
          <Crop src="explorer-program-raydium.png" srcW={2000} srcH={1250} region={[1238, 18, 214, 44]} width={150} />
        </div>
        <Crop src="explorer-program-raydium.png" srcW={2000} srcH={1250} region={[390, 312, 1220, 462]} width={688} />
      </div>
      </div>

      {/* right: tests */}
      <div style={{ position: "absolute", left: 842, top: 158, width: 686 }}>
        <div style={eyebrow}>Tested against the real thing</div>
      </div>
      <div style={{ ...card, left: 842, top: 194, width: 686, background: "#060c0e", border: `1px solid ${COLORS.lineStrong}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.ink1 }}>
          {["#FB7185", "#F5C46B", "#5EE9B5"].map((c) => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: 999, background: c, opacity: 0.75 }} />
          ))}
          <span style={{ ...mono(15, COLORS.muted), marginLeft: 10 }}>captured test output</span>
        </div>
        <div style={{ padding: "14px 20px 6px" }}>
          <div style={{ ...mono(14, COLORS.steelHi), letterSpacing: "0.14em", marginBottom: 4 }}>RUST · cargo test</div>
          <Term lines={cargoLines} pass={(l) => l.startsWith("test result: ok.")} />
        </div>
        <div style={{ padding: "8px 20px 16px", borderTop: `1px dashed ${COLORS.line}` }}>
          <div style={{ ...mono(14, COLORS.steelHi), letterSpacing: "0.14em", marginBottom: 4 }}>SDK · LiteSVM integration</div>
          <Term lines={[...sdkHead, ...sdkLines]} pass={(l) => /^ℹ (tests|pass) /.test(l)} />
        </div>
      </div>

      <div style={{ position: "absolute", left: 842, top: 636, width: 686 }}>
        {CHECKS.map((c) => (
          <div key={c} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 12 }}>
            <span style={{ ...mono(19, COLORS.mint), lineHeight: 1.35 }}>✓</span>
            <span style={{ fontSize: 19, lineHeight: 1.35, color: COLORS.fgSoft }}>{c}</span>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 842, bottom: 40, ...mono(16.5, COLORS.muted), lineHeight: 1.4 }}>
        No external audit published yet.
        <br />
        Internal review: docs/AUDIT.md
      </div>
      <SignOff size={24} right={72} bottom={44} />
    </AbsoluteFill>
  );
}
