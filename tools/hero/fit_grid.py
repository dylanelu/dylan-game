from PIL import Image
import numpy as np
im = np.asarray(Image.open('reference.webp').convert('RGBA')).astype(float)
rgb = im[..., :3] * (im[..., 3:] / 255) + 255 * (1 - im[..., 3:] / 255)  # composite on white for analysis
x0, x1, y0, y1 = 224, 797, 109, 1503

def cost_axis(axis, p, off):
    # within-cell variance along one axis: compare each line to its cell's center line
    lo, hi = (x0, x1) if axis == 1 else (y0, y1)
    tot, n = 0.0, 0
    k = 0
    while True:
        a = off + lo + k * p; b = a + p
        if b > hi: break
        ia, ib = int(round(a)), int(round(b))
        c = int(round((a + b) / 2))
        if axis == 1:
            seg = rgb[y0:y1, ia + 2:ib - 1]; ref = rgb[y0:y1, c:c + 1]
        else:
            seg = rgb[ia + 2:ib - 1, x0:x1]; ref = rgb[c:c + 1, x0:x1]
        tot += np.abs(seg - ref).mean(); n += 1; k += 1
    return tot / max(n, 1)

best = {}
for axis in (1, 0):
    res = []
    for p in np.arange(21.5, 25.0, 0.1):
        for off in np.arange(-p / 2, p / 2, 1.0):
            res.append((cost_axis(axis, p, off), round(p, 2), off))
    res.sort(); best[axis] = res[0]; print('axis', axis, res[:4])
