"""Draws stand-in pixel sprites for every entry of static/pixel/sprites.json.

    python scripts/make_placeholders.py

The stand-ins go to static/pixel/_placeholder/<group>/<name>.png. A real sprite saved at
static/pixel/<group>/<name>.png (made with Astra, see music-note-astra-prompts.md) is used instead
automatically: the template helper sprite() in app.py looks there first. Standard library only.
"""
import json
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PIXEL = os.path.join(ROOT, 'static', 'pixel')

# palette (the same hex values as the Astra prompts)
C = {
    'P': (0x3B, 0x2A, 0x3A), 'G': (0xF2, 0xC1, 0x4E), 'H': (0xFF, 0xF3, 0xC9), 'S': (0xD9, 0xA5, 0x2E),
    'C': (0xE7, 0x6F, 0x51), 'T': (0x2A, 0x9D, 0x8F), 'U': (0x5C, 0xC4, 0xB5), 'M': (0x8F, 0xD3, 0xC6),
    'F': (0xFB, 0xF1, 0xE1), 'A': (0xFF, 0xFD, 0xF8), 'W': (0xA0, 0x67, 0x3A), 'B': (0xF4, 0xA2, 0x61),
    'Y': (0xCD, 0xBF, 0xCB), 'Z': (0x8E, 0x7F, 0x8A),
}


class Grid:
    """A small RGBA canvas that is drawn at a logical size and saved at a whole-number scale."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def rect(self, x, y, w, h, key):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.px[yy][xx] = C[key]

    def rects(self, items):
        for x, y, w, h, key in items:
            self.rect(x, y, w, h, key)

    def circle(self, cx, cy, r, fill, outline):
        for y in range(self.h):
            for x in range(self.w):
                d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
                if d <= r:
                    self.px[y][x] = C[outline] if d > r - 1.1 else C[fill]

    def flip_h(self):
        self.px = [list(reversed(row)) for row in self.px]

    def png(self, scale):
        w, h = self.w * scale, self.h * scale
        raw = bytearray()
        for y in range(h):
            raw.append(0)
            row = self.px[y // scale]
            for x in range(w):
                p = row[x // scale]
                raw.extend((p[0], p[1], p[2], 255) if p else (0, 0, 0, 0))

        def chunk(tag, data):
            body = tag + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

        return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


MIC = [(5, 1, 6, 1, 'P'), (4, 2, 1, 6, 'P'), (11, 2, 1, 6, 'P'), (5, 8, 6, 1, 'P'), (5, 2, 6, 6, 'G'), (5, 2, 2, 2, 'H'),
       (5, 4, 6, 1, 'S'), (5, 6, 6, 1, 'S'), (2, 5, 1, 6, 'P'), (13, 5, 1, 6, 'P'), (3, 11, 10, 1, 'P'),
       (7, 12, 2, 2, 'P'), (5, 14, 6, 1, 'P')]
EIGHTH = [(4, 10, 4, 3, 'G'), (4, 13, 4, 1, 'P'), (3, 11, 1, 2, 'P'), (8, 2, 1, 11, 'P'), (9, 2, 3, 1, 'P'), (11, 3, 1, 3, 'P')]


def doc(color):
    return [(3, 1, 10, 14, 'P'), (4, 2, 8, 12, 'A'), (5, 5, 6, 1, color), (5, 7, 6, 1, color), (5, 9, 4, 1, color)]


def make(name):
    """Returns (Grid, scale) for a sprite name."""
    g16 = Grid(16, 16)
    if name == 'brand/app-icon':
        g16.rects([(1, 0, 14, 1, 'P'), (1, 15, 14, 1, 'P'), (0, 1, 1, 14, 'P'), (15, 1, 1, 14, 'P'), (1, 1, 14, 14, 'T'),
                   (1, 1, 14, 2, 'U'), (4, 10, 4, 3, 'G'), (4, 13, 4, 1, 'P'), (8, 3, 1, 10, 'P'), (9, 3, 3, 1, 'P'),
                   (11, 4, 1, 3, 'P'), (12, 9, 1, 3, 'F'), (11, 10, 3, 1, 'F')])
        return g16, 2
    if name == 'mic/idle':
        g16.rects(MIC)
        return g16, 2
    if name == 'mic/listening':
        g16.rects(MIC + [(0, 6, 1, 4, 'C'), (15, 6, 1, 4, 'C'), (1, 4, 1, 1, 'C'), (14, 4, 1, 1, 'C')])
        return g16, 2
    if name == 'mic/off':
        faded = {'G': 'Y', 'H': 'F', 'S': 'Z'}
        g16.rects([(x, y, w, h, faded.get(k, k)) for x, y, w, h, k in MIC])
        g16.rects([(1 + i, 1 + i, 2, 1, 'C') for i in range(14)])
        return g16, 2
    if name == 'notes/eighth':
        g16.rects(EIGHTH)
        return g16, 1
    if name == 'notes/pair':
        g16.rects([(2, 10, 3, 3, 'T'), (2, 13, 3, 1, 'P'), (1, 11, 1, 2, 'P'), (9, 8, 3, 3, 'T'), (9, 11, 3, 1, 'P'),
                   (8, 9, 1, 2, 'P'), (5, 3, 1, 8, 'P'), (12, 1, 1, 8, 'P'), (5, 2, 8, 2, 'G'), (5, 1, 8, 1, 'P'), (5, 4, 8, 1, 'P')])
        return g16, 1
    if name == 'notes/clef':
        g = Grid(16, 24)
        art = ['.......xx.......', '......xbbx......', '......xbbx......', '.....xbbbx......', '.....xbbbx......', '.....xbbbx......',
               '......xbbx......', '.....xxbbxx.....', '....xbbbbbbxx...', '...xbbxxxxxbbx..', '..xbbxx..xxbbx..', '..xbbx.....xbbx.',
               '..xbbx..xxxbbx..', '..xbbxx.xbbbx...', '...xbbxxxbbxx...', '....xxxbbxx.....', '......xbbx......', '......xbbx......',
               '......xbbx......', '....xxxbbx......', '...xbbbxbbx.....', '...xbbbx.xx.....', '....xxx.........', '................']
        keys = {'x': 'P', 'b': 'B'}
        for y, row in enumerate(art):
            for x, ch in enumerate(row[:16]):
                if ch in keys:
                    g.rect(x, y, 1, 1, keys[ch])
        return g, 1
    if name == 'ui/upload':
        g16.rects([(7, 0, 2, 1, 'T'), (6, 1, 4, 1, 'T'), (5, 2, 6, 1, 'T'), (7, 3, 2, 6, 'T'),
                   (1, 4, 6, 1, 'P'), (0, 5, 1, 10, 'P'), (1, 5, 6, 1, 'B'), (7, 5, 8, 1, 'P'), (15, 6, 1, 9, 'P'),
                   (1, 6, 14, 4, 'B'), (1, 10, 14, 5, 'W'), (1, 15, 14, 1, 'P')])
        g16.rects([(7, 0, 2, 1, 'T'), (6, 1, 4, 1, 'T'), (5, 2, 6, 1, 'T'), (7, 3, 2, 6, 'T')])   # arrow on top of the folder
        return g16, 2
    if name == 'ui/file-audio':
        g16.rects([(2, 0, 12, 16, 'P'), (3, 1, 10, 14, 'A'), (10, 1, 3, 3, 'F'), (10, 1, 1, 3, 'P'), (10, 3, 3, 1, 'P'),
                   (8, 6, 1, 5, 'P'), (9, 6, 2, 1, 'P'), (6, 10, 2, 2, 'P'), (4, 13, 8, 1, 'C')])
        return g16, 2
    if name == 'ui/play':
        for y in range(2, 14):
            width = 2 + min(y - 2, 13 - y) * 2
            g16.rect(4, y, width, 1, 'P')
            if 2 < y < 13:
                g16.rect(5, y, max(width - 2, 0), 1, 'G')
        return g16, 1
    if name == 'ui/pause':
        g16.rects([(3, 2, 4, 12, 'P'), (4, 3, 2, 10, 'G'), (9, 2, 4, 12, 'P'), (10, 3, 2, 10, 'G')])
        return g16, 1
    if name == 'ui/export-csv':
        g16.rects(doc('T'))
        return g16, 1
    if name == 'ui/export-xls':
        g16.rects(doc('G'))
        return g16, 1
    if name == 'ui/export-txt':
        g16.rects(doc('C'))
        return g16, 1
    if name == 'ui/check':
        g16.circle(8, 8, 7.4, 'M', 'P')
        g16.rects([(4, 8, 2, 1, 'T'), (5, 9, 2, 1, 'T'), (6, 10, 2, 1, 'T'), (7, 9, 2, 1, 'T'), (8, 8, 2, 1, 'T'), (9, 7, 2, 1, 'T'), (10, 6, 2, 1, 'T')])
        return g16, 1
    if name == 'ui/alert':
        g16.circle(8, 8, 7.4, 'C', 'P')
        g16.rects([(7, 4, 2, 5, 'F'), (7, 10, 2, 2, 'F')])
        return g16, 1
    if name == 'ui/sun':
        g16.rects([(5, 5, 6, 6, 'G'), (7, 1, 2, 3, 'G'), (7, 12, 2, 3, 'G'), (1, 7, 3, 2, 'G'), (12, 7, 3, 2, 'G'),
                   (3, 3, 2, 2, 'G'), (11, 3, 2, 2, 'G'), (3, 11, 2, 2, 'G'), (11, 11, 2, 2, 'G')])
        return g16, 1
    if name == 'ui/moon':
        for y in range(16):
            for x in range(16):
                if ((x + 0.5 - 7) ** 2 + (y + 0.5 - 8) ** 2) ** 0.5 <= 6 and ((x + 0.5 - 10) ** 2 + (y + 0.5 - 6) ** 2) ** 0.5 > 5:
                    g16.rect(x, y, 1, 1, 'G')
        return g16, 1
    if name in ('ui/loading-1', 'ui/loading-2'):
        g16.rects(EIGHTH + [(12, 1, 1, 3, 'C'), (11, 2, 3, 1, 'C'), (2, 5, 1, 1, 'C')])
        if name.endswith('2'):
            g16.flip_h()
        return g16, 1
    raise SystemExit('no stand-in drawing for ' + name)


def main():
    with open(os.path.join(PIXEL, 'sprites.json'), encoding='utf-8') as fh:
        sprites = json.load(fh)
    for name, (w, h) in sprites.items():
        grid, scale = make(name)
        if (grid.w * scale, grid.h * scale) != (w, h):
            raise SystemExit('%s: stand-in is %dx%d but sprites.json says %dx%d' % (name, grid.w * scale, grid.h * scale, w, h))
        path = os.path.join(PIXEL, '_placeholder', name + '.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as out:
            out.write(grid.png(scale))
    print('wrote %d stand-ins to static/pixel/_placeholder/' % len(sprites))


if __name__ == '__main__':
    main()
