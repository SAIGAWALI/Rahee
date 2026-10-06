// Minimal zero-dependency PNG reader/writer.
// Handles the 8-bit RGB/RGBA/greyscale non-interlaced cases we produce and consume.
import zlib from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decode a PNG buffer into {width, height, data} where data is RGBA bytes. */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error("only 8-bit PNGs supported, got " + depth);
  if (interlace) throw new Error("interlaced PNGs not supported");

  const nch = colorType === 3 ? 1 : CHANNELS[colorType];
  if (!nch) throw new Error("unsupported colour type " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * nch;
  const px = Buffer.alloc(height * stride);

  // Undo per-scanline filtering.
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= nch ? out[i - nch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= nch ? prev[i - nch] : 0;
      let v = line[i];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      out[i] = v & 0xff;
    }
  }

  // Expand to RGBA.
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * nch, d = i * 4;
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = px[s]; }
    else if (colorType === 4) { r = g = b = px[s]; a = px[s + 1]; }
    else if (colorType === 2) { r = px[s]; g = px[s + 1]; b = px[s + 2]; }
    else if (colorType === 6) { r = px[s]; g = px[s + 1]; b = px[s + 2]; a = px[s + 3]; }
    else { const p = px[s] * 3; r = palette[p]; g = palette[p + 1]; b = palette[p + 2]; if (trns && px[s] < trns.length) a = trns[px[s]]; }
    data[d] = r; data[d + 1] = g; data[d + 2] = b; data[d + 3] = a;
  }
  return { width, height, data };
}

/** Encode {width, height, data (RGBA)} as a PNG buffer. */
export function encodePNG({ width, height, data }, { rgb = true, level = 9 } = {}) {
  const nch = rgb ? 3 : 4;
  const stride = width * nch;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    const out = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = x * nch;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
      if (!rgb) out[d + 3] = data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = rgb ? 2 : 6;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
