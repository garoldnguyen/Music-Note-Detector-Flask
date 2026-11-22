# Pixel sprites

`sprites.json` is the single list of sprites (name and size in pixels). The page asks for each one by name.

- **Real art** goes at `static/pixel/<group>/<name>.png`, for example `static/pixel/mic/idle.png`
  (made with Astra, prompts in `music-note-astra-prompts.md` one folder above the repo). The page uses it as soon as the
  file exists; nothing else to change.
- **Stand-ins** are in `static/pixel/_placeholder/`. They are drawn by `python scripts/make_placeholders.py`
  and used for any sprite that has no real file yet.
- `python scripts/pixel_assets.py` lists which sprites are real and which are still stand-ins, and checks the real ones
  (size, transparent background; with Pillow installed also colour count and half-transparent pixels).

Rules for real sprites: exactly the size in `sprites.json`, PNG, transparent background, about 18 colours or fewer, fully
opaque or fully transparent pixels only. They are shown at 1x, 2x or 3x with `image-rendering: pixelated`.

`ui/sun.png` and `ui/moon.png` are the same real sprites as in the portfolio.
