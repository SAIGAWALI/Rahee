// Crops the six printed character cards (Pilgrim, Conservationist, Riverkeeper,
// Musician, Historian, Explorer) out of the printed RAHEE board
// (Rahee-A-fincurve.pdf) into one PNG per character, shown to a player when they
// choose or are handed their character in the digital game.
//
//   node make-cards.mjs <mupdfDir> <boardPdf> <outDir>
//
// mupdfDir is a directory containing node_modules/mupdf. Rendering is a one-time
// asset step; the resulting PNGs are checked in and the game never needs mupdf.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodePNG, encodePNG } from "./png.mjs";

const [mupdfDir, boardPdf, outDir] = process.argv.slice(2);
const mupdf = await import(pathToFileURL(path.join(mupdfDir, "node_modules/mupdf/dist/mupdf.js")).href);

// The card row sits above the map plate (PLATE.y0 = 515pt in make-plate.mjs),
// rendered at a higher scale than the plate since each card is read on its own.
const STRIP = { x0: 0, y0: 0, x1: 1382, y1: 520, scale: 3 };

// Each card's box within the rendered strip, in strip pixels: [x0, y0, x1, y1].
// The six cards run left to right in the same order as CHARACTERS in
// build-board.mjs, and share one card id list here for that reason.
const CARDS = [
  ["pilgrim", 105, 108, 758, 878],
  ["conservationist", 766, 108, 1420, 878],
  ["riverkeeper", 1428, 108, 2078, 878],
  ["musician", 2088, 108, 2738, 878],
  ["historian", 2747, 108, 3398, 878],
  ["explorer", 3408, 108, 4058, 878],
];

const doc = mupdf.Document.openDocument(fs.readFileSync(boardPdf), "application/pdf");
const page = doc.loadPage(0);
const list = page.toDisplayList();

const s = STRIP.scale;
const bbox = [STRIP.x0 * s, STRIP.y0 * s, STRIP.x1 * s, STRIP.y1 * s].map(Math.round);
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
pix.clear(255);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(s, s), pix);
list.run(dev, mupdf.Matrix.identity);
dev.close();

const strip = decodePNG(Buffer.from(pix.asPNG()));

fs.mkdirSync(outDir, { recursive: true });
for (const [id, x0, y0, x1, y1] of CARDS) {
  const w = x1 - x0, h = y1 - y0;
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s2 = ((y0 + y) * strip.width + (x0 + x)) * 4, d = (y * w + x) * 4;
      img.data[d] = strip.data[s2]; img.data[d + 1] = strip.data[s2 + 1];
      img.data[d + 2] = strip.data[s2 + 2]; img.data[d + 3] = 255;
    }
  fs.writeFileSync(path.join(outDir, `${id}.png`), encodePNG(img));
  console.log(`${id}.png ${w}x${h}`);
}
