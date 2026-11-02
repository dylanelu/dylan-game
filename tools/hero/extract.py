from PIL import Image
import numpy as np
from collections import Counter
src = Image.open('reference.webp').convert('RGBA')
im = np.asarray(src).astype(int)
PX, OX = 22.95, 224 - 4.45
PY, OY = 23.2, 109 + 3.4
cols = int((797 - OX) / PX) + 1; rows = int((1503 - OY) / PY) + 1
out = np.zeros((rows, cols, 4), np.uint8)
for r in range(rows):
    for c in range(cols):
        ya, yb = int(OY + r * PY + PY * .25), int(OY + (r + 1) * PY - PY * .25)
        xa, xb = int(OX + c * PX + PX * .25), int(OX + (c + 1) * PX - PX * .25)
        cell = im[ya:yb, xa:xb].reshape(-1, 4)
        if (cell[:, 3] > 128).mean() < .5: continue
        px = cell[cell[:, 3] > 128][:, :3]
        q = [tuple((p // 8) * 8) for p in px]
        mode = Counter(q).most_common(1)[0][0]
        sel = px[[tuple((p // 8) * 8) == mode for p in px]]
        out[r, c, :3] = np.median(sel, axis=0); out[r, c, 3] = 255
# trim
ys, xs = np.where(out[..., 3] > 0)
out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
Image.fromarray(out).save('hero-native.png')
print('native size', out.shape[1], 'x', out.shape[0])
# overlay check: grid lines on source + reconstruction side by side
from PIL import ImageDraw
chk = src.copy().convert('RGB'); bgw = Image.new('RGB', chk.size, (255, 255, 255)); bgw.paste(src, (0, 0), src); chk = bgw
d = ImageDraw.Draw(chk)
for c in range(cols + 1): d.line([(OX + c * PX, 100), (OX + c * PX, 1510)], fill=(255, 0, 80), width=1)
for r in range(rows + 1): d.line([(210, OY + r * PY), (810, OY + r * PY)], fill=(255, 0, 80), width=1)
rec = Image.fromarray(np.asarray(Image.open('hero-native.png'))).resize((round(out.shape[1] * PX), round(out.shape[0] * PY)), Image.NEAREST)
side = Image.new('RGB', (1200, 1500), (255, 255, 255))
side.paste(chk.crop((200, 90, 820, 1520)).resize((520, 1200)), (0, 0))
rb = Image.new('RGB', rec.size, (255, 255, 255)); rb.paste(rec, (0, 0), rec)
side.paste(rb.resize((int(rec.width * 1200 / rec.height * 0.98), 1180)), (640, 10))
side.save('hero-check.png')
