"""
Score and sound design for the VISE videos, synthesised from scratch.

Nothing here is sampled or licensed: every sound is built from oscillators,
noise and envelopes, so the output is ours outright and every render is
bit-identical. The palette is the brand's — machined, low, unhurried:

  drone    a detuned sub bed with a slow filter sweep, the room the film sits in
  tick     a dry mechanical click on eighth notes, the escapement of a machine
  crank    a metal-on-metal ratchet burst; lands exactly where the vise steps
  hit      a sub impact with a short noise transient; scene cuts and the logo
  riser    band-limited noise swelling into a cut

Timings are read from the compositions' beat structure and passed in per
video below. Output is 48 kHz stereo WAV into video/public, which Remotion's
<Audio> picks up by name.

    python video/audio/score.py
"""

from __future__ import annotations

import math
import pathlib
import wave

import numpy as np

SR = 48_000
OUT = pathlib.Path(__file__).resolve().parent.parent / "public"
rng = np.random.default_rng(7)


def seconds(n: float) -> int:
    return int(round(n * SR))


def env(length: int, attack: float, decay: float, sustain: float, release: float, hold: float = 0.0) -> np.ndarray:
    """ADSR in seconds; hold is time at sustain before the release starts."""
    a, d, h, r = seconds(attack), seconds(decay), seconds(hold), seconds(release)
    out = np.zeros(length)
    cursor = 0
    if a:
        out[cursor : cursor + a] = np.linspace(0, 1, a)[: max(0, length - cursor)]
        cursor += a
    if d and cursor < length:
        seg = np.linspace(1, sustain, d)
        out[cursor : cursor + d] = seg[: max(0, length - cursor)]
        cursor += d
    if cursor < length:
        end = min(length, cursor + h) if h else length - r
        out[cursor:end] = sustain
        cursor = end
    if r and cursor < length:
        seg = np.linspace(sustain, 0, r)
        out[cursor : cursor + r] = seg[: max(0, length - cursor)]
    return out


def lowpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """One-pole lowpass; cutoff may be an array for a sweep."""
    if np.isscalar(cutoff):
        alpha = np.full(len(x), math.exp(-2 * math.pi * float(cutoff) / SR))
    else:
        alpha = np.exp(-2 * np.pi * np.asarray(cutoff) / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = alpha[i] * acc + (1 - alpha[i]) * x[i]
        y[i] = acc
    return y


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


def drone(length: int, root: float = 36.7, sweep: tuple[float, float] = (90, 420)) -> np.ndarray:
    """Detuned saws an octave apart under a slow filter; the bed everything sits on."""
    t = np.arange(length) / SR
    voices = []
    for detune, gain in ((0, 0.6), (0.6, 0.35), (-0.7, 0.35), (12.02, 0.18), (7.0, 0.12)):
        f = root * 2 ** (detune / 12)
        saw = 2 * ((t * f) % 1) - 1
        voices.append(saw * gain)
    raw = np.sum(voices, axis=0) / 1.6
    cutoff = np.linspace(sweep[0], sweep[1], length)
    wobble = 1 + 0.06 * np.sin(2 * np.pi * 0.11 * t)
    return lowpass(raw, cutoff * wobble)


def tick() -> np.ndarray:
    """A dry click: a short noise burst through a high-ish bandpass, 40 ms."""
    n = seconds(0.04)
    noise = rng.standard_normal(n)
    body = highpass(lowpass(noise, 6_000), 1_800) * env(n, 0.0005, 0.03, 0.0, 0.005)
    return body * 0.9


def crank(strength: float = 1.0) -> np.ndarray:
    """A ratchet turn: a rapid train of metallic clicks with a ringing body."""
    n = seconds(0.55)
    out = np.zeros(n)
    t = np.arange(n) / SR
    # ring: inharmonic partials, the sound of a steel jaw seating
    for f, g, dec in ((1_320, 0.5, 0.08), (2_190, 0.3, 0.06), (3_470, 0.2, 0.05), (612, 0.35, 0.16)):
        out += g * np.sin(2 * np.pi * f * t) * np.exp(-t / dec)
    # clicks: eight fast pawls, slightly slowing
    pos = 0.0
    gap = 0.026
    for i in range(8):
        start = seconds(pos)
        click = tick()[: min(len(tick()), n - start)]
        out[start : start + len(click)] += click * (1.0 - i * 0.07)
        pos += gap
        gap *= 1.09
    # a thump underneath so it lands in the chest, not just the ears
    thump = np.sin(2 * np.pi * 58 * t) * np.exp(-t / 0.12)
    out += 0.7 * thump
    return out * strength * 0.8


def hit(strength: float = 1.0, tail: float = 1.6) -> np.ndarray:
    """A sub impact: pitched sine drop plus a noise transient."""
    n = seconds(tail)
    t = np.arange(n) / SR
    pitch = 46 * np.exp(-t / 0.09) + 41
    phase = 2 * np.pi * np.cumsum(pitch) / SR
    sub = np.sin(phase) * np.exp(-t / 0.55)
    click = lowpass(rng.standard_normal(n), 3_000) * np.exp(-t / 0.02)
    air = lowpass(rng.standard_normal(n), 900) * np.exp(-t / 0.3) * 0.25
    return (sub * 1.0 + click * 0.4 + air) * strength


def riser(length_s: float) -> np.ndarray:
    """Noise swelling into a cut, filter opening as it goes."""
    n = seconds(length_s)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    cutoff = 200 + 3_800 * (t / length_s) ** 2.4
    swell = (t / length_s) ** 2
    return lowpass(noise, cutoff) * swell * 0.55


def place(mix: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0) -> None:
    start = seconds(at)
    end = min(len(mix), start + len(sound))
    mix[start:end] += sound[: end - start] * gain


def ticks(mix: np.ndarray, start: float, end: float, bpm: float, gain: float) -> None:
    step = 60 / bpm / 2
    t = start
    accent = 0
    while t < end:
        place(mix, tick(), t, gain * (1.0 if accent % 4 == 0 else 0.55))
        t += step
        accent += 1


def stereo(mono: np.ndarray, width: float = 0.18) -> np.ndarray:
    """A touch of width from a short cross-delay; keeps the sub mono."""
    delay = seconds(0.011)
    left = mono.copy()
    right = mono.copy()
    left[delay:] += width * mono[:-delay]
    right[:-delay] += width * mono[delay:]
    return np.stack([left, right], axis=1)


def master(mix: np.ndarray, peak: float = 0.89) -> np.ndarray:
    # soft-knee saturation then normalise: loud enough for a phone speaker
    driven = np.tanh(mix * 1.4) / math.tanh(1.4)
    return driven / max(1e-9, np.max(np.abs(driven))) * peak


def write(name: str, samples: np.ndarray) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = np.clip(samples, -1, 1)
    pcm = (data * 32767).astype("<i2")
    with wave.open(str(OUT / name), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(f"wrote {name}: {len(samples) / SR:.1f}s")


def teaser() -> None:
    """12s. 0–3 title, 3–8 clamp with three cranks, 8–12 logo."""
    n = seconds(12)
    mix = np.zeros(n)
    bed = drone(n, sweep=(80, 520)) * env(n, 1.2, 0.0, 1.0, 2.4, hold=12 - 1.2 - 2.4)
    mix += bed * 0.5
    ticks(mix, 0.0, 8.0, 92, 0.35)
    # the three deliberate cranks: steps end at 0.83, 2.5, 4.17s into the scene
    for i, at in enumerate((3.83, 5.5, 7.17)):
        place(mix, crank(1.0 + i * 0.12), at, 0.95)
    place(mix, riser(1.0), 7.0, 0.7)
    place(mix, hit(1.0, 2.2), 8.0, 1.0)
    # a quieter second pulse under "Hold under pressure."
    place(mix, hit(0.45, 1.6), 9.4, 0.6)
    write("teaser.wav", master(stereo(mix)))


def explainer() -> None:
    """30s. Beats at 0, 6, 13, 21; closing from 21."""
    n = seconds(30)
    mix = np.zeros(n)
    bed = drone(n, root=41.2, sweep=(70, 380)) * env(n, 1.6, 0.0, 1.0, 3.0, hold=30 - 1.6 - 3.0)
    mix += bed * 0.42
    ticks(mix, 0.0, 21.0, 84, 0.28)
    for at in (6.0, 13.0):
        place(mix, riser(0.8), at - 0.8, 0.5)
        place(mix, hit(0.75, 1.4), at, 0.8)
    # ladder rows landing in beat three: 13s + 0.45s steps
    for i in range(5):
        place(mix, tick(), 13.2 + i * 0.45, 0.9)
    place(mix, riser(1.2), 19.8, 0.75)
    place(mix, hit(1.0, 2.4), 21.0, 1.0)
    # one crank as the vise seats under the closing wordmark
    place(mix, crank(0.9), 22.6, 0.8)
    place(mix, hit(0.4, 2.0), 26.0, 0.5)
    write("explainer.wav", master(stereo(mix)))


def vertical() -> None:
    """15s. Lines at 0, 3.2, 6.4; payoff 9–15."""
    n = seconds(15)
    mix = np.zeros(n)
    bed = drone(n, sweep=(90, 600)) * env(n, 0.8, 0.0, 1.0, 2.0, hold=15 - 0.8 - 2.0)
    mix += bed * 0.5
    ticks(mix, 0.0, 9.0, 96, 0.4)
    for at in (3.2, 6.4):
        place(mix, hit(0.6, 1.2), at, 0.8)
    place(mix, riser(0.9), 8.1, 0.7)
    place(mix, hit(1.0, 2.2), 9.0, 1.0)
    # the payoff closes the vise over 2.6s: cranks along the way
    for i, at in enumerate((9.5, 10.3, 11.2)):
        place(mix, crank(0.9 + i * 0.1), at, 0.9)
    place(mix, hit(0.5, 1.8), 12.4, 0.6)
    write("vertical.wav", master(stereo(mix)))


if __name__ == "__main__":
    teaser()
    explainer()
    vertical()
