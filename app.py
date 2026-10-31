"""Abraham server: song library, background separation queue, YouTube audio, sheet music and the web player."""

import json
import os
import queue
import shutil
import threading
import time
import traceback
import uuid
import webbrowser
import zipfile
from pathlib import Path
from typing import Callable

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from separator import DEFAULT_MODEL, MAX_SEMITONES, MODELS, device_name, separate, silence_outside, stems_key, transpose_stem
from study import DEFAULT_TUNING, TUNINGS, analyse, build_sheet, pitch_range
from youtube import DEFAULT_QUALITY, QUALITIES, clean_error, download_audio, file_name, is_youtube_url

ROOT = Path(__file__).parent
LIBRARY = ROOT / "library"
DOWNLOADS = ROOT / "downloads"
STATIC = ROOT / "static"
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff", ".aif", ".mp4"}

songs: dict[str, dict] = {}
lock = threading.Lock()
jobs: queue.Queue[str] = queue.Queue()
downloads: dict[str, dict] = {}
download_jobs: queue.Queue[str] = queue.Queue()


def song_dir(song_id: str) -> Path:
    return LIBRARY / song_id


def save_meta(song: dict) -> None:
    (song_dir(song["id"]) / "meta.json").write_text(json.dumps(song, indent=2))


def update(song_id: str, persist: bool = True, **fields) -> None:
    with lock:
        song = songs[song_id]
        song.update(fields)
        if persist:
            save_meta(song)


def load_library() -> None:
    LIBRARY.mkdir(exist_ok=True)
    for meta in LIBRARY.glob("*/meta.json"):
        song = json.loads(meta.read_text())
        if song["status"] in ("queued", "processing"):
            song.update(status="queued", progress=0)
            jobs.put(song["id"])
        songs[song["id"]] = song


def download_dir(download_id: str) -> Path:
    return DOWNLOADS / download_id


def audio_path(item: dict) -> Path:
    return download_dir(item["id"]) / file_name(item["quality"])


def update_download(download_id: str, persist: bool = True, **fields) -> None:
    with lock:
        item = downloads[download_id]
        item.update(fields)
        if persist:
            (download_dir(download_id) / "meta.json").write_text(json.dumps(item, indent=2))


def load_downloads() -> None:
    DOWNLOADS.mkdir(exist_ok=True)
    for meta in DOWNLOADS.glob("*/meta.json"):
        item = json.loads(meta.read_text())
        item.setdefault("quality", item.get("kbps", DEFAULT_QUALITY))  # saved before WAV existed
        if item["status"] in ("queued", "downloading"):
            item.update(status="queued", progress=0)
            download_jobs.put(item["id"])
        downloads[item["id"]] = item


def download_worker() -> None:
    while True:
        download_id = download_jobs.get()
        with lock:
            item = downloads.get(download_id)
        if item is None:  # deleted while queued
            continue
        update_download(download_id, status="downloading", progress=0)

        def on_progress(frac: float) -> None:
            update_download(download_id, persist=False, progress=round(frac, 3))

        try:
            result = download_audio(url=item["url"], dest=audio_path(item), quality=item["quality"], on_progress=on_progress)
            update_download(
                download_id, status="ready", progress=1,
                title=result["title"], artist=result["artist"], duration=result["duration"],
            )
        except Exception as e:
            traceback.print_exc()
            update_download(download_id, status="error", error=clean_error(e))


def find_key(song: dict) -> dict:
    """The song's detected key, worked out once and kept with the song."""
    if not song.get("key"):
        stems = song_dir(song["id"]) / "stems"
        pitched = [stems / f"{name}.wav" for name in song["stems"] if name != "drums"]
        update(song["id"], key=stems_key(pitched))
    return song["key"]


def worker() -> None:
    while True:
        song_id = jobs.get()
        with lock:
            song = songs.get(song_id)
        if song is None:  # deleted while queued
            continue
        update(song_id, status="processing", progress=0)
        last_saved = 0.0

        def on_progress(frac: float) -> None:
            nonlocal last_saved
            update(song_id, persist=False, progress=round(frac, 3))
            if time.time() - last_saved > 5:
                last_saved = time.time()
                update(song_id)

        try:
            src = song_dir(song_id) / song["file"]
            result = separate(src, song_dir(song_id) / "stems", song["model"], on_progress=on_progress)
            update(
                song_id, status="ready", progress=1,
                stems=list(result["stems"]), duration=result["duration"],
                zip=result["zip"].name,
            )
        except Exception as e:
            traceback.print_exc()
            update(song_id, status="error", error=str(e) or type(e).__name__)
            continue
        try:
            find_key(song)
        except Exception:  # the stems are fine; the player can ask again later
            traceback.print_exc()


app = FastAPI(title="Abraham")


@app.middleware("http")
async def always_revalidate(request: Request, call_next):
    """Make browsers check for changes, so an update never runs against a cached app.js."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/info")
def info():
    models = [{"id": k, "description": v} for k, v in MODELS.items()]
    return {
        "device": device_name(), "models": models, "default_model": DEFAULT_MODEL,
        "qualities": QUALITIES, "default_quality": DEFAULT_QUALITY,
        "tunings": [{"id": k, "label": v[0]} for k, v in TUNINGS.items()], "default_tuning": DEFAULT_TUNING,
    }


@app.get("/api/songs")
def list_songs():
    with lock:
        return sorted(songs.values(), key=lambda s: s["created"], reverse=True)


def add_song(title: str, ext: str, model: str, write: Callable[[Path], None]) -> dict:
    """Create a library entry, let `write` put the audio at the given path, and queue it."""
    song_id = uuid.uuid4().hex[:12]
    folder = song_dir(song_id)
    folder.mkdir(parents=True)
    write(folder / f"original{ext}")
    song = {
        "id": song_id, "title": title, "file": f"original{ext}",
        "model": model, "status": "queued", "progress": 0, "error": None,
        "stems": [], "duration": None, "zip": None, "created": time.time(),
    }
    with lock:
        songs[song_id] = song
        save_meta(song)
    jobs.put(song_id)
    return song


@app.post("/api/songs")
async def upload(files: list[UploadFile] = File(...), model: str = Form(DEFAULT_MODEL)):
    if model not in MODELS:
        raise HTTPException(400, f"Unknown model {model}")
    created = []
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in AUDIO_EXTS:
            raise HTTPException(400, f"{f.filename}: unsupported file type")
        def write(path: Path) -> None:
            with open(path, "wb") as out:
                shutil.copyfileobj(f.file, out)

        created.append(add_song(Path(f.filename).stem, ext, model, write))
    return created


def get_song(song_id: str) -> dict:
    with lock:
        song = songs.get(song_id)
    if song is None:
        raise HTTPException(404, "Song not found")
    return song


@app.get("/api/songs/{song_id}")
def song_detail(song_id: str):
    return get_song(song_id)


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: str):
    song = get_song(song_id)
    if song["status"] == "processing":
        raise HTTPException(409, "Song is being processed; wait for it to finish")
    with lock:
        songs.pop(song_id, None)
    shutil.rmtree(song_dir(song_id), ignore_errors=True)
    return {"ok": True}


@app.get("/api/songs/{song_id}/key")
def song_key(song_id: str):
    song = get_song(song_id)
    if song["status"] != "ready":
        raise HTTPException(409, "Song isn't separated yet")
    return find_key(song)


def find_analysis(song: dict, stem: str) -> dict:
    """The stem's notes and beats, worked out once and kept with the song."""
    path = song_dir(song["id"]) / "study" / f"{stem}.json"
    if path.exists():
        return json.loads(path.read_text())
    stems = song_dir(song["id"]) / "stems"
    drums = stems / "drums.wav" if "drums" in song["stems"] else None
    analysis = analyse(stems / f"{stem}.wav", drums, *pitch_range(stem))
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(analysis))
    return analysis


@app.get("/api/songs/{song_id}/sheet/{stem}")
def song_sheet(song_id: str, stem: str, tuning: str = DEFAULT_TUNING):
    song = get_song(song_id)
    if song["status"] != "ready":
        raise HTTPException(409, "Song isn't separated yet")
    if stem not in song["stems"] or stem == "drums":
        raise HTTPException(404, "No notes to write out for that track")
    if tuning not in TUNINGS:
        raise HTTPException(400, "Unknown tuning")
    return build_sheet(find_analysis(song, stem), stem, find_key(song), tuning)


@app.get("/api/songs/{song_id}/peaks")
def peaks(song_id: str):
    get_song(song_id)
    return FileResponse(song_dir(song_id) / "stems" / "peaks.json")


def stem_path(song_id: str, stem: str, semitones: int) -> Path:
    """The stem's WAV at this transposition, rendered the first time it's asked for."""
    stems = song_dir(song_id) / "stems"
    if not semitones:
        return stems / f"{stem}.wav"
    path = stems / "transposed" / f"{stem}{semitones:+d}.wav"
    if not path.exists():
        transpose_stem(stems / f"{stem}.wav", path, semitones)
    return path


def key_suffix(semitones: int) -> str:
    return f" ({semitones:+d})" if semitones else ""


@app.get("/api/songs/{song_id}/stems/{stem}")
def stem_file(song_id: str, stem: str, semitones: int = Query(0, ge=-MAX_SEMITONES, le=MAX_SEMITONES)):
    song = get_song(song_id)
    if stem not in song["stems"]:
        raise HTTPException(404, "Stem not found")
    path = stem_path(song_id, stem, semitones)
    return FileResponse(path, filename=f"{song['title']} - {stem}{key_suffix(semitones)}.wav")


def parse_transpose(text: str, stems: list[str]) -> dict[str, int]:
    """Read "vocals:2,bass:-1" into {stem: semitones}, leaving out stems that aren't shifted."""
    shifts = {}
    for part in filter(None, text.split(",")):
        stem, _, value = part.partition(":")
        try:
            semitones = int(value)
        except ValueError:
            raise HTTPException(400, f"Bad transpose value {part}")
        if stem not in stems or abs(semitones) > MAX_SEMITONES:
            raise HTTPException(400, f"Bad transpose value {part}")
        if semitones:
            shifts[stem] = semitones
    return dict(sorted(shifts.items()))


def parse_trim(text: str, stems: list[str], duration: float) -> dict[str, tuple[float, float]]:
    """Read "vocals:1.25-30.50,bass:0.00-12.00" into {stem: (start seconds, end seconds)}."""
    trims = {}
    for part in filter(None, text.split(",")):
        stem, _, times = part.partition(":")
        start, _, end = times.partition("-")
        try:
            start, end = float(start), float(end)
        except ValueError:
            raise HTTPException(400, f"Bad trim value {part}")
        if stem not in stems or not 0 <= start < end <= duration + 1:
            raise HTTPException(400, f"Bad trim value {part}")
        trims[stem] = (start, end)
    return dict(sorted(trims.items()))


def trimmed_stem(path: Path, start: float, end: float) -> Path:
    """A copy of the stem, kept next to it, that's silent outside these times."""
    dest = path.parent / "trimmed" / f"{path.stem} {start:.2f}-{end:.2f}.wav"
    if not dest.exists():
        dest.parent.mkdir(exist_ok=True)
        silence_outside(path, dest, start, end)
    return dest


@app.get("/api/songs/{song_id}/zip")
def stems_zip(song_id: str, transpose: str = "", trim: str = ""):
    song = get_song(song_id)
    if not song["zip"]:
        raise HTTPException(404, "Stems not ready")
    filename = f"{song['title']} - stems.zip"
    shifts = parse_transpose(transpose, song["stems"])
    trims = parse_trim(trim, song["stems"], song["duration"])
    if not shifts and not trims:
        return FileResponse(song_dir(song_id) / "stems" / song["zip"], filename=filename)
    # Rendered first, so the zip is only created once every stem has succeeded.
    paths = {stem: stem_path(song_id, stem, shifts.get(stem, 0)) for stem in song["stems"]}
    paths |= {stem: trimmed_stem(paths[stem], *times) for stem, times in trims.items()}
    folder = song_dir(song_id) / "stems" / "transposed"
    folder.mkdir(exist_ok=True)
    names = [f"{s}{n:+d}" for s, n in shifts.items()] + [f"{s}={a:.2f}-{b:.2f}" for s, (a, b) in trims.items()]
    path = folder / f"stems {uuid.uuid5(uuid.NAMESPACE_OID, ' '.join(names)).hex}.zip"
    if not path.exists():
        tmp = folder / f"{uuid.uuid4().hex}.zip"
        with zipfile.ZipFile(tmp, "w") as zf:
            for stem, stem_wav in paths.items():
                zf.write(stem_wav, f"{stem}{key_suffix(shifts.get(stem, 0))}.wav")
        tmp.replace(path)
    return FileResponse(path, filename=filename)


class DownloadRequest(BaseModel):
    url: str
    quality: int | str = DEFAULT_QUALITY


class SeparateRequest(BaseModel):
    model: str = DEFAULT_MODEL


def get_download(download_id: str) -> dict:
    with lock:
        item = downloads.get(download_id)
    if item is None:
        raise HTTPException(404, "Download not found")
    return item


@app.get("/api/downloads")
def list_downloads():
    with lock:
        return sorted(downloads.values(), key=lambda d: d["created"], reverse=True)


@app.post("/api/downloads")
def start_download(req: DownloadRequest):
    url = req.url.strip()
    if not is_youtube_url(url):
        raise HTTPException(400, "That doesn't look like a YouTube link")
    if req.quality not in QUALITIES:
        raise HTTPException(400, f"Unknown quality {req.quality}")
    download_id = uuid.uuid4().hex[:12]
    download_dir(download_id).mkdir(parents=True)
    item = {
        "id": download_id, "url": url, "quality": req.quality, "title": url, "artist": "",
        "status": "queued", "progress": 0, "error": None, "duration": None,
        "created": time.time(),
    }
    with lock:
        downloads[download_id] = item
    update_download(download_id)
    download_jobs.put(download_id)
    return item


@app.get("/api/downloads/{download_id}/file")
def download_file(download_id: str):
    item = get_download(download_id)
    if item["status"] != "ready":
        raise HTTPException(404, "Audio not ready")
    path = audio_path(item)
    return FileResponse(path, filename=f"{item['title']}{path.suffix}")


@app.post("/api/downloads/{download_id}/separate")
def separate_download(download_id: str, req: SeparateRequest):
    item = get_download(download_id)
    if item["status"] != "ready":
        raise HTTPException(409, "Audio not ready")
    if req.model not in MODELS:
        raise HTTPException(400, f"Unknown model {req.model}")
    source = audio_path(item)
    return add_song(item["title"], source.suffix, req.model, lambda path: shutil.copyfile(source, path))


@app.delete("/api/downloads/{download_id}")
def delete_download(download_id: str):
    item = get_download(download_id)
    if item["status"] == "downloading":
        raise HTTPException(409, "Still downloading; wait for it to finish")
    with lock:
        downloads.pop(download_id, None)
    shutil.rmtree(download_dir(download_id), ignore_errors=True)
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


if __name__ == "__main__":
    load_library()
    load_downloads()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=download_worker, daemon=True).start()
    port = int(os.environ.get("PORT", 7860))
    url = f"http://127.0.0.1:{port}"
    print(f"Abraham running at {url}  (Ctrl+C to stop)")
    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
