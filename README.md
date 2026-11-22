# Music Note Detector

A Flask web app that finds the note you sing or play, live from the microphone or from an uploaded audio file. The whole page is a pixel-art theme (light and dark) in English and Vietnamese.

## Features

- **Live tuner** (microphone): the note, its octave, frequency and cents sharp or flat, a pitch meter, a piano keyboard that lights the detected key and plays that note when you click, tap or press Enter on a key (a soft piano-like tone, or a pure sine for tuning by ear; slide across the keys to glide; it follows the reference pitch), input level bars and the recent notes. Settings: reference pitch (A4 = 440 or 432 Hz) and sensitivity.
- **Audio file analysis**: upload WAV, MP3, FLAC, M4A, OGG or WMA (up to 50 MB) and pick a mode:
  - **Quick**: fast detection using `Librosa`.
  - **Standard**: accurate pitch tracking using `Parselmouth` (Praat).
  - **Advanced**: custom hybrid of autocorrelation and Harmonic Product Spectrum.
- **Results**: summary (notes found, range, most common note, average confidence), a waveform with playback, a note timeline (a piano roll coloured by octave; click it to jump), and a searchable, paged table with time, note, frequency, cents and confidence.
- **Export** the results as CSV, Excel or text.
- **English and Vietnamese**: `/` is English, `/vi/` is Vietnamese. The words are in `i18n/en.json` and `i18n/vi.json`.

## Running it

The app needs **Python 3.11** (the pinned numpy, scipy and librosa versions have no wheels for 3.13) and `ffmpeg` for some audio formats.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app app run -p 5055        # then open http://localhost:5055
```

`python app.py` also works (port 5000, which macOS AirPlay Receiver may hold). Production is Fly.io (`fly.toml`, `Dockerfile`, gunicorn).

## Project structure

- `app.py`: routes (`/`, `/vi/`, `/upload`, `/analyze`, `/progress/<name>`, `/visualize`, `/export/<format>`, `/cleanup`), the language setup and the `sprite()` template helper. The API takes the uploaded file's **name**, never a path (the server resolves it inside `static/uploads/`).
- `utils/`, `services/`: the audio loading and pitch detection (Librosa, Parselmouth, autocorrelation + HPS).
- `templates/`: `base.html` and `index.html` (one page, two tabs).
- `static/css/pixel.css`, `fonts.css`: the pixel theme. Fonts (Nunito, Silkscreen) are self-hosted in `static/fonts/`.
- `static/js/`: `main.js` (theme, tabs, language links), `detector.js` (live pitch detection), `live.js` (the microphone screen), `upload.js` (the file screen), `viz.js` (meter, keyboard, waveform and timeline drawn as SVG), `util.js`. No build step, no chart library.
- `static/pixel/`: the sprites. Real art goes in `static/pixel/<group>/<name>.png`; stand-ins are used until then. See `static/pixel/README.md`.
- `i18n/`: the English and Vietnamese words.

## Notes

- Uploaded files are deleted from the server when the page is left or another file is chosen (`/cleanup`). Playback and the waveform use the file in your own browser; for formats the browser cannot decode, the server draws the first 30 seconds.
- Analysis progress is kept in memory per gunicorn worker. With two workers the progress bar can stay at 0% (the page then shows an animated bar instead); one worker with threads would fix it.
- The app sets no framing restrictions on purpose: the portfolio embeds it.
