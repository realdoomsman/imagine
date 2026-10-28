"""
Voice-over for the IMAGINE launch film, line by line, with free neural TTS
(Microsoft Edge voices via `edge-tts`). Each line is rendered separately so
the edit controls every pause; the film's timeline places them.

Text is respelled where the voice would misread it ("meme coin",
"imagine dot fun"); the script itself is video/out/x/film/vo-script.md.

Output: video/public/vo-<id>.wav (48 kHz mono, git-ignored like the scores),
which audio/score.py places on the film's timeline.

    python video/audio/vo.py
"""

from __future__ import annotations

import asyncio
import pathlib
import subprocess

import edge_tts

VOICE = "en-US-AndrewMultilingualNeural"
RATE = "-4%"
PITCH = "-2Hz"
OUT = pathlib.Path(__file__).resolve().parent.parent / "public"

# (id, spoken text[, rate]). Ids match the cues in src/Launch.tsx.
LINES: list[tuple[str, ...]] = [
    ("l01", "Every meme coin pays a fee on every trade."),
    ("l02", "Almost none of it reaches the people holding it."),
    ("l03", "So the only way a holder gets paid... is to sell."),
    ("l04", "Imagine everyone locks."),
    ("l05", "Imagine coins launch on Raydium."),
    ("l06", "Paired with Sol, USDC, or tokenized stocks like NVDAx and SPYx."),
    ("l07", "Every trade, wherever it's made, pays half a percent to the coin's pool. On-chain."),
    ("l08", "Trade on imagine dot fun, and it's two percent."),
    ("l09", "Ninety percent streams to the holders who lock."),
    ("l10", "Paid in whatever the coin is paired with."),
    ("l11", "Lock the meme. Earn its pair."),
    ("l12", "Lock for four hours, or for a year."),
    ("l13", "A year counts four times as much. Commit longer, earn a bigger cut."),
    ("l14", "You can always leave."),
    ("l15", "Selling is free. It just costs you the stream."),
    ("l16", "The creator earns nothing from fees. They lock first, like everyone else."),
    ("l17", "No admin withdraw path."),
    ("l18", "Terms frozen for every pool."),
    ("l19", "Claims can't be paused."),
    ("l20", "Live on Solana mainnet. Open source. Tested against Raydium's real programs."),
    ("l21", "Imagine the chart if nobody sold."),
    ("l22", "imagine dot fun.", "-16%"),
]


async def render(line_id: str, text: str, rate: str = RATE) -> float:
    mp3 = OUT / f"vo-{line_id}.mp3"
    wav = OUT / f"vo-{line_id}.wav"
    await edge_tts.Communicate(text, VOICE, rate=rate, pitch=PITCH).save(str(mp3))
    # Trim the voice's leading/trailing silence so placement is exact.
    trim = (
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,"
        "areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.12,areverse"
    )
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-af", trim, "-ar", "48000", "-ac", "1", str(wav)], check=True)
    mp3.unlink()
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(probe.stdout.strip())


async def main() -> None:
    for line_id, text, *rate in LINES:
        print(f"{line_id} {await render(line_id, text, *rate):5.2f}s  {text}")


if __name__ == "__main__":
    asyncio.run(main())
