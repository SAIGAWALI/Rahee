// Renders the map out of the printed RAHEE board PDF into a background plate
// PNG. Most source PDFs (the current one included) are just the map with
// nothing else on the page, so the whole page is used as-is.
// `Rahee-A-fincurve.pdf` (superseded) was a full board sheet with the map
// cropped out of one corner and some printed furniture (QR code, suit-legend
// cards) painted over — that config is kept here only so the earlier build
// stays reproducible.
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

const SCALE = 2;

// Per-source crop region (PDF points) and furniture to paint over. A source
// not listed here is assumed to already be just the map — the whole page is
// used, nothing is erased.
const SOURCES = {
  "Rahee-A-fincurve.pdf": {
    region: [20, 515, 1010, 1728],
    erase: [
      [0, 0, 385, 140],      // "Learn to play" QR block
      [1270, 0, 1980, 515],  // Language + Food suit-legend cards
    ],
    // Sampled from the plate's own blank background, not guessed — a
    // mismatched fill here shows up as a visible seam.
    cream: [250, 243, 212],
  },
};

const doc = mupdf.Document.openDocument(fs.readFileSync(boardPdf), "application/pdf");
const page = doc.loadPage(0);
const list = page.toDisplayList();
const pageBounds = page.getBounds(); // [x0, y0, x1, y1] in PDF points

const config = SOURCES[path.basename(boardPdf)];
const region = config?.region ?? pageBounds;
const erase = config?.erase ?? [];

const bbox = [region[0] * SCALE, region[1] * SCALE, region[2] * SCALE, region[3] * SCALE].map(Math.round);
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
pix.clear(255);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(SCALE, SCALE), pix);
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
for (const r of erase) fill(...r, config.cream);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "board-plate.png"), encodePNG(img));
console.log(`board-plate.png ${width}x${height}  (pdf ${region.join(",")} @${SCALE}x)`);

if (wantGrid) {
  // Debug copy with a 100px grid so map features can be read off in plate pixels.
  for (let x = 0; x < width; x += 100) fill(x, 0, x + (x % 500 ? 1 : 3), height, x % 500 ? [255, 0, 0] : [0, 0, 255]);
  for (let y = 0; y < height; y += 100) fill(0, y, width, y + (y % 500 ? 1 : 3), y % 500 ? [255, 0, 0] : [0, 0, 255]);
  fs.writeFileSync(path.join(outDir, "board-plate-grid.png"), encodePNG(img));
  console.log("board-plate-grid.png (debug)");
}
