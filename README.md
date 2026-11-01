# Abraham

A music practice app that runs on your own computer. Split any song into separate tracks for
vocals, drums, bass, guitar, piano and more, then mix, transpose and study them.

- **Separate** songs (MP3, WAV, FLAC, M4A, OGG, ...) with Meta's [Demucs](https://github.com/facebookresearch/demucs) models, on your NVIDIA or Apple Silicon GPU when available.
- **Practice** in a multitrack player with mute, solo, volume and per-track transpose, and see the song's key.
- **Study** a track as sheet music or guitar tab in Standard E, Eb or D tuning: print it, save a PDF, or play it in a Guitar Pro style score and save a `.gp` file.
- **Save** YouTube audio as MP3 or WAV.

Your songs stay on your computer.

## Setup

Works on **Windows 10/11, macOS (Apple Silicon and Intel) and Linux**. You need an internet
connection and about 8 GB of free disk space for an NVIDIA install, or 3 GB otherwise. You don't
need admin rights, or Python installed beforehand.

### Windows

1. Go to https://github.com/maarivera/abraham, click **Code**, then **Download ZIP**.
2. Right-click the downloaded file, choose **Extract All**, and open the extracted folder.
3. Double-click `setup.bat`. If Windows SmartScreen appears, click **More info**, then **Run anyway**.
4. Wait for **All set!**, then press any key to close the window. The first install can take a while.
5. Double-click `run.bat`. Abraham opens in your browser at http://127.0.0.1:7860.

From then on, you only need step 5. Keep the `run.bat` window open while you use the app, and close
it when you're done.

### macOS and Linux

1. Open Terminal.
2. Download Abraham and go into its folder:

   ```bash
   git clone https://github.com/maarivera/abraham.git
   cd abraham
   ```

   If you don't have git, use **Code**, then **Download ZIP** on the GitHub page, unzip it, type
   `cd ` in Terminal, drag the unzipped folder into the window, and press Enter.
3. Install everything:

   ```bash
   bash setup.sh
   ```

4. Wait for **All set!**. The first install can take a while.
5. Start the app:

   ```bash
   bash run.sh
   ```

   Abraham opens in your browser at http://127.0.0.1:7860.

From then on, you only need step 5, run from the `abraham` folder. Keep Terminal open while you use
the app, and press **Ctrl+C** there to stop it.

### First song

1. In **My Songs**, click **Upload** and choose an audio file, or drag it onto the page.
2. Pick a separation type and click **Separate**. Choose one with Guitar in its name if you want guitar tabs.
3. When it finishes, click the song to open the player, or open **Study** to write out a track.

The first time you use a separation type, its model downloads automatically.

### Updating

Download the newest version the same way, or run `git pull` if you used git. Then run the setup
script again: it only fetches what's missing, and your songs in `library/` are kept. If you
downloaded a ZIP, move `library/` from your old folder into the new one.

### What setup installs

Everything goes inside the Abraham folder, plus `uv`, a small package manager, in your user folder:
Python 3.12, PyTorch, Demucs, Pedalboard, ONNX Runtime, yt-dlp, ffmpeg, the web server and the
default separation model.

The installer picks the right build for your hardware:

| Hardware | Runs on | Speed (4-min song) | Download |
|---|---|---|---|
| NVIDIA GPU (Windows/Linux) | CUDA | ~1 min | ~3 GB |
| Apple Silicon Mac (M1–M4) | Metal GPU | a few min | ~400 MB |
| Intel Mac / no NVIDIA GPU | CPU | ~3–10 min | ~400 MB |

Setup options (for example `bash setup.sh --cpu`): `--cpu` forces the smaller CPU build, `--cuda` forces the NVIDIA build, `--no-models` skips
the model download. Re-run setup any time; it only fetches what's missing.

### Copying to another computer

Run `./package.sh` to build `dist/abraham.zip` (about 2.3 MB: just the code, fonts, logo and transcription model, without
your songs, downloads or the installed libraries). Unzip it on the other machine and run its setup script.

On macOS, if Finder blocks a downloaded script, run it from Terminal: `bash setup.sh`.

## Run the app

```bash
./run.sh            # Windows: run.bat.  Options: PORT=8000, NO_BROWSER=1
```

It opens http://127.0.0.1:7860 in your browser.

- **Library**: upload songs (button or drag & drop anywhere), pick a separation type, and watch
  live progress. Songs are processed one at a time on the GPU and kept in `library/` across restarts.
- **Player**: all stems play in sync, each with mute (M), solo (S, shift-click to solo several),
  volume and a waveform you can click to seek. Keys: Space play/pause, ←/→ ±5s, Home, L loop.
- **Trim**: drag the handles at either end of a track's waveform to cut its start or end, or focus
  a handle and use ←/→ (Shift for bigger steps). Double-click a handle to undo it. Your stems aren't
  changed, and trims are saved in this browser. Playback, Export Mix and downloads all use them,
  and trimmed stems keep their full length so they still line up.
- **Transpose**: **Song key** moves every track up or down, and each track has its own **Key** control,
  up to ±12 semitones without changing the tempo. A change takes a few seconds the first time, then
  it's saved. Set the drums back to 0 after a song-wide change, since drums rarely sound right
  pitched. Small shifts (±1 to ±4) sound the most natural. Downloads and exports use your keys.
- **Study**: pick a song and track, or click **Upload** to add a song from here: it stays on the page and
  is selected once it's separated. Then generate **Notation**, **Tablature** or **Guitar Pro**
  (notation and tab together), with the guitar in **Standard E**, **Eb** or **D** tuning (D is every string a whole step down, not Drop D).
  Every view can be played, printed, saved as an A4 **PDF** or saved as a **.gp** file. Sheets are transcribed by ear from the separated
  track, so treat them as a draft: they're written in 4/4 on a 16th-note grid, one staff per track.
  The tempo is worked out from the drums' backbeat, so songs without a clear snare can read at double or half speed.
  Tabs show the notes as recorded with no capo, so compare them with the recording rather than a chart in another key.
  Tab frets follow your tuning, while notation shows the notes as they sound. Each view is a live
  score: it plays the part with a synth and a moving cursor, with speed, metronome, count-in, loop
  (drag across bars to choose them) and zoom. **Save .gp** makes a file for Guitar Pro.
- **Key**: the player shows the detected key and follows **Song key**. It's an estimate from the
  audio, and can name the relative major or minor of the true key.
- **Export**: download any single stem, all stems as a zip, or **Export mix** to render your
  current mute/solo/volume settings into one WAV (e.g. a karaoke or drumless track).
- **YouTube Audio**: paste a link and pick MP3 at 192, 256 or 320 kbps, or WAV for the highest quality
  (lossless copy of YouTube's audio, about 10 MB per minute). Files are kept in `downloads/`, ready to
  save or send to **Separate**. A playlist link downloads its first video; live streams aren't
  supported. YouTube's audio is about 128–160 kbps, so higher MP3 settings add size, not quality.
  Only download audio you have the right to use.
- **Settings**: pick a theme (Pip-Boy, Sakura, Golden Palace, Gold Leaf, Arcade, Sky, Neon and more). Saved in your browser.

If YouTube downloads start failing, YouTube has probably changed something. Update yt-dlp with
`uv lock --upgrade-package yt-dlp`, then re-run setup.

## Command line

```bash
.venv/bin/python separator.py song.mp3   # Windows: .venv\\Scripts\\python separator.py ... other_song.flac -m htdemucs_6s -f mp3
```

## Models

| Model         | Stems                                          | Notes                  |
|---------------|------------------------------------------------|------------------------|
| `htdemucs_6s` | vocals, drums, bass, guitar, piano, other      | default                |
| `htdemucs_ft` | vocals, drums, bass, other                     | cleanest drums, bass and other, ~3x slower; no separate guitar or piano |
| `htdemucs`    | vocals, drums, bass, other                     | fastest                |
| `htdemucs_6s_guitars` | as `htdemucs_6s`, with Vocal 1–2 and Guitar 1–4 | splits vocals and guitars by stereo position |

Guitar 1–4 are numbered left to right across the stereo field. Guitars playing from the same
position, including a mono recording, stay together in one track, and a quiet panned guitar can
get its own track.

Vocal 1 is whatever sits in the centre of the mix, usually the lead. Vocal 2 is everything wider,
such as panned harmonies and stereo reverb. This isn't a true lead and backing split: harmonies
mixed in the centre stay in Vocal 1, and vocals with almost nothing to the sides stay in one track.

Model weights download automatically on first use (~80–300 MB, cached in `~/.cache/torch`).
The command line writes to `output/<model>/<song>/`; the app keeps its songs in `library/`.

## Project files

### Server

| File | What it does |
|---|---|
| `app.py` | The web server: song library, separation and download queues, and every API the page calls, including trimmed and transposed downloads |
| `separator.py` | Audio work: runs Demucs, splits vocals and guitars by stereo position, detects the key, transposes stems and silences trimmed sections. Also the command line tool |
| `study.py` | Sheet music: finds the notes and beats in a stem, then writes bars, rhythms and guitar frets for each tuning |
| `youtube.py` | Downloads YouTube audio and saves it as MP3 or WAV |

### Web page (`static/`)

| File | What it does |
|---|---|
| `index.html` | The page layout: sidebar, My Songs, YouTube Audio, Study, Settings and the player |
| `app.js` | The app's behaviour: library, multitrack player, trimming, transpose, YouTube, Study controls and themes |
| `guitarpro.js` | The live score in Study: playback controls and saving `.gp` files |
| `sheet.js` | Draws the clean sheet used for Print and Save PDF, and builds the PDF |
| `style.css` | Layout and styling for the whole app |
| `themes.css` | The 12 themes, and the fonts they use |
| `logo.svg` | The logo. The app colours it to match the theme, in the sidebar and the browser tab |
| `fonts/` | Fonts used by the themes: Inter, Share Tech Mono, Orbitron, Cinzel, Press Start 2P and VT323 |

### Third-party libraries (`static/vendor/`)

| File | What it does |
|---|---|
| `alphatab/alphaTab.min.js` | alphaTab: draws the live score, plays it and exports `.gp` files |
| `alphatab/font/` | Bravura, the music symbol font alphaTab draws with, and its licence |
| `alphatab/soundfont/sonivox.sf3` | The instrument sounds for score playback, with its licence in the same folder |
| `alphatab/LICENSE` | alphaTab's licence |
| `vexflow.js` | VexFlow: draws the notation and tab for Print and Save PDF |
| `jspdf.umd.min.js` | jsPDF: creates the PDF file |
| `svg2pdf.umd.min.js` | svg2pdf.js: puts the drawn music into the PDF |

### Model (`models/`)

| File | What it does |
|---|---|
| `nmp.onnx` | The Basic Pitch model that hears notes in a stem |
| `LICENSE` | Its licence |

### Setup and project

| File | What it does |
|---|---|
| `setup.sh`, `setup.bat` | Install everything on macOS and Linux, or on Windows |
| `run.sh`, `run.bat` | Start the app |
| `package.sh` | Builds `dist/abraham.zip` to copy to another computer |
| `pyproject.toml` | The Python packages the app needs |
| `uv.lock` | The exact package versions, so every install matches |
| `.python-version` | The Python version to use |
| `.gitattributes` | Keeps the right line endings in the setup and run scripts |
| `.gitignore` | Keeps songs, downloads, images and installed files out of git |
| `THIRD_PARTY.md` | Lists the third-party files and their licences |
| `README.md` | This guide |
