"use client";

import { useEffect, useRef } from "react";

/**
 * The hero mechanism: a bench vise drawn on canvas whose jaw position tracks
 * `grip` (0..1), the normalised lock duration.
 *
 * Deterministic geometry rather than particles or a 3D scene — it is the
 * product's core idea rendered literally, and it costs a few hundred draw calls
 * a frame instead of a WebGL context.
 */
export function ViseCanvas({ grip, className }: { grip: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The target is read inside the animation loop; a ref keeps the loop from
  // being torn down and rebuilt on every slider tick.
  const target = useRef(grip);
  target.current = grip;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let current = target.current;
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      // Critically damped chase so the jaws feel mechanical, never springy.
      current += (target.current - current) * (reduced ? 1 : 0.12);

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width / 460, height / 260);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      const gap = 150 - current * 116; // 150px open → 34px clamped
      const jawW = 92;
      const jawH = 132;
      const bedY = jawH / 2;

      // Bed rail.
      ctx.fillStyle = "#12161b";
      ctx.fillRect(-230, bedY, 460, 16);
      ctx.fillStyle = "#1c232b";
      ctx.fillRect(-230, bedY, 460, 2);

      // Screw shaft, visibly shortening as the vise closes.
      ctx.strokeStyle = "#2a323c";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(gap / 2 + jawW / 2, 0);
      ctx.lineTo(205, 0);
      ctx.stroke();

      // Screw thread ticks.
      ctx.strokeStyle = "#39434f";
      ctx.lineWidth = 1.5;
      for (let x = gap / 2 + jawW / 2 + 6; x < 200; x += 9) {
        ctx.beginPath();
        ctx.moveTo(x, -5);
        ctx.lineTo(x, 5);
        ctx.stroke();
      }

      drawJaw(ctx, -gap / 2 - jawW, -jawH / 2, jawW, jawH, current);
      drawJaw(ctx, gap / 2, -jawH / 2, jawW, jawH, current);

      // The held block: compressed by the jaws, glowing hotter under pressure.
      const blockW = Math.max(gap - 10, 10);
      const heat = current;
      ctx.fillStyle = `rgba(255, 90, 31, ${0.1 + heat * 0.5})`;
      ctx.fillRect(-blockW / 2, -38, blockW, 76);
      ctx.strokeStyle = `rgba(255, 138, 92, ${0.35 + heat * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-blockW / 2, -38, blockW, 76);

      if (heat > 0.05) {
        ctx.save();
        ctx.globalAlpha = heat * 0.5;
        ctx.shadowColor = "#ff5a1f";
        ctx.shadowBlur = 26 * heat;
        ctx.fillStyle = "rgba(255,90,31,0.5)";
        ctx.fillRect(-blockW / 2, -38, blockW, 76);
        ctx.restore();
      }

      // Handle, rotating with the crank.
      ctx.save();
      ctx.translate(205, 0);
      ctx.rotate(current * Math.PI * 1.75);
      ctx.strokeStyle = "#5a6675";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.lineTo(0, 46);
      ctx.stroke();
      ctx.fillStyle = "#7c8798";
      ctx.beginPath();
      ctx.arc(0, -46, 6, 0, Math.PI * 2);
      ctx.arc(0, 46, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="A bench vise clamping tighter as the lock duration increases"
    />
  );
}

function drawJaw(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  heat: number,
) {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, "#2b333d");
  grad.addColorStop(0.5, "#1a2027");
  grad.addColorStop(1, "#11161b");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "#39434f";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Knurled gripping face, pointing inward.
  const faceAtRight = x < 0;
  const faceX = faceAtRight ? x + w - 12 : x;
  ctx.save();
  ctx.beginPath();
  ctx.rect(faceX, y, 12, h);
  ctx.clip();
  ctx.strokeStyle = `rgba(255,140,90,${0.18 + heat * 0.3})`;
  ctx.lineWidth = 1;
  for (let i = -h; i < h * 2; i += 6) {
    ctx.beginPath();
    ctx.moveTo(faceX - 4, y + i);
    ctx.lineTo(faceX + 16, y + i - 14);
    ctx.stroke();
  }
  ctx.restore();

  // Top highlight: the way machined steel catches light.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 1);
  ctx.lineTo(x + w - 1, y + 1);
  ctx.stroke();
}
