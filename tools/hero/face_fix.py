"""Hand touch-ups applied on top of the grid extraction. The source face was drawn at
half-cell resolution, so these rows are redrawn on the 25×60 grid by hand."""
from PIL import Image
import numpy as np
COL = {'K': (0, 0, 1), 'S': (254, 190, 132), 's': (216, 131, 77), 'W': (236, 236, 244), 'h': (25, 27, 61)}
FIX = {
    15: "....KKhKKKKSSSKKKKsKK....",
    16: "...KSSKSKKKSSSKKKSKSSK...",
    17: "...KSsKSWKKSSSKKWSKsSK...",
    18: "....KSsSSKSSSSSKSSsK.....",
    19: ".....KKSSSSSsSSSSSSK.....",
    21: "......KKSSSKKKSSSKK......",
}
a = np.asarray(Image.open('hero-native.png').convert('RGBA')).copy()
for y, row in FIX.items():
    assert len(row) == a.shape[1], (y, len(row))
    for x, ch in enumerate(row):
        if ch == '.': a[y, x] = 0
        else: a[y, x] = (*COL[ch], 255)
Image.fromarray(a).save('../../public/assets/hero.png')
