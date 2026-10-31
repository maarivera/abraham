"""Study: turn a stem into sheet music. Notes come from Basic Pitch (Spotify, Apache-2.0) run with
ONNX Runtime, beats from a dynamic-programming tracker; everything is written out in 4/4 on a 16th-note grid."""

from itertools import product
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio

MODEL = Path(__file__).parent / "models" / "nmp.onnx"

RATE = 22050
HOP = 256
WINDOW = 2 * RATE - HOP  # samples the model takes at a time
OVERLAP = 30  # frames shared by neighbouring windows
FRAMES_PER_WINDOW = 172
FRAME_SECONDS = HOP / RATE - (HOP / RATE * (FRAMES_PER_WINDOW - WINDOW / HOP) + 0.0018) / FRAMES_PER_WINDOW
OUTPUTS = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2"]  # frames, onsets
LOWEST_MIDI = 21
ONSET_THRESHOLD = 0.5
FRAME_THRESHOLD = 0.3
MIN_NOTE_FRAMES = 5  # about 60 ms
ENERGY_TOLERANCE = 11

SLOTS_PER_BEAT = 4
BEATS_PER_BAR = 4
SLOTS_PER_BAR = SLOTS_PER_BEAT * BEATS_PER_BAR
# Slots a written note can last, longest first, with the slot it must start on a multiple of.
STRUM_NOTES = 3
LENGTHS = [(16, 16, "w", 0), (12, 4, "h", 1), (8, 4, "h", 0), (6, 2, "q", 1), (4, 2, "q", 0), (3, 1, "8", 1), (2, 1, "8", 0), (1, 1, "16", 0)]

TUNINGS = {
    "E": ("Standard E", (64, 59, 55, 50, 45, 40)),  # strings 1 (high) to 6 (low)
    "Eb": ("Eb tuning", (63, 58, 54, 49, 44, 39)),
    "D": ("D tuning", (62, 57, 53, 48, 43, 38)),
}
DEFAULT_TUNING = "E"
MAX_FRET = 22
MAX_REACH = 4  # frets the hand can span in one chord
MAX_SHAPES = 24  # fingerings kept per chord

SHARPS = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"]
FLATS = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"]
SIGNATURES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]  # major key on each pitch class
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db"}


def load_mono(path: Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    mono = torch.from_numpy(audio.mean(axis=1))
    return torchaudio.functional.resample(mono, rate, RATE).numpy()


def model_output(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The model's frame and onset activations, (frames, 88 notes) each."""
    session = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
    overlap = OVERLAP * HOP
    padded = np.concatenate([np.zeros(overlap // 2, dtype=np.float32), audio])
    frames, onsets = [], []
    for start in range(0, len(padded), WINDOW - overlap):
        window = padded[start:start + WINDOW]
        window = np.pad(window, (0, WINDOW - len(window)))[None, :, None]
        frame, onset = session.run(OUTPUTS, {session.get_inputs()[0].name: window})
        frames.append(frame[0][OVERLAP // 2:-(OVERLAP // 2)])
        onsets.append(onset[0][OVERLAP // 2:-(OVERLAP // 2)])
    length = int(len(audio) / HOP)
    return np.concatenate(frames)[:length], np.concatenate(onsets)[:length]


def transcribe(audio: np.ndarray, low: int, high: int) -> list[list]:
    """Notes between MIDI pitches `low` and `high` as [start seconds, end seconds, pitch, strength]."""
    frames, onsets = model_output(audio)
    keep = np.zeros(88, dtype=bool)
    keep[max(low - LOWEST_MIDI, 0):high - LOWEST_MIDI + 1] = True
    frames, onsets = frames * keep, onsets * keep
    previous, following = np.roll(onsets, 1, axis=0), np.roll(onsets, -1, axis=0)
    peaks = (onsets >= ONSET_THRESHOLD) & (onsets > previous) & (onsets > following)
    energy = frames.copy()
    notes = []
    for start, key in reversed(np.argwhere(peaks)):  # last first, so each note ends before the next one takes the energy
        i, below = start + 1, 0
        while i < len(energy) - 1 and below < ENERGY_TOLERANCE:
            below = below + 1 if energy[i, key] < FRAME_THRESHOLD else 0
            i += 1
        i -= below
        if i - start <= MIN_NOTE_FRAMES:
            continue
        energy[start:i, max(key - 1, 0):key + 2] = 0
        notes.append([
            round(start * FRAME_SECONDS, 3), round(i * FRAME_SECONDS, 3),
            int(key) + LOWEST_MIDI, round(float(frames[start:i, key].mean()), 3),
        ])
    return sorted(notes)


def onset_strength(audio: np.ndarray, low_only: bool = False) -> np.ndarray:
    n_fft = 1024
    spec = torch.stft(
        torch.from_numpy(audio), n_fft, HOP, window=torch.hann_window(n_fft), return_complex=True
    ).abs().log1p()
    if low_only:
        spec = spec[:int(150 / RATE * n_fft) + 1]
    flux = (spec[:, 1:] - spec[:, :-1]).clamp(min=0).sum(0).numpy()
    return flux / (flux.std() or 1)


def find_beats(audio: np.ndarray) -> np.ndarray:
    """Beat times in seconds, first beat of a bar first. Follows drift in the tempo."""
    fps = RATE / HOP
    envelope = onset_strength(audio)
    if len(envelope) < 2 * fps:
        return np.array([])
    # The tempo: the strongest repeat in the onsets, leaning towards 120 BPM.
    lags = np.arange(int(fps * 60 / 200), int(fps * 60 / 55))
    centred = envelope - envelope.mean()
    repeat = torch.fft.irfft(torch.fft.rfft(torch.from_numpy(centred), 2 * len(centred)).abs() ** 2).numpy()[lags]
    period = lags[np.argmax(repeat * np.exp(-0.5 * np.log2(lags / (fps / 2)) ** 2))]
    # Beats: the path through the onsets that lands on the strongest ones while keeping that period.
    score = np.convolve(envelope, np.hanning(int(period / 4) | 1), "same")
    best = score.copy()
    back = np.full(len(score), -1)
    steps = np.arange(int(period / 2), int(period * 2))
    cost = -100 * np.log(steps / period) ** 2
    for i in range(int(period * 2), len(score)):
        options = best[i - steps] + cost
        pick = np.argmax(options)
        best[i] += options[pick]
        back[i] = i - steps[pick]
    i, path = int(np.argmax(best[-int(period * 2):])) + len(best) - int(period * 2), []
    while i >= 0:
        path.append(i)
        i = back[i]
    beats = np.array(path[::-1])
    low = onset_strength(audio, low_only=True)
    first = max(range(BEATS_PER_BAR), key=lambda n: low[beats[n::BEATS_PER_BAR].clip(max=len(low) - 1)].mean())
    return beats[first:] * HOP / RATE


def analyse(stem: Path, drums: Path | None, low: int, high: int) -> dict:
    """The slow part of a sheet, worth keeping: {"notes", "beats"}."""
    audio = load_mono(stem)
    return {
        "notes": transcribe(audio, low, high),
        "beats": [round(float(b), 3) for b in find_beats(load_mono(drums) if drums else audio)],
    }


def pitch_range(stem: str) -> tuple[int, int]:
    if stem.startswith("guitar"):
        return 38, 90  # down to D tuning's low string
    if stem == "bass":
        return 26, 67
    return 36, 96


def slots(notes: list[list], beats: list[float]) -> dict[int, dict]:
    """Notes moved onto the 16th grid: {slot: {"pitches": set, "end": slot}}."""
    times = np.array(beats)
    period = float(np.median(np.diff(times)))
    before = int(np.ceil(max(times[0] - min((n[0] for n in notes), default=times[0]), 0) / period / BEATS_PER_BAR)) * BEATS_PER_BAR
    last = max((n[1] for n in notes), default=times[-1])
    after = int(max(last - times[-1], 0) / period) + 2
    times = np.concatenate([
        times[0] - period * np.arange(before, 0, -1), times, times[-1] + period * np.arange(1, after + 1),
    ])
    index = np.arange(len(times)) * SLOTS_PER_BEAT
    grid: dict[int, dict] = {}
    for start, end, pitch, _ in notes:
        a, b = np.rint(np.interp([start, end], times, index)).astype(int)
        chord = grid.setdefault(int(a), {"pitches": set(), "end": 0})
        chord["pitches"].add(pitch)
        chord["end"] = max(chord["end"], int(max(b, a + 1)))
    for slot in sorted(grid):  # a strum's last strings land just after the first
        chord, late = grid.get(slot), grid.get(slot + 1)
        if chord and late and len(chord["pitches"]) >= STRUM_NOTES and len(late["pitches"]) < STRUM_NOTES:
            chord["pitches"] |= late["pitches"]
            chord["end"] = max(chord["end"], late["end"])
            del grid[slot + 1]
    return grid


def spell(start: int, length: int) -> list[tuple[int, str, int]]:
    """Split a stretch of one bar into written values: [(slots, VexFlow duration, dots)]."""
    parts = []
    while length:
        size, duration, dots = next(
            (s, d, n) for s, step, d, n in LENGTHS if s <= length and start % step == 0
        )
        parts.append((size, duration, dots))
        start += size
        length -= size
    return parts


def shapes(pitches: list[int], strings: tuple[int, ...]) -> list[list[tuple[int, int]]]:
    """Ways to fret these pitches: [[(string number, fret), ...]], handiest first."""
    found = []
    options = [[(i + 1, p - s) for i, s in enumerate(strings) if 0 <= p - s <= MAX_FRET] for p in pitches]
    for shape in product(*options):
        if len({string for string, _ in shape}) < len(shape):
            continue
        fretted = [fret for _, fret in shape if fret]
        if fretted and max(fretted) - min(fretted) > MAX_REACH - 1:
            continue
        found.append(list(shape))
    return sorted(found, key=hand_position)[:MAX_SHAPES]


def hand_position(shape: list[tuple[int, int]]) -> float:
    fretted = [fret for _, fret in shape if fret]
    return sum(fretted) / len(fretted) if fretted else 0


def playable(pitches: list[int], strings: tuple[int, ...]) -> tuple[list[int], list[list[tuple[int, int]]]]:
    """Fingerings of the chord, giving up inner notes until the hand can reach the rest."""
    low, high = strings[-1], strings[0] + MAX_FRET
    fitted = set()
    for pitch in pitches:
        while pitch < low:
            pitch += 12
        while pitch > high:
            pitch -= 12
        fitted.add(pitch)
    kept = sorted(fitted)
    while True:
        found = shapes(kept, strings)
        if found:
            return kept, found
        del kept[len(kept) // 2]


def assign_frets(chords: list[list[int]], strings: tuple[int, ...]) -> list[list[tuple[int, int, int]]]:
    """Choose a fingering per chord so the hand moves as little as it can: [[(pitch, string, fret), ...]]."""
    table = [playable(c, strings) for c in chords]
    costs: list[np.ndarray] = []
    links: list[np.ndarray] = []
    for n, (_, found) in enumerate(table):
        here = np.array([hand_position(s) for s in found])
        own = here * 0.05
        if not n:
            costs.append(own)
            continue
        there = np.array([hand_position(s) for s in table[n - 1][1]])
        move = costs[-1][:, None] + np.abs(there[:, None] - here[None, :]) * (here[None, :] > 0) * (there[:, None] > 0)
        links.append(move.argmin(axis=0))
        costs.append(move.min(axis=0) + own)
    picks = [int(costs[-1].argmin())] if costs else []
    for link in reversed(links):
        picks.append(int(link[picks[-1]]))
    picks.reverse()
    return [
        [(pitch, string, fret) for pitch, (string, fret) in zip(table[n][0], table[n][1][pick])]
        for n, pick in enumerate(picks)
    ]


def note_name(pitch: int, flats: bool) -> str:
    return f"{(FLATS if flats else SHARPS)[pitch % 12]}/{pitch // 12 - 1}"


def build_sheet(analysis: dict, stem: str, key: dict | None, tuning: str) -> dict:
    """The page as JSON for the browser: clef, key signature and bars of written notes."""
    notes, beats = analysis["notes"], analysis["beats"]
    name, strings = TUNINGS[tuning]
    sheet = {
        "tuning": {"id": tuning, "label": name, "strings": [note_name(s, True).split("/")[0].capitalize() for s in strings], "midi": strings},
        "tempo": 0, "bars": [], "clef": "treble", "octave": False, "signature": "C", "key": key,
    }
    if key:
        major = (key["tonic"] + (3 if key["mode"] == "minor" else 0)) % 12
        sheet["signature"] = SIGNATURES[major]
    if len(beats) < 2 or not notes:
        return sheet
    sheet["tempo"] = round(60 / float(np.median(np.diff(beats))))
    guitar = stem.startswith("guitar")
    pitches = [n[2] for n in notes]
    bass = stem == "bass" or (not guitar and float(np.median(pitches)) < 57)
    sheet["clef"] = "bass" if bass else "treble"
    sheet["octave"] = guitar or stem == "bass"  # both are written an octave above where they sound
    written = 12 if sheet["octave"] else 0
    flats = sheet["signature"] in FLAT_KEYS

    grid = slots(notes, beats)
    starts = sorted(grid)
    chords = assign_frets([sorted(grid[s]["pitches"]) for s in starts], strings)
    events = []
    for n, start in enumerate(starts):
        upcoming = starts[n + 1] if n + 1 < len(starts) else start + SLOTS_PER_BAR
        end = min(grid[start]["end"], upcoming)
        if upcoming - end == 1:  # a one-slot gap is the note's release, not a rest
            end = upcoming
        events.append((start, end, chords[n]))
    first_bar, last_bar = starts[0] // SLOTS_PER_BAR, (events[-1][1] - 1) // SLOTS_PER_BAR
    for bar in range(first_bar, last_bar + 1):
        begin = bar * SLOTS_PER_BAR
        finish = begin + SLOTS_PER_BAR
        written_bar = []
        at = begin
        for start, end, chord in events:
            a, b = max(start, begin), min(end, finish)
            if a >= b:
                continue
            for size, duration, dots in spell(at - begin, a - at):
                written_bar.append({"duration": duration, "dots": dots, "rest": True})
            parts = spell(a - begin, b - a)
            for i, (size, duration, dots) in enumerate(parts):
                written_bar.append({
                    "duration": duration, "dots": dots,
                    "notes": [
                        {"key": note_name(p + written, flats), "string": s, "fret": f} for p, s, f in chord
                    ],
                    "held": i > 0 or a > start,  # carries on from the note before: no new attack
                    "ties": i < len(parts) - 1 or b < end,
                })
            at = b
        for size, duration, dots in spell(at - begin, finish - at):
            written_bar.append({"duration": duration, "dots": dots, "rest": True})
        sheet["bars"].append(written_bar)
    return sheet
