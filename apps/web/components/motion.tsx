"use client";

import Lenis from "lenis";
import { useEffect, useRef } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Smooth scroll, driven from one clock.
 *
 * Lenis owns the scroll position and everything else reads from it, so the
 * page scroll and the hero chart's animation never fight over frames.
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

/**
 * Reveal on first scroll into view.
 *
 * Two nodes, deliberately: the outer node is unstyled and observed, the inner
 * one animates, so the hidden state's offset never moves the rect the
 * observer is waiting on.
 *
 * One shared observer rather than one per element: a long page can hold
 * dozens of these.
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
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
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
