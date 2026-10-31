"""YouTube audio: fetch a video's best audio stream with yt-dlp and save it as MP3 or WAV."""

import re
import subprocess
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.utils import DownloadError, match_filter_func

from separator import FFMPEG

QUALITIES = (192, 256, 320, "wav")  # MP3 bitrates in kbps, or lossless WAV
DEFAULT_QUALITY = 320
HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
DOWNLOAD_SHARE = 0.9  # of the progress bar; encoding takes the rest


def is_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and parsed.hostname in HOSTS


def clean_error(e: Exception) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", str(e)).removeprefix("ERROR: ").strip() or type(e).__name__


def file_name(quality: int | str) -> str:
    return "audio.wav" if quality == "wav" else "audio.mp3"


def download_audio(
    url: str,
    dest: Path,
    quality: int | str = DEFAULT_QUALITY,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Save the video's audio as `dest`, a file named by `file_name(quality)`. Returns {"title", "artist", "duration"}.

    A playlist link downloads only its first video.
    """
    report = on_progress or (lambda _: None)

    def hook(d: dict) -> None:
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d["status"] == "downloading" and total:
            report(min(d.get("downloaded_bytes", 0) / total, 1) * DOWNLOAD_SHARE)

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(dest.with_name("source.%(ext)s")),
        "playlist_items": "1",
        "match_filter": match_filter_func("!is_live"),
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        if info and "entries" in info:
            info = next(iter(info["entries"] or []), None)
        if not info:
            raise DownloadError("This video can't be downloaded (live streams aren't supported)")
        source = Path(ydl.prepare_filename(info))

    title = info.get("track") or info.get("title") or "YouTube audio"
    artist = info.get("artist") or info.get("uploader") or ""
    report(DOWNLOAD_SHARE)
    codec = ["-c:a", "pcm_s16le"] if quality == "wav" else ["-b:a", f"{quality}k"]
    subprocess.run(
        [
            FFMPEG, "-nostdin", "-v", "error", "-y", "-i", str(source), "-vn",
            *codec, "-metadata", f"title={title}", "-metadata", f"artist={artist}",
            str(dest),
        ],
        capture_output=True, check=True,
    )
    source.unlink()
    report(1)
    return {"title": info.get("title") or title, "artist": artist, "duration": info.get("duration")}
