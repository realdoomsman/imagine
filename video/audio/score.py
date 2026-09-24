"""
Score and sound design for the VISE videos, synthesised from scratch.

Nothing here is sampled or licensed; every sound is oscillators, noise and
envelopes, so the output is ours outright and every render is bit-identical.

The music is a real arrangement rather than a bed: D minor at 96 BPM, an
i–VI–III–VII progression, a sub bass on eighths, saw pads under a moving
filter, a plucked sixteenth-note arpeggio with delay, and a drum kit (kick,
clap, hats) with the whole mix ducking under the kick. Sections are cut to
the films' beats: drums enter where the mechanism appears, drop out for the
guarantees, and return for the close. On top sit the sound effects: ratchet
cranks where the vise steps, risers into cuts, sub impacts on them.

Output: 48 kHz stereo WAV into video/public, one per composition.

    python video/audio/score.py
"""

from __future__ import annotations

import math
import pathlib
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 48_000
BPM = 96.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
OUT = pathlib.Path(__file__).resolve().parent.parent / "public"
rng = np.random.default_rng(7)

# --- primitives -------------------------------------------------------------


def n(seconds: float) -> int:
    return int(round(seconds * SR))


def t_axis(length: int) -> np.ndarray:
    return np.arange(length) / SR


def note_hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    b, a = butter(order, min(cutoff, SR / 2 - 100) / (SR / 2), btype="low")
    return lfilter(b, a, x)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    b, a = butter(order, max(cutoff, 10) / (SR / 2), btype="high")
    return lfilter(b, a, x)


def bandpass(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    b, a = butter(2, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], btype="band")
    return lfilter(b, a, x)


def sweep_lowpass(x: np.ndarray, cutoff: np.ndarray, blocks: int = 64) -> np.ndarray:
    """Lowpass whose cutoff moves: filter in blocks, crossfaded, so a pad opens up."""
    out = np.zeros_like(x)
    edges = np.linspace(0, len(x), blocks + 1).astype(int)
    for i in range(blocks):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            continue
        c = float(np.mean(cutoff[a:b]))
        seg = x[max(0, a - 2000) : b]
        out[a:b] = lowpass(seg, c)[a - max(0, a - 2000) :]
    return out


def adsr(length: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    A, D, R = n(a), n(d), n(r)
    env = np.ones(length) * s
    if A:
        env[:A] = np.linspace(0, 1, min(A, length))
    if D and A < length:
        seg = np.linspace(1, s, D)
        env[A : A + D] = seg[: max(0, length - A)]
    if R and R < length:
        env[length - R :] *= np.linspace(1, 0, R)
    return env


def saw(freq: float, length: int, detune_cents: float = 0.0) -> np.ndarray:
    f = freq * 2 ** (detune_cents / 1200)
    return 2 * ((t_axis(length) * f) % 1) - 1


def sine(freq: float, length: int) -> np.ndarray:
    return np.sin(2 * np.pi * freq * t_axis(length))


def reverb(x: np.ndarray, seconds: float = 1.8, mix: float = 0.25, tone: float = 4000) -> np.ndarray:
    """Convolution with a shaped noise tail: a plain, roomy reverb."""
    L = n(seconds)
    ir = rng.standard_normal(L) * np.exp(-t_axis(L) / (seconds / 3.5))
    ir = lowpass(ir, tone)
    ir /= np.max(np.abs(ir)) * 6
    wet = fftconvolve(x, ir)[: len(x)]
    return x + mix * wet


def delay(x: np.ndarray, seconds: float, feedback: float = 0.35, mix: float = 0.3) -> np.ndarray:
    d = n(seconds)
    out = x.copy()
    buf = x.copy()
    for _ in range(4):
        shifted = np.zeros_like(buf)
        shifted[d:] = buf[:-d] * feedback
        out += shifted * mix / feedback
        buf = shifted
    return out


def place(mix: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0) -> None:
    start = n(at)
    if start >= len(mix):
        return
    end = min(len(mix), start + len(sound))
    mix[start:end] += sound[: end - start] * gain


# --- instruments ------------------------------------------------------------

# D minor: i–VI–III–VII, one chord per bar, voiced low-mid.
PROGRESSION = [
    ("Dm", [50, 57, 62, 65]),  # D3 A3 D4 F4
    ("Bb", [46, 53, 58, 62]),  # Bb2 F3 Bb3 D4
    ("F", [53, 60, 65, 69]),  # F3 C4 F4 A4
    ("C", [48, 55, 60, 64]),  # C3 G3 C4 E4
]
ROOTS = [38, 34, 41, 36]  # D2 Bb1 F2 C2


def kick() -> np.ndarray:
    L = n(0.45)
    t = t_axis(L)
    pitch = 42 + 110 * np.exp(-t / 0.045)
    body = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-t / 0.16)
    click = lowpass(rng.standard_normal(L), 4000) * np.exp(-t / 0.006) * 0.6
    return np.tanh((body + click) * 1.6) * 0.95


def clap() -> np.ndarray:
    L = n(0.32)
    t = t_axis(L)
    noise = bandpass(rng.standard_normal(L), 900, 5000)
    env = np.zeros(L)
    for k, at in enumerate((0.0, 0.011, 0.022, 0.034)):
        s = n(at)
        env[s:] = np.maximum(env[s:], np.exp(-(t[: L - s]) / (0.02 if k < 3 else 0.11)))
    return noise * env * 0.6


def hat(open_: bool = False) -> np.ndarray:
    L = n(0.22 if open_ else 0.06)
    t = t_axis(L)
    noise = highpass(rng.standard_normal(L), 7000)
    return noise * np.exp(-t / (0.09 if open_ else 0.018)) * (0.32 if open_ else 0.26)


def bass_note(midi: int, length: int) -> np.ndarray:
    f = note_hz(midi)
    x = np.sin(2 * np.pi * f * t_axis(length)) + 0.35 * saw(f, length)
    x = lowpass(x, 240)
    return x * adsr(length, 0.004, 0.08, 0.7, 0.05)


def pad_chord(midis: list[int], length: int) -> np.ndarray:
    x = np.zeros(length)
    for m in midis:
        f = note_hz(m)
        x += saw(f, length, -7) + saw(f, length, 7) + 0.5 * saw(f * 2, length, 3)
    x /= len(midis) * 2.5
    return x * adsr(length, 0.6, 0.0, 1.0, 0.8)


def pluck(midi: int, length: int) -> np.ndarray:
    f = note_hz(midi)
    x = saw(f, length) + 0.4 * saw(f, length, 9)
    x = lowpass(x, 2600)
    return x * adsr(length, 0.002, 0.16, 0.0, 0.02) * 0.5


# --- arrangement -------------------------------------------------------------


class Arrangement:
    """One film's music, built section by section on a shared clock."""

    def __init__(self, seconds: float) -> None:
        self.len = n(seconds)
        self.seconds = seconds
        self.bass = np.zeros(self.len)
        self.pads = np.zeros(self.len)
        self.arp = np.zeros(self.len)
        self.drums = np.zeros(self.len)
        self.fx = np.zeros(self.len)
        self.kicks: list[float] = []

    def chord_at(self, bar: int) -> tuple[list[int], int]:
        return PROGRESSION[bar % 4][1], ROOTS[bar % 4]

    def pads_bars(self, start_bar: int, end_bar: int, gain: float = 1.0) -> None:
        for bar in range(start_bar, end_bar):
            midis, _ = self.chord_at(bar)
            place(self.pads, pad_chord(midis, n(BAR * 1.05)), bar * BAR, gain)

    def bass_bars(self, start_bar: int, end_bar: int, eighths: bool = True) -> None:
        for bar in range(start_bar, end_bar):
            _, root = self.chord_at(bar)
            if eighths:
                for k in range(8):
                    # a lift on the last eighth of each bar keeps it moving
                    m = root + (12 if k == 7 else 0)
                    place(self.bass, bass_note(m, n(BEAT / 2 * 0.9)), bar * BAR + k * BEAT / 2, 0.9)
            else:
                place(self.bass, bass_note(root, n(BAR * 0.95)), bar * BAR, 0.8)

    def arp_bars(self, start_bar: int, end_bar: int, gain: float = 1.0) -> None:
        pattern = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 0]
        for bar in range(start_bar, end_bar):
            midis, _ = self.chord_at(bar)
            for k in range(16):
                m = midis[pattern[k]] + 12
                accent = 1.0 if k % 4 == 0 else 0.7
                place(self.arp, pluck(m, n(BEAT / 4 * 1.6)), bar * BAR + k * BEAT / 4, gain * accent)

    def drums_bars(self, start_bar: int, end_bar: int, full: bool = True) -> None:
        for bar in range(start_bar, end_bar):
            for beat in range(4):
                at = bar * BAR + beat * BEAT
                place(self.drums, kick(), at, 1.0)
                self.kicks.append(at)
                if full and beat in (1, 3):
                    place(self.drums, clap(), at, 0.8)
            for k in range(8):
                place(self.drums, hat(open_=(full and k == 7)), bar * BAR + k * BEAT / 2, 0.8 if k % 2 == 0 else 0.55)
            if full:
                for k in range(16):
                    if k % 2 == 1:
                        place(self.drums, hat(), bar * BAR + k * BEAT / 4, 0.28)

    def sidechain(self) -> np.ndarray:
        env = np.ones(self.len)
        duck = np.concatenate([np.linspace(0.25, 1.0, n(0.22)) ** 1.6])
        for at in self.kicks:
            s = n(at)
            e = min(self.len, s + len(duck))
            env[s:e] = np.minimum(env[s:e], duck[: e - s])
        return env

    def mix(self, pad_cutoff: np.ndarray, gains: dict[str, float]) -> np.ndarray:
        sc = self.sidechain()
        pads = sweep_lowpass(self.pads, pad_cutoff)
        pads = reverb(pads, 2.4, 0.35, 3200) * sc
        bass = self.bass * np.maximum(sc, 0.35)
        arp = delay(reverb(self.arp, 1.2, 0.2, 5000), BEAT * 0.75, 0.32, 0.28) * sc
        drums = reverb(self.drums, 0.5, 0.08, 6000)
        return (
            pads * gains["pads"] + bass * gains["bass"] + arp * gains["arp"] + drums * gains["drums"] + self.fx * gains["fx"]
        )


# --- sound design ------------------------------------------------------------


def crank(strength: float = 1.0) -> np.ndarray:
    L = n(0.55)
    t = t_axis(L)
    out = np.zeros(L)
    for f, g, dec in ((1_320, 0.5, 0.08), (2_190, 0.3, 0.06), (3_470, 0.2, 0.05), (612, 0.35, 0.16)):
        out += g * np.sin(2 * np.pi * f * t) * np.exp(-t / dec)
    pos, gap = 0.0, 0.026
    for i in range(8):
        s = n(pos)
        c = highpass(lowpass(rng.standard_normal(n(0.04)), 6000), 1800) * np.exp(-t_axis(n(0.04)) / 0.012)
        e = min(L, s + len(c))
        out[s:e] += c[: e - s] * (1.0 - i * 0.07)
        pos += gap
        gap *= 1.09
    out += 0.7 * np.sin(2 * np.pi * 58 * t) * np.exp(-t / 0.12)
    return out * strength * 0.8


def impact(strength: float = 1.0, tail: float = 1.6) -> np.ndarray:
    L = n(tail)
    t = t_axis(L)
    pitch = 46 * np.exp(-t / 0.09) + 41
    sub = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-t / 0.55)
    click = lowpass(rng.standard_normal(L), 3000) * np.exp(-t / 0.02)
    air = lowpass(rng.standard_normal(L), 900) * np.exp(-t / 0.3) * 0.25
    return (sub + click * 0.4 + air) * strength


def riser(seconds: float) -> np.ndarray:
    L = n(seconds)
    t = t_axis(L)
    x = rng.standard_normal(L)
    cutoff = 200 + 5_000 * (t / seconds) ** 2.4
    return sweep_lowpass(x, cutoff, 24) * (t / seconds) ** 2 * 0.5


def tick() -> np.ndarray:
    L = n(0.04)
    return highpass(lowpass(rng.standard_normal(L), 6000), 1800) * np.exp(-t_axis(L) / 0.012) * 0.9


# --- master ------------------------------------------------------------------


def stereo(mono: np.ndarray, width: float = 0.16) -> np.ndarray:
    d = n(0.009)
    left, right = mono.copy(), mono.copy()
    left[d:] += width * mono[:-d]
    right[:-d] += width * mono[d:]
    return np.stack([left, right], axis=1)


def master(x: np.ndarray, peak: float = 0.92) -> np.ndarray:
    x = highpass(x.T, 28).T if x.ndim == 2 else highpass(x, 28)
    driven = np.tanh(x * 0.9) / math.tanh(0.9)
    return driven / max(1e-9, float(np.max(np.abs(driven)))) * peak


def write(name: str, samples: np.ndarray) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(OUT / name), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(f"wrote {name}: {len(samples) / SR:.1f}s")


def fade(x: np.ndarray, out_seconds: float) -> np.ndarray:
    L = n(out_seconds)
    x[-L:] *= np.linspace(1, 0, L)[:, None] if x.ndim == 2 else np.linspace(1, 0, L)
    return x


# --- films -------------------------------------------------------------------


def promo() -> None:
    """60s, 24 bars. Sections in bars: hook 0–2, problem 2–5, mechanism 5–8,
    ladder 8–12, product 12–16, guarantees 16–20, close 20–24."""
    a = Arrangement(60.5)
    a.pads_bars(0, 24)
    a.bass_bars(0, 2, eighths=False)
    a.bass_bars(2, 16)
    a.bass_bars(16, 20, eighths=False)
    a.bass_bars(20, 24)
    a.arp_bars(2, 5, 0.55)
    a.arp_bars(5, 16, 0.85)
    a.arp_bars(16, 20, 0.45)
    a.arp_bars(20, 24, 0.85)
    a.drums_bars(5, 8, full=False)
    a.drums_bars(8, 16, full=True)
    a.drums_bars(20, 23, full=True)
    # the pad filter opens with the film and closes for the guarantees
    cutoff = np.interp(
        t_axis(a.len),
        [0, 5, 12.5, 20, 30, 40, 42, 50, 52, 60],
        [260, 420, 900, 1600, 2200, 2200, 700, 700, 2400, 900],
    )
    # sound design on the cut points
    for i, at in enumerate((1.6, 2.9, 4.2)):
        place(a.fx, crank(1.0 + i * 0.1), at, 0.9)
    for at in (12.5, 20.0, 30.0, 40.0):
        place(a.fx, riser(1.1), at - 1.1, 0.55)
        place(a.fx, impact(0.8, 1.4), at, 0.9)
    place(a.fx, riser(1.6), 48.4, 0.7)
    place(a.fx, impact(1.0, 2.4), 50.0, 1.0)
    place(a.fx, crank(1.1), 50.35, 0.9)
    for k in range(5):
        place(a.fx, tick(), 20.6 + k * 0.45, 0.8)
    place(a.fx, impact(1.0, 3.0), 57.5, 1.0)
    mixed = a.mix(cutoff, {"pads": 0.3, "bass": 0.75, "arp": 0.55, "drums": 1.05, "fx": 1.0})
    write("promo.wav", fade(master(stereo(mixed)), 1.2))


def teaser() -> None:
    """12s. 0–3 title, 3–8 clamp with three cranks, 8–12 logo."""
    a = Arrangement(12.2)
    a.pads_bars(0, 5)
    a.bass_bars(0, 5, eighths=False)
    a.arp_bars(1, 4, 0.5)
    a.drums_bars(3, 5, full=False)
    cutoff = np.interp(t_axis(a.len), [0, 3, 8, 12], [300, 700, 2200, 1200])
    for i, at in enumerate((3.83, 5.5, 7.17)):
        place(a.fx, crank(1.0 + i * 0.12), at, 0.95)
    place(a.fx, riser(1.0), 7.0, 0.7)
    place(a.fx, impact(1.0, 2.2), 8.0, 1.0)
    place(a.fx, impact(0.45, 1.6), 9.4, 0.6)
    mixed = a.mix(cutoff, {"pads": 0.32, "bass": 0.7, "arp": 0.5, "drums": 0.9, "fx": 1.0})
    write("teaser.wav", fade(master(stereo(mixed)), 0.8))


def explainer() -> None:
    """30s. Beats at 0, 6, 13, 21; closing from 21."""
    a = Arrangement(30.2)
    a.pads_bars(0, 12)
    a.bass_bars(0, 12)
    a.arp_bars(2, 12, 0.7)
    a.drums_bars(5, 12, full=True)
    cutoff = np.interp(t_axis(a.len), [0, 6, 13, 21, 30], [350, 800, 1600, 2200, 1200])
    for at in (6.0, 13.0):
        place(a.fx, riser(0.8), at - 0.8, 0.5)
        place(a.fx, impact(0.75, 1.4), at, 0.8)
    for i in range(5):
        place(a.fx, tick(), 13.2 + i * 0.45, 0.9)
    place(a.fx, riser(1.2), 19.8, 0.75)
    place(a.fx, impact(1.0, 2.4), 21.0, 1.0)
    place(a.fx, crank(0.9), 22.6, 0.8)
    place(a.fx, impact(0.4, 2.0), 26.0, 0.5)
    mixed = a.mix(cutoff, {"pads": 0.3, "bass": 0.75, "arp": 0.55, "drums": 1.0, "fx": 1.0})
    write("explainer.wav", fade(master(stereo(mixed)), 1.0))


def vertical() -> None:
    """15s. Lines at 0, 3.2, 6.4; payoff 9–15."""
    a = Arrangement(15.2)
    a.pads_bars(0, 6)
    a.bass_bars(0, 6)
    a.arp_bars(1, 6, 0.6)
    a.drums_bars(2, 6, full=True)
    cutoff = np.interp(t_axis(a.len), [0, 3.2, 6.4, 9, 15], [400, 900, 1600, 2200, 1200])
    for at in (3.2, 6.4):
        place(a.fx, impact(0.6, 1.2), at, 0.8)
    place(a.fx, riser(0.9), 8.1, 0.7)
    place(a.fx, impact(1.0, 2.2), 9.0, 1.0)
    for i, at in enumerate((9.5, 10.3, 11.2)):
        place(a.fx, crank(0.9 + i * 0.1), at, 0.9)
    place(a.fx, impact(0.5, 1.8), 12.4, 0.6)
    mixed = a.mix(cutoff, {"pads": 0.3, "bass": 0.75, "arp": 0.55, "drums": 1.0, "fx": 1.0})
    write("vertical.wav", fade(master(stereo(mixed)), 0.8))


if __name__ == "__main__":
    promo()
    teaser()
    explainer()
    vertical()
