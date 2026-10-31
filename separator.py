"""Stem separation core: decode a song, run a Demucs model, write one file per instrument."""

import argparse
import json
import os
import shutil
import subprocess
import uuid
import zipfile
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

# Let ops that Apple's Metal backend lacks run on the CPU instead of failing.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import imageio_ffmpeg
import numpy as np
import soundfile as sf
import torch
import demucs.apply
from demucs.apply import BagOfModels, apply_model
from demucs.pretrained import get_model
from pedalboard import time_stretch

MODELS = {
    "htdemucs_6s": "6 stems: vocals, drums, bass, guitar, piano, other",
    "htdemucs_ft": "4 stems, best quality: vocals, drums, bass, other (slower)",
    "htdemucs": "4 stems, fast: vocals, drums, bass, other",
    "htdemucs_6s_guitars": "6 stems, with the guitar split by stereo position into up to 4 tracks",
}
DEFAULT_MODEL = "htdemucs_6s"
DEMUCS_MODEL = {"htdemucs_6s_guitars": "htdemucs_6s"}  # options that build on another model
MAX_GUITARS = 4
OUTPUT_DIR = Path(__file__).parent / "output"
PEAKS_PER_STEM = 1200
MAX_SEMITONES = 12
TRIM_FADE = 0.005  # seconds, so a cut doesn't click
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()  # bundled binary, no system install needed


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def device_name() -> str:
    device = pick_device()
    if device == "cuda":
        return torch.cuda.get_device_name(0)
    if device == "mps":
        return "Apple Silicon GPU (Metal)"
    return "CPU"


def free_gpu_memory(device: str) -> None:
    if device == "cuda":
        torch.cuda.empty_cache()
    elif device == "mps":
        torch.mps.empty_cache()


@lru_cache(maxsize=2)
def load_model(name: str):
    model = get_model(name)
    model.eval()
    return model


def decode(path: Path, samplerate: int, channels: int) -> np.ndarray:
    """Decode any format ffmpeg understands into a (channels, samples) float32 array."""
    cmd = [
        FFMPEG, "-nostdin", "-v", "error", "-i", str(path),
        "-f", "f32le", "-ac", str(channels), "-ar", str(samplerate), "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).T
    if audio.shape[1] == 0:
        raise ValueError(f"No audio decoded from {path.name}")
    return audio


def write_stem(audio: np.ndarray, samplerate: int, dest: Path, fmt: str) -> Path:
    wav_path = dest.with_suffix(".wav")
    sf.write(wav_path, audio.T, samplerate, subtype="PCM_16")
    if fmt == "wav":
        return wav_path
    out = dest.with_suffix(".mp3")
    subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-y", "-i", str(wav_path), "-b:a", "320k", str(out)],
        check=True,
    )
    wav_path.unlink()
    return out


@contextmanager
def report_progress(on_progress: Callable[[float], None] | None, passes: int):
    """Route demucs' per-chunk tqdm loop into `on_progress(fraction_done)`."""
    if on_progress is None:
        yield
        return
    done = 0

    def tracked(items, **_):
        nonlocal done
        items = list(items)
        for i, item in enumerate(items):
            on_progress(min((done + i / len(items)) / passes, 1.0))
            yield item
        done += 1
        on_progress(min(done / passes, 1.0))

    original = demucs.apply.tqdm
    demucs.apply.tqdm = SimpleNamespace(tqdm=tracked)
    try:
        yield
    finally:
        demucs.apply.tqdm = original


def _run(model, wav: torch.Tensor, device: str, shifts: int, on_progress) -> torch.Tensor:
    passes = (len(model.models) if isinstance(model, BagOfModels) else 1) * max(shifts, 1)
    with report_progress(on_progress, passes):
        return apply_model(
            model, wav[None], device=device, shifts=shifts,
            split=True, overlap=0.25, progress=True,
        )[0]


def split_by_pan(audio: np.ndarray, max_parts: int = MAX_GUITARS) -> list[np.ndarray]:
    """Split stereo (2, samples) audio at the stereo positions holding most of its energy.

    Returns one array per position, left to right. They sum back to `audio`. Parts playing
    from the same position can't be told apart, so the list can be shorter than `max_parts`.
    """
    n_fft, hop = 4096, 1024
    if audio.shape[1] < n_fft:
        return [audio]
    wav = torch.from_numpy(audio.astype(np.float32))
    window = torch.hann_window(n_fft)
    spec = torch.stft(wav, n_fft, hop, window=window, return_complex=True)
    left, right = spec.abs()
    pan = 4 / np.pi * torch.atan2(right, left + 1e-12) - 1  # -1 hard left .. 1 hard right

    bins = 41
    energy = left**2 + right**2
    hist = np.bincount(
        ((pan.flatten().numpy() + 1) / 2 * (bins - 1)).round().astype(int),
        weights=energy.flatten().numpy(), minlength=bins,
    )
    smooth = np.convolve(hist, np.hanning(5) / np.hanning(5).sum(), "same")
    centers = np.linspace(-1, 1, bins)
    peaks = [
        i for i in range(bins)
        if smooth[i] >= smooth[max(i - 1, 0):i + 2].max() and smooth[i] > smooth.max() * 0.25
    ]
    chosen: list[int] = []
    for i in sorted(peaks, key=lambda i: -smooth[i]):
        if len(chosen) < max_parts and all(abs(centers[i] - centers[j]) >= 0.3 for j in chosen):
            chosen.append(i)
    if len(chosen) < 2:
        return [audio]

    positions = torch.tensor(sorted(centers[i] for i in chosen), dtype=torch.float32)
    weights = torch.exp(-(((pan[None] - positions[:, None, None]) / 0.15) ** 2))
    weights = weights / (weights.sum(0, keepdim=True) + 1e-9)  # shares of each bin add up to 1
    parts = [
        torch.istft(spec * w, n_fft, hop, window=window, length=wav.shape[-1]).numpy()
        for w in weights
    ]
    # Rounding aside, parts already sum to the input; give any remainder to the first.
    parts[0] = parts[0] + (audio - sum(parts))
    return parts


# Sha'ath key profiles, from C. They suit pop and rock better than the classical-music ones.
MAJOR_PROFILE = np.array([6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4])
MINOR_PROFILE = np.array([6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2])


def detect_key(audio: np.ndarray, samplerate: int) -> dict:
    """Estimate the key of (channels, samples) audio.

    Returns {"tonic": 0-11 from C, "mode": "major"|"minor", "confidence": 0-1}.
    """
    n_fft = 16384  # long enough to tell neighbouring low notes apart
    if audio.shape[1] < n_fft:
        return {"tonic": 0, "mode": "major", "confidence": 0}
    mono = torch.from_numpy(audio.astype(np.float32)).mean(0)
    spec = torch.stft(mono, n_fft, n_fft // 2, window=torch.hann_window(n_fft), return_complex=True)
    spec = spec.abs().numpy()
    freqs = np.fft.rfftfreq(n_fft, 1 / samplerate)
    bins = np.where((freqs >= 55) & (freqs <= 2000))[0]
    pitch_class = np.round(12 * np.log2(freqs[bins] / 440) + 9).astype(int) % 12
    # A note also rings at its overtones, so credit each pitch with its 2nd and 3rd harmonics.
    frames = spec[bins] + 0.5 * spec[bins * 2] + 0.33 * spec[bins * 3]
    # Scaling each frame on its own stops loud moments from outvoting the rest of the song.
    frames = (frames / (frames.max(0, keepdims=True) + 1e-9)) ** 2
    chroma = np.bincount(pitch_class, weights=frames.sum(1), minlength=12)
    if not chroma.any():
        return {"tonic": 0, "mode": "major", "confidence": 0}

    scores = [
        (np.corrcoef(chroma, np.roll(profile, tonic))[0, 1], tonic, mode)
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE))
        for tonic in range(12)
    ]
    scores.sort(reverse=True)
    best, tonic, mode = scores[0]
    return {"tonic": tonic, "mode": mode, "confidence": round(max(float(best), 0), 2)}


def stems_key(stem_paths: list[Path]) -> dict:
    """Detect the key of a separated song, leaving out drums, which have no pitch."""
    mix, samplerate = None, 44100
    for path in stem_paths:
        audio, samplerate = sf.read(path, dtype="float32", always_2d=True)
        mix = audio if mix is None else mix + audio
    return detect_key(mix.T, samplerate)


def compute_peaks(sources: np.ndarray, n: int = PEAKS_PER_STEM) -> list[list[float]]:
    """Per-stem waveform peaks, scaled to the loudest stem so quiet stems look quiet."""
    mono = np.abs(sources).max(axis=1)  # (stems, samples)
    usable = mono.shape[1] // n * n
    peaks = mono[:, :usable].reshape(len(mono), n, -1).max(axis=2)
    peaks /= max(peaks.max(), 1e-8)
    return np.round(peaks, 3).tolist()


def separate(
    song: Path,
    dest_dir: Path,
    model_name: str = DEFAULT_MODEL,
    fmt: str = "wav",
    shifts: int = 1,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Split `song` into stems inside `dest_dir`.

    Returns {"stems": {name: file}, "zip": file, "duration": seconds}. Also writes
    peaks.json next to the stems for waveform drawing.
    """
    song = Path(song)
    model = load_model(DEMUCS_MODEL.get(model_name, model_name))
    audio = torch.from_numpy(decode(song, model.samplerate, model.audio_channels).copy())
    duration = audio.shape[1] / model.samplerate

    # Demucs expects normalized input; undo the normalization afterwards.
    ref = audio.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    audio = (audio - mean) / std

    device = pick_device()
    try:
        sources = _run(model, audio, device, shifts, on_progress)
    except Exception as e:
        # Out of GPU memory, or an op the GPU backend can't run: retry on the CPU.
        if device == "cpu":
            raise
        print(f"{device} failed ({type(e).__name__}: {e}); retrying on CPU")
        free_gpu_memory(device)
        device = "cpu"
        sources = _run(model, audio, device, shifts, on_progress)
    sources = sources * std + mean

    # Rescale to avoid clipping while keeping the stems' relative levels.
    peak = sources.abs().max().item()
    if peak > 0.999:
        sources = sources / peak * 0.999
    tracks = dict(zip(model.sources, sources.cpu().numpy()))
    if model_name in DEMUCS_MODEL:
        parts = split_by_pan(tracks["guitar"])
        if len(parts) > 1:
            tracks = {k: v for k, v in tracks.items() if k != "guitar"}
            tracks.update({f"guitar_{i}": part for i, part in enumerate(parts, 1)})

    dest_dir.mkdir(parents=True, exist_ok=True)
    stems = {}
    for name, data in tracks.items():
        stems[name] = write_stem(data, model.samplerate, dest_dir / name, fmt)
    (dest_dir / "peaks.json").write_text(
        json.dumps(dict(zip(tracks, compute_peaks(np.stack(list(tracks.values()))))))
    )

    zip_path = dest_dir / f"{song.stem}_stems.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for path in stems.values():
            zf.write(path, path.name)

    free_gpu_memory(device)
    return {"stems": stems, "zip": zip_path, "duration": duration}


def silence_outside(src: Path, dest: Path, start: float, end: float) -> None:
    """Write `src` to `dest` silent outside start..end seconds, keeping its length so stems stay in line."""
    info = sf.info(src)
    audio, rate = sf.read(src, always_2d=True, dtype="float32")
    first, last = int(start * rate), min(int(end * rate), len(audio))
    fade = min(int(TRIM_FADE * rate), (last - first) // 2)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
    audio[first:first + fade] *= ramp
    audio[last - fade:last] *= ramp[::-1]
    audio[:first] = 0
    audio[last:] = 0
    tmp = dest.with_suffix(".tmp.wav")
    sf.write(tmp, audio, rate, subtype=info.subtype)
    tmp.replace(dest)


def transpose_stem(src: Path, dest: Path, semitones: int) -> None:
    """Write the WAV `src` to `dest` shifted by `semitones`, keeping its tempo and length."""
    audio, samplerate = sf.read(src, dtype="float32", always_2d=True)
    # Of the engine and transient settings, this keeps hits tightest, so shifted stems stay in sync.
    shifted = time_stretch(
        audio.T, samplerate, pitch_shift_in_semitones=semitones,
        high_quality=False, transient_mode="crisp",
    )
    peak = np.abs(shifted).max()
    if peak > 0.999:
        shifted = shifted / peak * 0.999
    dest.parent.mkdir(exist_ok=True)
    # Two requests can render the same stem at once; only a finished file gets the final name.
    tmp = dest.with_name(f"{uuid.uuid4().hex}.wav")
    sf.write(tmp, shifted.T, samplerate, subtype="PCM_16")
    tmp.replace(dest)


def main():
    parser = argparse.ArgumentParser(description="Split songs into instrument stems.")
    parser.add_argument("songs", nargs="+", type=Path)
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL, choices=MODELS)
    parser.add_argument("-f", "--format", default="wav", choices=["wav", "mp3"])
    parser.add_argument("--shifts", type=int, default=1, help="More = slightly better, slower")
    parser.add_argument("-o", "--output", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    print(f"Device: {device_name()}  Model: {args.model}")
    for song in args.songs:
        print(f"\n==> {song.name}")
        dest = args.output / args.model / song.stem
        if dest.exists():
            shutil.rmtree(dest)
        result = separate(song, dest, args.model, args.format, args.shifts)
        for name, path in result["stems"].items():
            print(f"  {name:8s} {path}")
        print(f"  zip      {result['zip']}")


if __name__ == "__main__":
    main()
