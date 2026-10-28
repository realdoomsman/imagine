"""
Soundtrack for the X launch film (src/x-film): score, sound design and the
voice-over, mixed to one master.

The cut lives in src/x-film/timeline.json: scene windows, voice cues and the
sound-design hits. The music reuses score.py's synths (D major, 96 BPM) on a
grid that starts 0.6 s in, so the title lands on a downbeat at 10.6 s. The voice
(audio/vo.py renders vo-<id>.wav) gets a light chain: high-pass, presence,
gentle compression and a short room. Music ducks about 8 dB under each line;
effects duck less. The master is gained to -14 LUFS and limited at -1.5 dBFS.

    python video/audio/vo.py      # once, needs network (Microsoft Edge TTS)
    python video/audio/launch.py  # -> video/public/launch.wav
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import wave

import numpy as np

from score import (
    OUT,
    SR,
    Arrangement,
    bandpass,
    highpass,
    impact,
    latch,
    lowpass,
    n,
    place,
    reverb,
    riser,
    rng,
    stereo,
    sweep_lowpass,
    t_axis,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
TIMELINE = json.loads((ROOT / "src" / "x-film" / "timeline.json").read_text(encoding="utf-8"))
ORIGIN = 0.6  # the music's bar 0, in film seconds
DUCK_DB = -8.0
MUSIC_GAIN = 0.75  # the bed sits ~8 dB under the voice once ducked

# --- sound design -------------------------------------------------------------


def whoosh(seconds: float = 0.55) -> np.ndarray:
    """Air past the camera: band-passed noise whose centre sweeps up and back."""
    L = n(seconds)
    t = t_axis(L) / seconds
    x = rng.standard_normal(L)
    centre = 400 + 3_200 * np.sin(np.pi * t) ** 2
    out = sweep_lowpass(x, centre, 32) - sweep_lowpass(x, centre * 0.35, 32)
    return out * np.sin(np.pi * t) ** 1.5 * 0.9


def click() -> np.ndarray:
    """A UI click: a tight tick and a short high blip."""
    L = n(0.06)
    t = t_axis(L)
    tick = highpass(rng.standard_normal(L), 2_500) * np.exp(-t / 0.003)
    blip = np.sin(2 * np.pi * 3_100 * t) * np.exp(-t / 0.012) * 0.4
    return (tick * 0.6 + blip) * 0.7


def pop(pitch: float = 880.0) -> np.ndarray:
    """A soft bubble for things that appear: a short upward sine and a click."""
    L = n(0.18)
    t = t_axis(L)
    f = pitch * (1 + 0.5 * (1 - np.exp(-t / 0.03)))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.06)
    tap = click()
    body[: len(tap)] += tap * 0.3
    return body * 0.55


def tick() -> np.ndarray:
    """A wooden tick with a low thump: one rule, set in place."""
    L = n(0.3)
    t = t_axis(L)
    wood = (np.sin(2 * np.pi * 1_180 * t) + 0.5 * np.sin(2 * np.pi * 2_370 * t)) * np.exp(-t / 0.045)
    thump = np.sin(2 * np.pi * 70 * t) * np.exp(-t / 0.09)
    return (wood * 0.5 + thump * 0.8) * 0.8


def slam() -> np.ndarray:
    """The sell-off landing: a sub hit, a gritty burst and a falling zap."""
    L = n(1.6)
    t = t_axis(L)
    zap = np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t / 0.12) + 60) / SR) * np.exp(-t / 0.35) * 0.45
    grit = np.tanh(bandpass(rng.standard_normal(L), 200, 3_000) * 3) * np.exp(-t / 0.08) * 0.35
    return impact(1.0, 1.6) + zap + grit


def crack() -> np.ndarray:
    """A lock breaking: a bright splinter over a dull knock."""
    L = n(0.9)
    t = t_axis(L)
    splinter = bandpass(rng.standard_normal(L), 1_200, 7_000) * np.exp(-t / 0.05)
    for k in range(5):
        s = n(0.012 * k + 0.004 * k * k)
        burst = highpass(rng.standard_normal(n(0.03)), 2_000) * np.exp(-t_axis(n(0.03)) / 0.006)
        splinter[s : s + len(burst)] += burst[: max(0, min(len(burst), L - s))] * 0.6
    knock = np.sin(2 * np.pi * np.cumsum(180 * np.exp(-t / 0.05) + 55) / SR) * np.exp(-t / 0.2)
    return splinter * 0.5 + knock * 0.9


def swell(seconds: float = 3.0) -> np.ndarray:
    """The open: a low tone and air rising out of silence."""
    L = n(seconds)
    t = t_axis(L)
    env = (t / seconds) ** 1.6 * np.exp(-np.maximum(0, t - seconds * 0.85) / 0.2)
    tone = np.sin(2 * np.pi * 36.7 * t) + 0.4 * np.sin(2 * np.pi * 73.4 * t)
    air = lowpass(rng.standard_normal(L), 1_200) * 0.25
    return (tone * 0.6 + air) * env


SFX = {
    "swell": (lambda: swell(3.0), 0.0, 0.55),
    "slam": (slam, 0.0, 0.95),
    "impact": (lambda: impact(1.0, 2.4), 0.0, 0.9),
    "impact-soft": (lambda: impact(0.55, 1.4), 0.0, 0.6),
    "latch": (lambda: latch(0.9), 0.0, 0.6),
    "whoosh": (whoosh, -0.32, 0.42),
    "click": (click, 0.0, 0.32),
    "pop": (pop, 0.0, 0.3),
    "tick": (tick, 0.0, 0.42),
    "crack": (crack, 0.0, 0.7),
}

# --- voice ----------------------------------------------------------------------


def read_wav(path: pathlib.Path) -> np.ndarray:
    with wave.open(str(path)) as f:
        assert f.getframerate() == SR, path
        raw = np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").astype(np.float64) / 32768
        return raw.reshape(-1, f.getnchannels()).mean(axis=1)


def compress(x: np.ndarray, threshold_db: float = -22.0, ratio: float = 3.0) -> np.ndarray:
    """RMS compressor (10 ms window): evens the read without squashing it."""
    win = n(0.01)
    rms = np.sqrt(np.convolve(x**2, np.ones(win) / win, mode="same") + 1e-12)
    level = 20 * np.log10(rms)
    over = np.maximum(0.0, level - threshold_db)
    gain_db = -over * (1 - 1 / ratio)
    gain = 10 ** (lowpass(gain_db, 30) / 20)
    return x * gain


def voice_chain(x: np.ndarray) -> np.ndarray:
    x = highpass(x, 90)
    x = x + 0.22 * bandpass(x, 2_500, 5_500)  # presence
    x = x - 0.12 * bandpass(x, 250, 450)  # less box
    x = compress(x)
    return reverb(x, 0.45, 0.07, 5_000)


# --- music ----------------------------------------------------------------------


def music(seconds: float) -> np.ndarray:
    """Bars counted from ORIGIN (bar k = 0.6 + 2.5k s): the open 0–4, the
    title on bar 4, hero and pairs 5–10, fees through the curve 10–21 (the
    drums drop out on the lock breaking at 53 s), the exit breakdown 21–23,
    rules 23–25, proof 25–29, the end card and motif from 29."""
    a = Arrangement(seconds - ORIGIN)
    a.pads_bars(0, 32)
    a.bass_bars(0, 4, eighths=False)
    a.bass_bars(4, 20)
    a.bass_bars(20, 23, eighths=False)
    a.bass_bars(23, 29)
    a.bass_bars(29, 32, eighths=False)
    a.pulse_bars(1, 4)
    a.drums_bars(5, 10, full=False)
    a.drums_bars(10, 21, full=True)
    a.pulse_bars(23, 25)
    a.drums_bars(25, 29, full=True)
    a.arp_bars(10, 21, 0.32)
    a.arp_bars(25, 29, 0.3)
    a.motif_bars(4, 0.5)
    a.motif_bars(30, 0.65)
    local = t_axis(a.len) + ORIGIN
    cutoff = np.interp(local, [0, 8.5, 10.6, 13.8, 26.5, 52.0, 53.0, 56.8, 67.9, 74.3, 80], [240, 320, 900, 1_300, 1_600, 1_700, 520, 700, 1_400, 1_900, 900])
    intensity = np.interp(local, [0, 9.8, 10.6, 26.5, 52.6, 53.2, 56.8, 67.9, 74.3, 78, 80], [0.5, 0.62, 0.85, 1.0, 0.95, 0.55, 0.72, 0.9, 1.0, 0.85, 0.6])
    gains = {"pads": 0.36, "bass": 0.58, "arp": 0.45, "drums": 0.58, "fx": 0.0}
    body = a.mix(cutoff, gains, intensity)
    return np.concatenate([np.zeros(n(ORIGIN)), body])[: n(seconds)]


# --- mix -------------------------------------------------------------------------------


def ramp_mask(length: int, windows: list[tuple[float, float]], ramp: float = 0.12) -> np.ndarray:
    mask = np.zeros(length)
    for start, end in windows:
        mask[max(0, n(start)) : min(length, n(end))] = 1.0
    k = n(ramp)
    return np.clip(np.convolve(mask, np.ones(k) / k, mode="same"), 0, 1)


def loudnorm(src: pathlib.Path, dst: pathlib.Path, target: float = -14.0, ceiling_db: float = -1.5) -> None:
    """Static gain to `target` LUFS (EBU R128), then a brickwall limiter at
    `ceiling_db`: the mix keeps its dynamics instead of being re-levelled."""
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af", "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    stats = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe.stderr, re.S).group(0))
    gain = target - float(stats["input_i"])
    limit = 10 ** (ceiling_db / 20)
    chain = f"volume={gain:.2f}dB,alimiter=limit={limit:.4f}:attack=3:release=60:level=false"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", chain, "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)], check=True)


def write_pcm(path: pathlib.Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def write_srt(path: pathlib.Path, captions: list[tuple[float, float, str]]) -> None:
    """Captions for the upload (X takes an SRT per video): one cue per line."""

    def stamp(sec: float) -> str:
        ms = int(round(sec * 1000))
        return f"{ms // 3_600_000:02}:{ms // 60_000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

    blocks = []
    for i, (start, end, text) in enumerate(captions):
        if i + 1 < len(captions):
            end = min(end, captions[i + 1][0] - 0.05)
        blocks.append(f"{i + 1}\n{stamp(start)} --> {stamp(end)}\n{text}\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(blocks), encoding="utf-8")


def launch() -> None:
    seconds = float(TIMELINE["duration"])
    L = n(seconds)

    voice = np.zeros(L)
    windows = []
    captions = []
    for line in TIMELINE["vo"]:
        x = voice_chain(read_wav(OUT / f"vo-{line['id']}.wav"))
        x = x / (np.sqrt(np.mean(x[np.abs(x) > 0.02] ** 2)) + 1e-9) * 0.30  # every line at the same level
        place(voice, x, line["at"])
        windows.append((line["at"] - 0.12, line["at"] + len(x) / SR + 0.15))
        captions.append((line["at"], line["at"] + len(x) / SR + 0.4, line["text"]))
    speaking = ramp_mask(L, windows)

    fx = np.zeros(L)
    for hit in TIMELINE["sfx"]:
        make, offset, gain = SFX[hit["kind"]]
        place(fx, make(), max(0.0, hit["at"] + offset), gain)
    for at, length, gain in ((10.6, 1.4, 0.5), (74.3, 1.8, 0.55), (26.5, 0.9, 0.25), (52.1, 0.8, 0.2)):
        place(fx, riser(length), at - length, gain)

    duck = 10 ** (DUCK_DB / 20)
    bed = music(seconds) * MUSIC_GAIN * (1 - (1 - duck) * speaking)
    effects = fx * (1 - 0.35 * speaking)
    mixed = stereo(bed + effects, 0.18) + voice[:, None] * 0.98
    tail = n(1.6)
    mixed[-tail:] *= np.linspace(1, 0, tail)[:, None] ** 1.5
    mixed = highpass(mixed.T, 30).T
    mixed = mixed / np.max(np.abs(mixed)) * 0.7

    write_srt(ROOT / "out" / "x" / "film" / "imagine-launch.srt", captions)

    raw = OUT / "launch-premaster.wav"
    write_pcm(raw, mixed)
    loudnorm(raw, OUT / "launch.wav")
    raw.unlink()
    print(f"wrote launch.wav: {seconds:.1f}s")


if __name__ == "__main__":
    launch()
