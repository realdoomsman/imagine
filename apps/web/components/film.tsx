"use client";

import { useRef, useState } from "react";
import { Reveal } from "./motion";

/**
 * The film, self-hosted. It starts on a click, with sound: no autoplay and no
 * muted loop, so the section reads as a poster until someone asks for it.
 */
export function Film() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = () => {
    const el = video.current;
    if (!el) return;
    el.muted = false;
    void el.play();
  };

  return (
    <section className="container-x py-20 lg:py-28">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">The film</span>
            <h2 className="t-h1 mt-4 max-w-[16ch]">Imagine the chart if nobody sold.</h2>
          </div>
          <p className="max-w-[44ch] text-[15px] leading-relaxed text-fg-soft">
            A coin on Raydium, the asset it&apos;s paired with, and the holders who lock it — the
            whole idea in under a minute.
          </p>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <div className="card relative mt-10 overflow-hidden p-0">
          <video
            ref={video}
            className="aspect-video w-full bg-ink-1"
            poster="/film/poster.jpg"
            preload="metadata"
            playsInline
            controls={playing}
            onPlay={() => setPlaying(true)}
            onEnded={() => setPlaying(false)}
          >
            <source src="/film/imagine-promo.mp4" type="video/mp4" />
          </video>
          {!playing ? (
            <button
              type="button"
              onClick={play}
              className="group absolute inset-0 flex items-end justify-start bg-gradient-to-t from-ink/70 via-transparent to-transparent p-4 transition-colors sm:p-6"
              aria-label="Play the film"
            >
              {/* Bottom-left, so the poster's own title stays readable. */}
              <span className="flex items-center gap-3 rounded-full border border-line bg-ink/85 py-1.5 pl-1.5 pr-4 backdrop-blur-md transition-colors group-hover:border-line-strong">
                <span
                  className="flex size-10 items-center justify-center rounded-full text-ink transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105 sm:size-12"
                  style={{ background: "var(--dream)" }}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
                <span className="text-left">
                  <span className="block text-[14px] font-bold text-fg">Play the film</span>
                  <span className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                    Sound on
                  </span>
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </Reveal>
    </section>
  );
}
