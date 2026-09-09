// Renders the map area of the printed RAHEE board (RaheeA-Fincurve.pdf) into a
// background plate PNG, erasing the printed furniture that sits over the map
// (suit legend, QR code, credit text) since the digital UI renders those itself.
//
//   node make-plate.mjs <mupdfDir> <boardPdf> <outDir> [--grid]
//
// mupdfDir is a directory containing node_modules/mupdf. Rendering is a one-time
// asset step; the resulting PNG is checked in and the game never needs mupdf.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodePNG } from "./png.mjs";

const [mupdfDir, boardPdf, outDir] = process.argv.slice(2);
const wantGrid = process.argv.includes("--grid");
const mupdf = await import(pathToFileURL(path.join(mupdfDir, "node_modules/mupdf/dist/mupdf.js")).href);

// Region of the printed sheet holding the map, in PDF points, and the render scale.
export const PLATE = { x0: 20, y0: 515, x1: 1010, y1: 1728, scale: 2 };

// Printed furniture to paint out, in plate pixels: [x0, y0, x1, y1].
// Only the two blocks that are not part of the map itself are painted out. The
// printed credit line and licence badges down the left margin are left alone:
// they are attribution, and the Porbandar-Veraval road runs close beside them.
const ERASE = [
  [0, 0, 430, 140],      // "Learn to play" QR block
  [1270, 0, 1980, 515],  // Language + Food suit-legend cards
];
const CREAM = [250, 247, 233];

const doc = mupdf.Document.openDocument(fs.readFileSync(boardPdf), "application/pdf");
const page = doc.loadPage(0);
const list = page.toDisplayList();

const s = PLATE.scale;
const bbox = [PLATE.x0 * s, PLATE.y0 * s, PLATE.x1 * s, PLATE.y1 * s].map(Math.round);
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
pix.clear(255);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(s, s), pix);
list.run(dev, mupdf.Matrix.identity);
dev.close();

const width = pix.getWidth(), height = pix.getHeight();
const src = pix.getPixels();
const img = { width, height, data: Buffer.alloc(width * height * 4) };
for (let i = 0, n = width * height; i < n; i++) {
  img.data[i * 4] = src[i * 3];
  img.data[i * 4 + 1] = src[i * 3 + 1];
  img.data[i * 4 + 2] = src[i * 3 + 2];
  img.data[i * 4 + 3] = 255;
}

const fill = (x0, y0, x1, y1, [r, g, b]) => {
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const d = (y * width + x) * 4;
      img.data[d] = r; img.data[d + 1] = g; img.data[d + 2] = b;
    }
};
for (const r of ERASE) fill(...r, CREAM);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "board-plate.png"), encodePNG(img));
console.log(`board-plate.png ${width}x${height}  (pdf ${PLATE.x0},${PLATE.y0} .. ${PLATE.x1},${PLATE.y1} @${s}x)`);

if (wantGrid) {
  // Debug copy with a 100px grid so map features can be read off in plate pixels.
  for (let x = 0; x < width; x += 100) fill(x, 0, x + (x % 500 ? 1 : 3), height, x % 500 ? [255, 0, 0] : [0, 0, 255]);
  for (let y = 0; y < height; y += 100) fill(0, y, width, y + (y % 500 ? 1 : 3), y % 500 ? [255, 0, 0] : [0, 0, 255]);
  fs.writeFileSync(path.join(outDir, "board-plate-grid.png"), encodePNG(img));
  console.log("board-plate-grid.png (debug)");
}
