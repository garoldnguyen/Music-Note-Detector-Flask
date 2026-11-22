"""Shows which sprites are real art and which are stand-ins, and checks the real ones.

    python scripts/pixel_assets.py

A real sprite is a PNG saved at static/pixel/<group>/<name>.png (for example static/pixel/mic/idle.png). The page
uses it automatically instead of the stand-in. This script checks the size against static/pixel/sprites.json
and that the PNG has an alpha channel (a transparent background). With Pillow installed
(pip install pillow, not needed by the app) it also checks that every pixel is fully opaque or fully
transparent and counts the colours. Exit code 1 means a real sprite has the wrong size.
"""
import json
import os
import struct
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PIXEL = os.path.join(ROOT, 'static', 'pixel')


def png_header(path):
    with open(path, 'rb') as fh:
        data = fh.read(33)
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    width, height, depth, colour, _, _, interlace = struct.unpack('>IIBBBBB', data[16:29])
    return width, height, colour, interlace


def main():
    with open(os.path.join(PIXEL, 'sprites.json'), encoding='utf-8') as fh:
        sprites = json.load(fh)
    try:
        from PIL import Image
    except ImportError:
        Image = None

    real = bad = 0
    wrong_size = False
    for name, (w, h) in sprites.items():
        path = os.path.join(PIXEL, name + '.png')
        if not os.path.exists(path):
            print('  stand-in  %-18s %dx%d' % (name, w, h))
            continue
        real += 1
        info = png_header(path)
        problems = []
        if not info:
            problems.append('not a PNG')
        else:
            if (info[0], info[1]) != (w, h):
                wrong_size = True
                problems.append('is %dx%d, expected %dx%d' % (info[0], info[1], w, h))
            if info[2] not in (4, 6) and not (info[2] == 3):
                problems.append('no alpha channel (needs a transparent background)')
            if Image is not None and not problems:
                image = Image.open(path).convert('RGBA')
                access = image.load()
                pixels = [access[x, y] for y in range(image.height) for x in range(image.width)]
                partial = sum(1 for p in pixels if 0 < p[3] < 255)
                colours = len({p[:3] for p in pixels if p[3] == 255})
                if partial:
                    problems.append('%d semi-transparent pixels (use fully opaque or fully transparent)' % partial)
                if colours > 18:
                    problems.append('%d colours (about 18 or fewer keeps the pixel look)' % colours)
        if problems:
            bad += 1
            print('  CHECK     %-18s %s' % (name, '; '.join(problems)))
        else:
            print('  real      %-18s %dx%d' % (name, w, h))
    print('\n%d real, %d stand-in, %d to check' % (real, len(sprites) - real, bad))
    if Image is None:
        print('(install Pillow to also check transparency and colour count)')
    sys.exit(1 if wrong_size else 0)


if __name__ == '__main__':
    main()
