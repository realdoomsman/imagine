"use client";

import { useEffect, useRef } from "react";

/**
 * The hero mechanism, rendered as a single full-screen fragment shader.
 *
 * The scene is built from signed distance fields — two jaws, a bed rail, a
 * screw, and the block being crushed between them — then lit like machined
 * steel: a key light off the top-left, anisotropic brushed streaks along each
 * jaw, and a specular edge that catches where the bevel turns.
 *
 * Raw WebGL2 rather than three.js: there is no geometry here, only one quad, so
 * a scene graph would be 150KB of dependency to draw two triangles.
 *
 * `grip` (0..1) closes the jaws and heats the block. Everything else — bloom,
 * heat shimmer, the glow on the jaw faces — is derived from it, so the whole
 * image responds to the lock-duration control as one machine.
 */

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uGrip;     // 0 open .. 1 clamped
uniform vec2  uMouse;    // -1..1, parallax
uniform float uReduced;  // 1 = honour prefers-reduced-motion
uniform float uBleed;    // 1 = full-bleed behind copy, 0 = its own band

const vec3 STEEL_DARK = vec3(0.055, 0.067, 0.082);
const vec3 STEEL_MID  = vec3(0.145, 0.170, 0.200);
const vec3 STEEL_HI   = vec3(0.420, 0.470, 0.530);
const vec3 TORCH      = vec3(1.000, 0.353, 0.122);
const vec3 TORCH_HOT  = vec3(1.000, 0.780, 0.520);

float hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  return sdBox(p, b - r) - r;
}

// --- scene -----------------------------------------------------------------

float gap()   { return mix(0.620, 0.150, uGrip); }
float jawW()  { return 0.285; }
float jawH()  { return 0.430; }
float bedY()  { return -jawH() * 0.5 - 0.075; }

/*
 * A jaw is not a rectangle. It is a face plate on a wider foot that rides the
 * bed, with the top outer corner chamfered off — that chamfer is most of what
 * makes a casting look machined rather than drawn.
 *
 * Evaluated in mirrored space (q.x >= 0) so one profile serves both sides.
 */
float sdJawProfile(vec2 q) {
  float faceX = gap() * 0.5;
  float cx = faceX + jawW() * 0.5;

  float body = sdRoundBox(q - vec2(cx, 0.020), vec2(jawW() * 0.5, jawH() * 0.5), 0.010);
  float foot = sdRoundBox(
    q - vec2(cx + 0.045, bedY() + 0.090),
    vec2(jawW() * 0.5 + 0.045, 0.062),
    0.010
  );
  float jaw = min(body, foot);

  // Chamfer: intersect with the half-plane that cuts the top outer corner.
  vec2 corner = q - vec2(cx + jawW() * 0.5 - 0.055, 0.020 + jawH() * 0.5 - 0.055);
  jaw = max(jaw, dot(corner, vec2(0.7071, 0.7071)));

  return jaw;
}

/// Both jaws plus the bed they ride on.
float sdJaws(vec2 p) {
  float jaws = sdJawProfile(vec2(abs(p.x), p.y));
  float bed  = sdRoundBox(p - vec2(0.0, bedY()), vec2(1.45, 0.048), 0.008);
  // A raised lip along the front of the bed, so it is not one flat bar.
  float lip  = sdRoundBox(p - vec2(0.0, bedY() - 0.052), vec2(1.45, 0.016), 0.006);
  return min(jaws, min(bed, lip));
}

/// The screw shaft and its T-handle, sized to stay inside the frame.
float sdScrew(vec2 p) {
  float outer = gap() * 0.5 + jawW();
  float endX = 0.900;
  float shaft = sdRoundBox(
    p - vec2((outer + endX) * 0.5, 0.020),
    vec2(max((endX - outer) * 0.5, 0.0), 0.021),
    0.018
  );
  float collar = sdRoundBox(p - vec2(outer + 0.045, 0.020), vec2(0.030, 0.062), 0.010);
  float bar    = sdRoundBox(p - vec2(endX, 0.020), vec2(0.026, 0.135), 0.024);
  return min(shaft, min(collar, bar));
}

/*
 * The billet. It is being crushed, so it bulges where it is not confined —
 * the half-height swells with grip and the free faces barrel outward. Not a
 * strict distance field any more, but the error is far below a pixel here.
 */
float sdBlock(vec2 p) {
  float hw = max(gap() * 0.5 - 0.010, 0.010);
  float bulge = 0.030 + uGrip * 0.055;
  float hh = 0.140 + uGrip * 0.030;
  hh += bulge * cos(clamp(p.x / max(hw, 0.001), -1.0, 1.0) * 1.5708);
  return sdRoundBox(p - vec2(0.0, 0.010), vec2(hw, hh), 0.010);
}

vec2 gradient(vec2 p, float eps) {
  return normalize(vec2(
    sdJaws(p + vec2(eps, 0.0)) - sdJaws(p - vec2(eps, 0.0)),
    sdJaws(p + vec2(0.0, eps)) - sdJaws(p - vec2(0.0, eps))
  ) + 1e-6);
}

/// Machined steel.
///
/// The body is a lit face with a brighter chamfer band at every edge, brushed
/// anisotropically along x. Detail is what sells metal: the gripping faces are
/// serrated, the jaws carry pin holes, and a fill light from the opposite side
/// keeps the shadow side from going to black.
vec3 shadeSteel(vec2 p, float d, float heat) {
  vec2 g = gradient(p, 0.0015);

  // 1 at the silhouette, 0 once you are well inside: the machined chamfer.
  float chamfer = smoothstep(0.028, 0.0, -d);
  vec3 n = normalize(vec3(g * chamfer * 1.35, 1.0));

  vec3 key  = normalize(vec3(-0.50, 0.74, 0.55));
  vec3 fill = normalize(vec3( 0.72, -0.26, 0.62));
  vec3 view = vec3(0.0, 0.0, 1.0);

  float diff  = max(dot(n, key), 0.0);
  float fillD = max(dot(n, fill), 0.0) * 0.30;
  float spec  = pow(max(dot(reflect(-key, n), view), 0.0), 24.0);

  float brush = noise(vec2(p.x * 360.0, p.y * 6.0)) * 0.085
              + noise(vec2(p.x * 64.0,  p.y * 2.6)) * 0.055;

  /*
   * Tonal range is the whole game. A uniform mid-grey reads as a drawn box; a
   * casting runs from near-black in its own shadow at the foot up to a bright
   * lit face at the top, and the eye reads that spread as volume.
   */
  vec3 albedo = mix(STEEL_DARK, STEEL_MID, clamp(0.18 + brush * 2.2, 0.0, 1.0));
  albedo = mix(albedo, STEEL_HI * 0.46, smoothstep(-0.10, 0.30, p.y) * 0.80);

  vec3 col = albedo * (0.34 + diff * 0.86 + fillD);
  col += STEEL_HI * spec * 0.50;

  // The chamfer catches the key light hardest where it faces up.
  float topFacing = smoothstep(0.15, 0.95, g.y);
  col += STEEL_HI * chamfer * (0.10 + topFacing * 0.55);
  // ...and drops into shade where it faces down.
  col *= mix(1.0, 0.55, chamfer * smoothstep(-0.15, -0.95, g.y));

  // Mirror x so both jaws share one set of detail maths.
  vec2 q = vec2(abs(p.x), p.y);
  float faceX = gap() * 0.5;

  // Serrated gripping face.
  float onFace = smoothstep(0.028, 0.004, abs(q.x - faceX))
               * smoothstep(jawH() * 0.5 + 0.02, jawH() * 0.5 - 0.02, abs(p.y - 0.02));
  float teeth = abs(fract(p.y * 30.0) - 0.5) * 2.0;
  col *= mix(1.0, 0.40 + teeth * 1.25, onFace);

  // A machined relief groove across the jaw face.
  float groove = smoothstep(0.009, 0.0, abs(p.y - 0.145))
               * smoothstep(0.0, 0.02, q.x - faceX - 0.02);
  col *= mix(1.0, 0.62, groove);
  col += STEEL_HI * smoothstep(0.004, 0.0, abs(p.y - 0.154)) * 0.30 * step(faceX + 0.04, q.x);

  // Pin holes through each jaw, with a lit upper bore lip.
  float holeCx = faceX + jawW() * 0.60;
  float hole = min(length(q - vec2(holeCx, 0.055)), length(q - vec2(holeCx, -0.095))) - 0.024;
  float holeMask = smoothstep(0.004, -0.004, hole);
  col = mix(col, vec3(0.010, 0.012, 0.016), holeMask);
  col += STEEL_HI * smoothstep(0.009, 0.0, abs(hole)) * 0.28
       * smoothstep(-0.02, 0.03, p.y - (p.y > -0.02 ? 0.055 : -0.095));

  // Heat bleeding onto whatever faces the billet.
  float faceGlow = smoothstep(0.22, 0.0, q.x - faceX) * heat;
  col += TORCH * faceGlow * 0.60 * smoothstep(0.30, 0.0, abs(p.y));

  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  /*
   * Composition follows the layout, not the aspect ratio.
   *
   * Full bleed: the headline owns the left third, so the mechanism is pushed
   * right and dropped below the optical centre, and the copy side is darkened.
   * Band: nothing overlaps it, so it centres and fills the strip it was given.
   */
  float wide = uBleed;
  vec2 p = uv * mix(1.85, 2.30, wide);
  p.x -= mix(0.0, 0.62, wide);
  p.y += mix(0.04, 0.12, wide);

  float t = uTime * (1.0 - uReduced);
  float heat = uGrip;

  p += uMouse * vec2(0.035, 0.022) * (1.0 - uReduced);

  // Heat shimmer: the air above a crushed block is not still.
  float shimmer = sin(p.y * 46.0 + t * 2.4) * 0.0016 * heat
                * smoothstep(0.55, 0.0, abs(p.x)) * (1.0 - uReduced);
  vec2 ps = p + vec2(shimmer, 0.0);

  float dJaw   = sdJaws(ps);
  float dScrew = sdScrew(ps);
  float dBlock = sdBlock(ps);

  /*
   * Background. Not a flat fill: a cold pool of light with large-scale noise
   * standing in for a room, so the plate has somewhere to sit.
   */
  float vign = 1.0 - dot(uv, uv) * 0.85;
  float room = noise(uv * 2.2 + 7.3) * 0.5 + noise(uv * 5.5 - 2.1) * 0.25;
  vec3 col = mix(vec3(0.016, 0.019, 0.025), vec3(0.046, 0.053, 0.066), vign);
  col += vec3(0.010, 0.013, 0.018) * room * vign;

  /*
   * The billet.
   *
   * A uniform orange rectangle reads as a light box. Real hot iron has a dark
   * oxide crust that cracks open under load, and the light comes out of those
   * cracks — so the surface is built dark first, then broken by a ridged noise
   * field whose seams glow. Brightest along the contact line, where the jaws
   * are doing the work.
   */
  float blockMask = smoothstep(0.004, -0.004, dBlock);
  float core = smoothstep(0.05, -0.13, dBlock);

  // Ridged noise: |0.5 - n| inverted gives thin high-contrast seams. Stretched
  // along x so the fissures run with the squeeze rather than looking organic.
  vec2 cp = vec2(ps.x * 6.5, ps.y * 24.0 - t * 0.10);
  float veins = 1.0 - abs(noise(cp) - 0.5) * 2.0;
  veins = pow(clamp(veins, 0.0, 1.0), 4.0);
  float fine = 1.0 - abs(noise(cp * vec2(3.4, 2.2) + 11.0) - 0.5) * 2.0;
  veins = clamp(veins + pow(clamp(fine, 0.0, 1.0), 6.0) * 0.5, 0.0, 1.0);

  // Contact band: the squeezed middle runs hottest.
  float band = exp(-pow((ps.y - 0.010) * 5.2, 2.0));

  vec3 crust = mix(vec3(0.085, 0.032, 0.018), TORCH * 0.30, core * 0.6);
  float emit = clamp(
    veins * (0.30 + heat * 0.70) * (0.28 + band * 0.80) + core * 0.10,
    0.0, 1.1
  );

  vec3 molten = crust + TORCH * emit * 0.95;
  molten = mix(molten, TORCH_HOT, clamp(emit * 0.60 * (0.25 + heat), 0.0, 1.0));
  molten = mix(molten, vec3(1.0, 0.97, 0.92), clamp(pow(emit, 3.0) * heat * 0.45, 0.0, 1.0));
  // Crust darkens at the very skin, where heat has bled into the jaws.
  molten *= mix(0.42, 1.0, smoothstep(0.0, -0.028, dBlock));
  col = mix(col, molten, blockMask);

  /*
   * Bloom. Two falloffs stacked: a tight white-hot halo right at the surface
   * and a wide, weak orange wash. One term alone either fogs the frame or
   * stops dead at the edge of the billet.
   */
  float dOut = max(dBlock, 0.0);
  float bloom = exp(-dOut * 26.0);
  col += TORCH * bloom * (0.12 + heat * 0.55);
  col += TORCH_HOT * exp(-dOut * 70.0) * (0.10 + heat * 0.45);
  col += TORCH * exp(-dOut * 5.5) * (0.020 + heat * 0.075);

  // A wash of heat across the bed directly beneath the billet.
  float floorY = -jawH() * 0.5 - 0.055;
  float castGlow = exp(-abs(ps.y - floorY) * 6.0) * smoothstep(0.9, 0.0, abs(ps.x));
  col += TORCH * castGlow * heat * 0.10;

  // Screw, then jaws on top so the shaft tucks behind them.
  float screwMask = smoothstep(0.003, -0.003, dScrew);
  col = mix(col, shadeSteel(ps, dScrew, 0.0) * 1.18, screwMask);

  float jawMask = smoothstep(0.003, -0.003, dJaw);
  col = mix(col, shadeSteel(ps, dJaw, heat), jawMask);

  // Contact shadow: the jaws occlude the bloom they sit in front of.
  col *= mix(1.0, 0.86, jawMask * bloom);

  // Contact sparks when fully clamped.
  if (heat > 0.72) {
    float sp = hash(floor(vec2(p.x * 180.0, p.y * 180.0 + t * 26.0)));
    float band = smoothstep(0.07, 0.0, abs(abs(p.x) - gap() * 0.5)) *
                 smoothstep(0.24, 0.0, abs(p.y));
    col += TORCH_HOT * step(0.9985, sp) * band * (heat - 0.72) * 12.0;
  }

  // --- post ---------------------------------------------------------------

  col *= 0.55 + 0.45 * vign;                       // vignette

  /*
   * Copy scrim. Rather than laying a DOM gradient over the canvas — which
   * flattens the whole render into a haze — the shader itself darkens the side
   * the headline occupies. In band mode nothing overlaps it, so no scrim.
   */
  float copySide = smoothstep(0.34, -0.50, uv.x * (uRes.x / uRes.y) / 1.6);
  col *= mix(1.0, 0.24, copySide * wide);

  col = pow(max(col, 0.0), vec3(0.92));            // lift the shadows slightly

  // Ordered dithering. Not for a retro look — a gentle quantise with a Bayer
  // offset is what stops a near-black gradient from banding into visible rings,
  // and it leaves a fine print-like tooth behind.
  float bx = mod(gl_FragCoord.x, 4.0), by = mod(gl_FragCoord.y, 4.0);
  float bayer = fract(sin(bx * 12.9898 + by * 78.233) * 43758.5453);
  bayer = (floor(bayer * 16.0) / 16.0 - 0.5) / 64.0;
  col = floor((col + bayer) * 64.0 + 0.5) / 64.0;

  // Film grain, animated so it reads as emulsion rather than a static texture.
  float grain = hash(gl_FragCoord.xy + fract(t) * 137.0) - 0.5;
  col += grain * 0.022;

  outColor = vec4(max(col, 0.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

export function ViseShader({
  grip,
  className,
}: {
  grip: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read inside the render loop so slider movement never rebuilds the context.
  const gripRef = useRef(grip);
  gripRef.current = grip;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return; // caller renders the static fallback

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(program, "uRes"),
      time: gl.getUniformLocation(program, "uTime"),
      grip: gl.getUniformLocation(program, "uGrip"),
      mouse: gl.getUniformLocation(program, "uMouse"),
      reduced: gl.getUniformLocation(program, "uReduced"),
      bleed: gl.getUniformLocation(program, "uBleed"),
    };
    gl.uniform1f(u.reduced, reduced ? 1 : 0);

    /*
     * The layout, read from the same breakpoint the stylesheet uses. Deriving
     * it from the canvas aspect instead would get the mobile band — which is
     * landscape-ish but has no copy over it — wrong in both directions.
     */
    const bleedQuery = window.matchMedia("(min-width: 1024px)");
    const syncBleed = () => gl.uniform1f(u.bleed, bleedQuery.matches ? 1 : 0);
    syncBleed();
    bleedQuery.addEventListener("change", syncBleed);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.ty = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap the device ratio: this shader is fill-rate bound, and 3x on a phone
      // buys nothing a viewer can see.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.res, width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let smoothGrip = gripRef.current;
    const start = performance.now();
    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible) return; // never burn GPU on an off-screen hero

      // Critically damped chase, so the jaws feel geared rather than springy.
      smoothGrip += (gripRef.current - smoothGrip) * (reduced ? 1 : 0.12);
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;

      gl.uniform1f(u.time, (performance.now() - start) / 1000);
      gl.uniform1f(u.grip, smoothGrip);
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      bleedQuery.removeEventListener("change", syncBleed);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="A steel vise clamping a glowing block, tightening as the lock duration increases"
    />
  );
}
