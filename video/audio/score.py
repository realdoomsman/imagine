"""
Score and sound design for the IMAGINE films, synthesised from scratch.

Nothing here is sampled or licensed; every sound is oscillators, noise and
envelopes, so the output is ours outright and every render is bit-identical.

D major at 96 BPM, a I–V–vi–IV progression with added sevenths for a dreamy
lift, a sub bass on eighths, saw pads under a moving filter, a plucked
arpeggio with delay, and a soft drum kit with the mix ducking under the kick.
Sections are cut to the films' bars (2.5 s): a heartbeat under the sell-off,
the pads opening when nobody sells, drums when the stream starts, and the
motif over the mark. Effects: soft latch clicks where a lock commits, risers
into cuts, sub impacts on them.

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

# D major: I–V–vi–IV, one chord per bar, voiced low-mid with colour tones.
PROGRESSION = [
    ("Dmaj7", [50, 57, 61, 66]),  # D3 A3 C#4 F#4
    ("A", [45, 52, 57, 64]),  # A2 E3 A3 E4
    ("Bm7", [47, 54, 57, 62]),  # B2 F#3 A3 D4
    ("Gmaj7", [43, 50, 54, 59]),  # G2 D3 F#3 B3
]
ROOTS = [38, 33, 35, 31]  # D2 A1 B1 G1


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
    x = lowpass(x, 1700)
    return x * adsr(length, 0.003, 0.22, 0.0, 0.03) * 0.5


def lead(midi: int, length: int) -> np.ndarray:
    """A soft, slow-attack voice for the motif: rounded, a little vibrato, far back."""
    f = note_hz(midi)
    t = t_axis(length)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(t / 0.6, 1)
    phase = 2 * np.pi * np.cumsum(f * vib) / SR
    x = np.sin(phase) + 0.28 * np.sin(2 * phase) + 0.1 * np.sin(3 * phase)
    x = lowpass(x, 2400)
    return x * adsr(length, 0.09, 0.2, 0.8, 0.35) * 0.4


# The motif: eight notes over two bars, D major, rising to the fifth and settling home.
MOTIF = [(74, 1.0), (76, 1.0), (78, 1.5), (81, 0.5), (78, 1.0), (76, 1.0), (73, 1.0), (74, 1.0)]


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
        """Eighth notes with rests: motion without a buzz."""
        pattern = [0, 2, 1, None, 3, None, 2, 1]
        for bar in range(start_bar, end_bar):
            midis, _ = self.chord_at(bar)
            for k, idx in enumerate(pattern):
                if idx is None:
                    continue
                m = midis[idx] + 12
                accent = 1.0 if k == 0 else 0.7
                place(self.arp, pluck(m, n(BEAT / 2 * 1.5)), bar * BAR + k * BEAT / 2, gain * accent)

    def motif_bars(self, start_bar: int, gain: float = 1.0) -> None:
        at = start_bar * BAR
        for midi, beats in MOTIF:
            place(self.arp, lead(midi, n(beats * BEAT * 1.15)), at, gain)
            at += beats * BEAT

    def pulse_bars(self, start_bar: int, end_bar: int) -> None:
        """A kick on one and three only: a heartbeat, not a groove."""
        for bar in range(start_bar, end_bar):
            for beat in (0, 2):
                at = bar * BAR + beat * BEAT
                place(self.drums, kick(), at, 0.75)
                self.kicks.append(at)

    def drums_bars(self, start_bar: int, end_bar: int, full: bool = True) -> None:
        for bar in range(start_bar, end_bar):
            for beat in range(4):
                at = bar * BAR + beat * BEAT
                place(self.drums, kick(), at, 0.95)
                self.kicks.append(at)
                # half-time clap: one backbeat per bar keeps it unhurried
                if full and beat == 2:
                    place(self.drums, clap(), at, 0.55)
            for k in range(8):
                place(self.drums, hat(open_=(full and k == 7)), bar * BAR + k * BEAT / 2, 0.55 if k % 2 == 0 else 0.32)

    def sidechain(self) -> np.ndarray:
        env = np.ones(self.len)
        duck = np.concatenate([np.linspace(0.25, 1.0, n(0.22)) ** 1.6])
        for at in self.kicks:
            s = n(at)
            e = min(self.len, s + len(duck))
            env[s:e] = np.minimum(env[s:e], duck[: e - s])
        return env

    def mix(self, pad_cutoff: np.ndarray, gains: dict[str, float], intensity: np.ndarray | None = None) -> np.ndarray:
        """`intensity` is a per-sample gain over the music (not the effects):
        the arrangement's dynamics, so a quiet passage is actually quiet."""
        sc = self.sidechain()
        duck = 0.55 + 0.45 * sc  # a gentle breath, not a gasp
        pads = sweep_lowpass(self.pads, pad_cutoff)
        pads = reverb(pads, 2.4, 0.3, 2600) * duck
        bass = self.bass * np.maximum(sc, 0.5)
        arp = delay(reverb(self.arp, 1.4, 0.25, 4000), BEAT * 0.75, 0.3, 0.26) * duck
        drums = reverb(self.drums, 0.5, 0.08, 6000)
        music = pads * gains["pads"] + bass * gains["bass"] + arp * gains["arp"] + drums * gains["drums"]
        if intensity is not None:
            music = music * intensity
        return music + self.fx * gains["fx"]


# --- sound design ------------------------------------------------------------


def latch(strength: float = 1.0) -> np.ndarray:
    """A lock committing: a short ratcheting tick train over a soft low thump."""
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


# --- master ------------------------------------------------------------------


def stereo(mono: np.ndarray, width: float = 0.16) -> np.ndarray:
    d = n(0.009)
    left, right = mono.copy(), mono.copy()
    left[d:] += width * mono[:-d]
    right[:-d] += width * mono[d:]
    return np.stack([left, right], axis=1)


def master(x: np.ndarray, peak: float = 0.8) -> np.ndarray:
    x = highpass(x.T, 28).T if x.ndim == 2 else highpass(x, 28)
    driven = np.tanh(x * 0.6) / math.tanh(0.6)
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
    """58 s. Sections in bars (2.5 s): the sell-off 0–3, nobody sold 3–5,
    the dial 5–9, the fee path 9–12, lockers 12–14, StonkFun pairs 14–17,
    the rules 17–20, the mark 20–23.

    A heartbeat under the sell-off, the pads opening when nobody sells, a
    light groove under the dial, the full kit for the stream, only pads under
    the rules, and the motif three times."""
    a = Arrangement(58.0)
    a.pads_bars(0, 24)
    a.bass_bars(0, 5, eighths=False)
    a.bass_bars(5, 17)
    a.bass_bars(17, 20, eighths=False)
    a.bass_bars(20, 24)
    a.pulse_bars(1, 3)
    a.drums_bars(5, 9, full=False)
    a.drums_bars(9, 17, full=True)
    a.drums_bars(20, 22, full=True)
    a.arp_bars(9, 17, 0.35)
    a.motif_bars(3, 0.6)
    a.motif_bars(12, 0.6)
    a.motif_bars(20, 0.75)
    cutoff = np.interp(
        t_axis(a.len),
        [0, 6, 7.5, 12.5, 22.5, 35, 42.5, 50, 52, 58],
        [260, 240, 700, 1100, 1500, 1700, 600, 600, 1800, 800],
    )
    for i, at in enumerate((14.5, 16.0, 17.5, 19.0)):
        place(a.fx, latch(0.8 + i * 0.08), at, 0.7)
    for at in (7.5, 12.5, 22.5, 30.0, 35.0, 42.5):
        place(a.fx, riser(1.1), at - 1.1, 0.4)
        place(a.fx, impact(0.7, 1.4), at, 0.75)
    place(a.fx, riser(1.6), 48.4, 0.55)
    place(a.fx, impact(1.0, 2.4), 50.0, 1.0)
    place(a.fx, latch(1.0), 50.9, 0.8)
    place(a.fx, impact(0.6, 2.4), 51.5, 0.7)
    intensity = np.interp(
        t_axis(a.len),
        [0, 7.5, 12.5, 22.5, 35, 42.5, 43, 49.5, 50, 55, 58],
        [0.55, 0.6, 0.8, 1.0, 0.95, 0.9, 0.55, 0.55, 1.0, 0.9, 0.6],
    )
    mixed = a.mix(cutoff, {"pads": 0.36, "bass": 0.6, "arp": 0.45, "drums": 0.6, "fx": 0.9}, intensity)
    write("promo.wav", fade(master(stereo(mixed)), 1.5))


def teaser() -> None:
    """15 s. The sell-off 0–5, nobody sold 5–10, the mark 10–15."""
    a = Arrangement(15.0)
    a.pads_bars(0, 6)
    a.bass_bars(0, 2, eighths=False)
    a.bass_bars(2, 6)
    a.pulse_bars(0, 2)
    a.drums_bars(4, 6, full=False)
    a.motif_bars(2, 0.6)
    cutoff = np.interp(t_axis(a.len), [0, 5, 10, 15], [280, 900, 2000, 1100])
    place(a.fx, riser(1.0), 4.0, 0.5)
    place(a.fx, impact(0.7, 1.6), 5.0, 0.8)
    place(a.fx, riser(1.0), 9.0, 0.7)
    place(a.fx, impact(1.0, 2.2), 10.0, 1.0)
    place(a.fx, latch(1.0), 10.9, 0.8)
    place(a.fx, impact(0.5, 1.8), 11.5, 0.6)
    mixed = a.mix(cutoff, {"pads": 0.42, "bass": 0.6, "arp": 0.45, "drums": 0.6, "fx": 0.9})
    write("teaser.wav", fade(master(stereo(mixed)), 1.0))


def explainer() -> None:
    """30 s. Steps at 2.5, 7.5, 12.5, 17.5; the mark from 22.5."""
    a = Arrangement(30.0)
    a.pads_bars(0, 12)
    a.bass_bars(0, 3, eighths=False)
    a.bass_bars(3, 12)
    a.pulse_bars(1, 3)
    a.drums_bars(3, 5, full=False)
    a.drums_bars(5, 9, full=True)
    a.arp_bars(3, 9, 0.35)
    a.motif_bars(1, 0.55)
    a.motif_bars(9, 0.7)
    cutoff = np.interp(t_axis(a.len), [0, 7.5, 12.5, 17.5, 22.5, 30], [350, 800, 1300, 1800, 2000, 1100])
    for at in (2.5, 7.5, 12.5, 17.5):
        place(a.fx, riser(0.8), at - 0.8, 0.4)
        place(a.fx, impact(0.6, 1.4), at, 0.7)
    place(a.fx, riser(1.2), 21.3, 0.7)
    place(a.fx, impact(1.0, 2.4), 22.5, 1.0)
    place(a.fx, latch(0.9), 23.4, 0.8)
    place(a.fx, impact(0.5, 2.0), 24.0, 0.6)
    mixed = a.mix(cutoff, {"pads": 0.42, "bass": 0.6, "arp": 0.45, "drums": 0.6, "fx": 0.9})
    write("explainer.wav", fade(master(stereo(mixed)), 1.0))


def vertical() -> None:
    """15 s. Sell-off 0–3.8, nobody sold 3.8–7.5, the dial 7.5–11.25, the mark 11.25–15."""
    a = Arrangement(15.0)
    a.pads_bars(0, 6)
    a.bass_bars(0, 2, eighths=False)
    a.bass_bars(2, 6)
    a.pulse_bars(0, 2)
    a.drums_bars(3, 5, full=True)
    a.arp_bars(3, 5, 0.35)
    a.motif_bars(3, 0.65)
    cutoff = np.interp(t_axis(a.len), [0, 3.8, 7.5, 11.25, 15], [300, 900, 1600, 2100, 1100])
    place(a.fx, impact(0.6, 1.2), 3.8, 0.7)
    place(a.fx, riser(0.9), 6.6, 0.5)
    place(a.fx, impact(0.7, 1.4), 7.5, 0.8)
    for i, at in enumerate((8.3, 9.0, 9.7)):
        place(a.fx, latch(0.8 + i * 0.1), at, 0.7)
    place(a.fx, riser(0.9), 10.35, 0.6)
    place(a.fx, impact(1.0, 2.2), 11.25, 1.0)
    place(a.fx, latch(1.0), 12.15, 0.8)
    mixed = a.mix(cutoff, {"pads": 0.42, "bass": 0.6, "arp": 0.45, "drums": 0.6, "fx": 0.9})
    write("vertical.wav", fade(master(stereo(mixed)), 0.8))


if __name__ == "__main__":
    promo()
    teaser()
    explainer()
    vertical()
