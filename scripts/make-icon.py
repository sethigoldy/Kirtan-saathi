"""Draws the app icon (original artwork): sound waves feeding a highlighted
line of text. Writes build/icon.png (1024), build/icon.ico and build/icon.icns.
Run: python3 scripts/make-icon.py  (needs Pillow)"""
from PIL import Image, ImageDraw

S = 2048  # draw at 2x, downsample for smooth edges
NAVY_TOP, NAVY_BOTTOM = (24, 44, 104), (10, 20, 52)
SAFFRON = (255, 162, 46)
LINE = (150, 162, 204)  # muted lines (solid: alpha would cut holes in the icon)


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# Rounded square with a vertical gradient (macOS-style margin so it sits
# well next to other dock icons; still fills most of a Windows tile).
m, r = 120, 420
grad = Image.new('RGBA', (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    gd.line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(NAVY_TOP, NAVY_BOTTOM)) + (255,))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([m, m, S - m, S - m], radius=r, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
cx, cy = 530, S // 2
# Source dot and three sound arcs opening to the right.
d.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], fill=SAFFRON)
for i, rad in enumerate((200, 330, 460)):
    w = 64
    d.arc([cx - rad, cy - rad, cx + rad, cy + rad], start=-48, end=48, fill=mix(SAFFRON, (255, 214, 150), i * 0.35), width=w)

# Three lines of text; the live line is highlighted.
x0, h = 1090, 112
for y, length, colour in ((cy - 260, 420, LINE), (cy, 540, SAFFRON), (cy + 260, 360, LINE)):
    d.rounded_rectangle([x0, y - h // 2, x0 + length, y + h // 2], radius=h // 2, fill=colour)

icon = img.resize((1024, 1024), Image.LANCZOS)
icon.save('build/icon.png')
icon.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
icon.save('build/icon.icns')
print('wrote build/icon.png, build/icon.ico, build/icon.icns')
