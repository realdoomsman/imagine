"""
Music beds and UI sound for the X post videos p01 and p05, built on the
instruments in video/audio/score.py (same key, tempo and palette as the films).

Cue times are output seconds, matched to the cut lists in P01.tsx and P05.tsx.

    python video/src/x-posts/sound.py <out-dir>

writes p01.wav and p05.wav (48 kHz stereo) into <out-dir>.
"""

from __future__ import annotations

import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "audio"))
import score  # noqa: E402
from score import (  # noqa: E402
    BAR,
    SR,
    Arrangement,
    bandpass,
    fade,
    highpass,
    impact,
    latch,
    lowpass,
    master,
    n,
    place,
    riser,
    stereo,
    t_axis,
)

rng = np.random.default_rng(23)
PEAK = 0.5  # -6 dBFS: a quiet bed (about -16 LUFS), encoded peaks well under -1 dBFS


def tick(pitch: float = 2_400.0, strength: float = 1.0) -> np.ndarray:
    """A small UI tick: a short sine ping over a filtered noise click."""
    L = n(0.07)
    t = t_axis(L)
    ping = np.sin(2 * np.pi * pitch * t) * np.exp(-t / 0.012)
    click = bandpass(rng.standard_normal(L), 2_000, 9_000) * np.exp(-t / 0.004) * 0.5
    return (ping * 0.6 + click) * strength


def key() -> np.ndarray:
    """A soft keyboard tap."""
    L = n(0.05)
    t = t_axis(L)
    body = lowpass(highpass(rng.standard_normal(L), 900), 5_000) * np.exp(-t / 0.007)
    return body * 0.5


def whoosh(seconds: float = 0.45) -> np.ndarray:
    """A short airy swipe for a cut."""
    L = n(seconds)
    t = t_axis(L)
    env = np.sin(np.pi * t / seconds) ** 2
    return bandpass(rng.standard_normal(L), 600, 5_000) * env * 0.28


# Each bed is an Arrangement started `offset` seconds early: bar k sounds at
# k * BAR - offset in output time, and `finish` trims the lead-in.
def finish(a: Arrangement, offset: float, seconds: float, cutoff_keys: list[tuple[float, float]], gains: dict[str, float], fx: np.ndarray) -> np.ndarray:
    times = t_axis(a.len) - offset
    cutoff = np.interp(times, [k for k, _ in cutoff_keys], [v for _, v in cutoff_keys])
    music = a.mix(cutoff, {**gains, "fx": 0.0})[n(offset) :][: n(seconds)]
    mixed = music + fx[: len(music)]
    return fade(master(stereo(mixed), PEAK), 1.0)


def p01() -> np.ndarray:
    """19.67 s. Title 0–2.2, sell-off 2.2–7.2, drag 8.0–15.8, end card 17.8."""
    seconds = 590 / 30
    offset = 2.0  # bars land on 0.5, 3.0, 5.5, 8.0 (drag), … 18.0 (end card)
    a = Arrangement(seconds + offset)
    a.pads_bars(0, 10, 0.9)
    a.pulse_bars(2, 4)
    a.bass_bars(4, 6, eighths=False)
    a.bass_bars(6, 8)
    a.arp_bars(5, 8, 0.35)
    a.motif_bars(8, 0.5)
    fx = np.zeros(n(seconds) + n(3))
    place(fx, riser(1.4), 2.2 - 1.4, 0.35)
    place(fx, impact(0.4, 1.4), 2.2, 0.6)
    place(fx, whoosh(0.5), 6.95, 0.8)
    place(fx, tick(1_900, 1.0), 8.0, 0.45)  # grab the slider
    for i, at in enumerate(np.arange(8.35, 15.7, 0.42)):
        place(fx, tick(1_300 + i * 70, 0.6), float(at), 0.22)
    place(fx, latch(0.7), 15.8, 0.45)
    place(fx, riser(1.0), 16.8, 0.3)
    place(fx, impact(0.7, 1.8), 17.8, 0.75)
    return finish(
        a,
        offset,
        seconds,
        [(-2, 400), (2.2, 650), (7.9, 380), (12, 1200), (15.8, 2000), (18, 2200), (19.7, 1300)],
        {"pads": 0.42, "bass": 0.5, "arp": 0.42, "drums": 0.45},
        fx,
    )


def p05() -> np.ndarray:
    """24.43 s. Steps at 1.33, 4.93, 11.8, 18.9; end card 22.23."""
    seconds = 733 / 30
    offset = 0.07  # bar 2 lands on step 2 (4.93)
    a = Arrangement(seconds + offset)
    a.pads_bars(0, 10, 0.85)
    a.bass_bars(0, 2, eighths=False)
    a.bass_bars(2, 9)
    a.arp_bars(1, 9, 0.32)
    a.motif_bars(9, 0.5)
    # hats only: motion without a beat
    for bar in range(2, 9):
        for k in range(8):
            place(a.drums, score.hat(open_=False), bar * BAR + k * BAR / 8, 0.32 if k % 2 == 0 else 0.18)
    fx = np.zeros(n(seconds) + n(3))
    for at in (1.33, 4.93, 11.8, 18.9):  # step changes
        place(fx, whoosh(0.4), at - 0.25, 0.7)
        place(fx, tick(2_200, 0.8), at, 0.3)
    # step 1: image drop, name and ticker typed
    place(fx, tick(1_600, 1.0), 1.8, 0.35)
    for at in np.arange(3.13, 3.93, 0.09):
        place(fx, key(), float(at), 0.5)
    for at in np.arange(4.27, 4.6, 0.09):
        place(fx, key(), float(at), 0.5)
    # step 2: category clicks, type SPY, pick SPYx
    for at in (5.14, 7.82):
        place(fx, tick(1_800, 0.9), at, 0.3)
    for at in (8.93, 9.03, 9.13):
        place(fx, key(), at, 0.5)
    place(fx, latch(0.5), 10.1, 0.35)
    # step 3: first buy, lock share slider, dial to 30 days
    place(fx, key(), 12.05, 0.5)
    for i, at in enumerate(np.arange(13.85, 14.9, 0.3)):
        place(fx, tick(1_300 + i * 90, 0.6), float(at), 0.18)
    for i, at in enumerate(np.arange(16.2, 18.0, 0.3)):
        place(fx, tick(1_200 + i * 80, 0.6), float(at), 0.18)
    place(fx, latch(0.6), 18.05, 0.4)
    place(fx, riser(1.0), 21.23, 0.3)
    place(fx, impact(0.6, 1.8), 22.23, 0.7)
    return finish(
        a,
        offset,
        seconds,
        [(0, 700), (4.9, 1100), (11.8, 1500), (18.9, 1800), (22.2, 2100), (24.4, 1200)],
        {"pads": 0.4, "bass": 0.45, "arp": 0.4, "drums": 0.5},
        fx,
    )


def write(path: pathlib.Path, samples: np.ndarray) -> None:
    import wave

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(f"wrote {path.name}: {len(samples) / SR:.2f}s")


if __name__ == "__main__":
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    write(out / "p01.wav", p01())
    write(out / "p05.wav", p05())
