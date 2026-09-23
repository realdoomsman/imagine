# VISE — Brand & Art Direction

## The name

**VISE** /vaɪs/ — a bench vise: two steel jaws, a screw, and a handle. You crank
it; it holds. The harder you crank, the tighter the grip.

It is the product in one object. The lock-duration control *is* a vise handle:
turn it, the jaws close, the multiplier climbs. Nothing else in the category owns
a physical mechanism — competitors own gradients.

Chosen over: RIVET (great double meaning, but rivet.gg/rivet.cloud already exist
in dev-infra), ANVIL (Foundry's local node), CASK, TENURE, GRIP, BALLAST.

- Domains available as of 2026-09-22 (RDAP, verified): **vise.fun**, **vise.money**
  (vise.com / vise.xyz / vise.app are registered). Primary: `vise.fun` — the
  `.fun` TLD is native to this ecosystem (pump.fun, letsbonk.fun).
- Ticker: **$VISE**. Handle: `@visedotfun` (single-word `@vise` is `[UNVERIFIED]`
  and almost certainly taken).
- No significant Solana project named VISE found. `$VICE` exists as an unrelated
  memecoin — different spelling, different category.

## Voice

Blunt, mechanical, declarative. Short sentences. No hype adjectives, no emoji, no
"revolutionary". The product is about pressure and time, so the language is too.

- Primary line: **Hold under pressure.**
- Support: *Clamp your bags. Earn the fees.*
- Explainer: *Every trade pays the people who didn't sell.*
- Anti-lines we never use: "to the moon", "gm", "wagmi", "unlock the future of".

## Palette

Dark-first, industrial, almost monochrome — colour is data, not decoration.

| Token | Hex | Use |
|---|---|---|
| `--steel-950` | `#08090B` | page ground |
| `--steel-900` | `#0E1013` | panels |
| `--steel-800` | `#161A1F` | raised surfaces |
| `--steel-700` | `#232A32` | borders |
| `--steel-500` | `#5A6675` | muted text |
| `--steel-300` | `#A8B3C1` | body text |
| `--steel-050` | `#ECEFF3` | headings |
| `--torch` | `#FF5A1F` | the single accent: heat, pressure, the clamp |
| `--torch-dim` | `#B33A11` | pressed/hover states |
| `--verdi` | `#3FCF8E` | positive deltas, paid rewards |
| `--rust` | `#E5484D` | penalties, burns, danger |

One accent only. `--torch` is orange because everything else in crypto is
purple-blue; orange reads as forge heat and survives on a dark ground.

## Type

- **Display / headings:** `Bricolage Grotesque` (OFL, variable). Slightly
  condensed, mechanical, with real personality at large sizes — not another Inter
  headline.
- **Body / UI:** `Geist Sans` (OFL). Neutral, excellent at 13–16px.
- **Data / numerals:** `Geist Mono` (OFL), tabular figures everywhere a number
  can change. Every balance, multiplier, countdown, and address is monospace.

Rule: if a number updates, it is monospace and tabular. Nothing may reflow when a
digit changes.

## Motif system

1. **The jaws.** Two opposing bars that close. Used as the logo, the lock slider,
   section dividers, and the loading state.
2. **Knurling.** The diagonal-hatch texture of a vise handle. Used as a repeating
   4px diagonal pattern on panel edges and progress tracks — a texture, never a
   gradient.
3. **Pressure gauge.** Multiplier is rendered as a gauge arc, not a plain number,
   on the lock screen and in the hero.
4. **Machined edges.** 2px radii, hairline `--steel-700` borders, no soft shadows.
   Depth comes from a 1px top highlight (`rgba(255,255,255,0.06)`), the way
   brushed metal catches light.

## Motion

- Library: **GSAP** + ScrollTrigger for scripted sequences, **Motion** for React
  component transitions, **Lenis** for scroll smoothing.
- Signature: *the clamp*. Interactive elements close on themselves before
  resolving — 180ms in, 90ms settle, `cubic-bezier(0.2, 0.9, 0.1, 1)`.
- Numbers never crossfade; they roll on a monospace ticker.
- Hero: a canvas-drawn vise whose jaw position is bound to the duration slider.
  Deterministic geometry, no particle soup, no floating 3D orbs.
- Budget: hero interactive < 16ms/frame on an M1 Air; the entire motion layer is
  skipped under `prefers-reduced-motion`.

## Anti-AI-look rules

These are the tells that make a site read as generated. All are banned:

1. No purple→blue gradient meshes or glowing blurred blobs.
2. No centred hero + three identical feature cards with icon circles.
3. No emoji as bullets or section markers.
4. No generic glassmorphism (`backdrop-blur` over a gradient).
5. No stock 3D orbs, crystals, or abstract renders.
6. No "Powered by AI" language, no em-dash-heavy marketing prose.
7. No Inter as the display face.
8. Every screenshot in marketing is a real screenshot of the real app.
9. Asymmetry is deliberate: the grid is 12 columns and content is allowed to sit
   in 7 or 5, never always centred.
10. Copy is specific ("2% of every trade, split by weight") over abstract
    ("maximise your yield potential").
