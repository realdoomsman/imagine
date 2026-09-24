"use client";

import { useRef, useState } from "react";
import { Reveal } from "./motion";

/**
 * The sixty-second film, self-hosted.
 *
 * It starts on a click, with sound: this is the one place on the site where
 * audio is the point, so there is no autoplay and no muted loop. The poster
 * is a frame from the close so the section reads as the brand at rest.
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
    <section className="relative border-t border-steel-780">
      <div className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:py-32">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className="rule-label">Sixty seconds</span>
              <h2 className="t-section mt-5 max-w-[16ch]">The whole idea, with the sound on.</h2>
            </div>
            <p className="max-w-[44ch] text-[15px] leading-relaxed text-steel-500">
              Where a coin&apos;s fees go today, where VISE sends them, how a lock
              is weighed, and what the program will never be able to do.
            </p>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="panel relative mt-10 overflow-hidden p-0">
            <video
              ref={video}
              className="aspect-video w-full bg-steel-990"
              poster="/film/poster.jpg"
              preload="metadata"
              playsInline
              controls={playing}
              onPlay={() => setPlaying(true)}
              onEnded={() => setPlaying(false)}
            >
              <source src="/film/vise-promo.mp4" type="video/mp4" />
            </video>
            {!playing ? (
              <button
                type="button"
                onClick={play}
                className="group absolute inset-0 flex items-center justify-center bg-steel-990/30 transition-colors hover:bg-steel-990/20"
                aria-label="Play the film"
              >
                <span className="flex size-20 items-center justify-center rounded-full border border-torch/60 bg-torch/15 text-torch backdrop-blur-sm transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
                <span className="absolute bottom-5 left-6 rounded-machined border border-white/10 bg-steel-990/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-steel-300">
                  1:00 · sound on
                </span>
              </button>
            ) : null}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
