"use client";

import Lenis from "lenis";
import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Smooth scroll, driven from one clock.
 *
 * Lenis owns the scroll position and everything else reads from it. Running the
 * scroll physics on its own `requestAnimationFrame` while the shader runs on
 * another is what produces the tearing you see on half-finished sites.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    let frame = requestAnimationFrame(function tick(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}

/** Animated film grain over the whole page. */
export function Grain() {
  return <div className="grain" aria-hidden="true" />;
}

/**
 * Reveal on first scroll into view.
 *
 * Two nodes, deliberately. The hidden state clips with `clip-path`, and a
 * clipped element has a zero-area intersection rect — so an observer watching
 * the element it is hiding would never fire and the content would stay hidden
 * forever. The outer node is unstyled and observed; the inner one animates.
 *
 * One shared observer rather than one per element: a long page can hold a
 * hundred of these, and a hundred observers is a hundred callbacks per frame.
 */
let sharedObserver: IntersectionObserver | null = null;

function observe(node: Element) {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target instanceof HTMLElement) {
            entry.target.dataset.shown = "true";
          }
          sharedObserver?.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
  }
  sharedObserver.observe(node);
}

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      node.dataset.shown = "true";
      return;
    }
    observe(node);
  }, []);

  return (
    <div ref={ref} className={`reveal-root ${className}`}>
      <div className="reveal" style={{ transitionDelay: `${delay}ms` }}>
        {children}
      </div>
    </div>
  );
}

export function Ticker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
  duration = 1100,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [armed, value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {shown.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/**
 * Magnetic hover: the control leans toward the cursor as it approaches.
 *
 * Small displacement on purpose — enough that a pointer user feels the element
 * is physical, not so much that it turns into a toy.
 */
export function Magnetic({
  children,
  strength = 0.28,
  className = "",
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let raf = 0;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const radius = Math.max(rect.width, rect.height) * 1.1;
      const distance = Math.hypot(dx, dy);
      const falloff = Math.max(0, 1 - distance / radius);
      target.x = dx * strength * falloff;
      target.y = dy * strength * falloff;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      node.style.transform = `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0)`;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [strength]);

  return (
    <span ref={ref} className={`inline-block will-change-transform ${className}`}>
      {children}
    </span>
  );
}

/** Scroll progress 0..1 across an element, for scrubbing anything to scroll. */
export function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = node.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.min(Math.max(-rect.top / total, 0), 1));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);

  return progress;
}
