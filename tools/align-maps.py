"""Fits the new clean maps ("Rahee elements for online version") to the board.

The two PNGs from Prof. Parvathy are the same artwork as the printed board, redrawn
without illustrations and turned by about 9 degrees. This finds every node on the
"only nodes" map (black discs = plain cities, cream rings = tourist places), matches
each to a city in frontend/data/board.json with an affine fit refined by optimal
assignment, and prints the plate -> image transform that tools/add-artwork.mjs stores
as maps[].fromPlate. The "with names" map is the same image shifted by (33, 12) px.

  python3 tools/align-maps.py <"Raheemap-only nodes.png"> frontend/data/board.json [outWidth=2200]

Needs numpy, scipy, opencv-python and Pillow. Result on the delivered files: all 101
cities within 2 px except Pune (13 px), plus one unnamed node between Siliguri and
Guwahati that is not in the board data (see README, open questions).
"""
import sys, json
import numpy as np, cv2
from PIL import Image
from scipy.optimize import linear_sum_assignment

img_path, board_path = sys.argv[1], sys.argv[2]
out_w = int(sys.argv[3]) if len(sys.argv) > 3 else 2200
a = np.array(Image.open(img_path).convert("RGB")).astype(int)
mask = ((a[..., 0] < 90) & (a[..., 1] < 90) & (a[..., 2] < 90)).astype(np.uint8)
n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
rings, dots = [], []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if not (20 <= w <= 110 and 20 <= h <= 110) or abs(w - h) > 0.2 * max(w, h):
        continue
    fill = area / (w * h)
    if fill > 0.6: dots.append((x + w / 2, y + h / 2))
    elif fill < 0.35 and 50 <= max(w, h) <= 70: rings.append((x + w / 2, y + h / 2))

board = json.load(open(board_path))
cities = board["cities"]
by = {c["id"]: c for c in cities}
def fit(src, dst):
    A = np.hstack([np.array(src, float), np.ones((len(src), 1))])
    return np.linalg.lstsq(A, np.array(dst, float), rcond=None)[0]
# rough starting anchors (read off the image by eye), then iterate
k = a.shape[1] / 1400
anch = {"kanniyakumari": (476, 1323), "great-nicobar": (1245, 1293), "leh": (355, 183), "bhuj": (67, 692)}
M = fit([(by[i]["x"], by[i]["y"]) for i in anch], [(u * k, v * k) for u, v in anch.values()])
for _ in range(6):
    src, dst, err = [], [], {}
    for tourist, nodes in ((True, rings), (False, dots)):
        cs = [c for c in cities if bool(c.get("tourist")) == tourist]
        P = np.array([[c["x"], c["y"], 1] for c in cs]) @ M
        N = np.array(nodes)
        C = np.linalg.norm(P[:, None] - N[None], axis=2)
        r, j = linear_sum_assignment(C)
        for i1, j1 in zip(r, j):
            src.append((cs[i1]["x"], cs[i1]["y"])); dst.append(tuple(N[j1])); err[cs[i1]["id"]] = C[i1, j1]
    M = fit(src, dst)
worst = sorted(err.items(), key=lambda kv: -kv[1])[:5]
TOL = 15.0  # px on the full-size image (a node is about 40-60 px across)
ok = sum(1 for e in err.values() if e <= TOL)
print(f"cities matched to a node: {ok} of {len(cities)} within {TOL:.0f} px (largest offset {max(err.values()):.1f} px)")
print("largest offsets (px):", ", ".join(f"{c} {float(e):.1f}" for c, e in worst))
print("PASS" if ok == len(cities) else f"FAIL: {len(cities) - ok} cities not matched")
s = out_w / a.shape[1]
print("fromPlate (SVG a,b,c,d,e,f) for a", out_w, "px wide copy:",
      [round(float(v), 6) for v in (M[0, 0] * s, M[0, 1] * s, M[1, 0] * s, M[1, 1] * s, M[2, 0] * s, M[2, 1] * s)])
