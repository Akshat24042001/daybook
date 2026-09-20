// Generates the PWA icons (a notebook page with a green highlighter line) with no image dependencies.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// signed distance to a rounded rectangle centred at (cx, cy)
const rrect = (px, py, cx, cy, hw, hh, r) => {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};

function render(size, { maskable }) {
  const S = 3; // supersampling
  const bg = [21, 94, 70];
  const page = [250, 247, 240];
  const ink = [40, 34, 28];
  const hl = [178, 235, 120];
  const u = size / 100;
  return png(size, (x, y) => {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const px = (x + (sx + 0.5) / S) / u;
        const py = (y + (sy + 0.5) / S) / u;
        let col = null;
        // background (full bleed when maskable, rounded tile otherwise)
        if (maskable || rrect(px, py, 50, 50, 50, 50, 22) < 0) col = bg;
        if (col) {
          const pageScale = maskable ? 0.78 : 1;
          const cx = 50, cy = 50;
          const t = (v, c) => c + (v - c) / pageScale;
          const qx = t(px, cx), qy = t(py, cy);
          if (rrect(qx, qy, 50, 50, 29, 35, 6) < 0) {
            col = page;
            // highlighter under the first line
            if (Math.abs(qy - 38) < 4.6 && qx > 30 && qx < 70) col = hl;
            // ink lines
            for (const ly of [38, 52, 66]) {
              if (Math.abs(qy - ly) < 1.3 && qx > 32 && qx < (ly === 66 ? 56 : 68)) col = ink;
            }
          }
        }
        if (col) {
          acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255;
        }
      }
    }
    const n = S * S;
    const a = acc[3] / n;
    if (a === 0) return [0, 0, 0, 0];
    const cnt = acc[3] / 255;
    return [Math.round(acc[0] / cnt), Math.round(acc[1] / cnt), Math.round(acc[2] / cnt), Math.round(a)];
  });
}

const out = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon-192.png"), render(192, { maskable: false }));
fs.writeFileSync(path.join(out, "icon-512.png"), render(512, { maskable: false }));
fs.writeFileSync(path.join(out, "icon-maskable-512.png"), render(512, { maskable: true }));
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), render(180, { maskable: true }));
console.log("icons written to public/");
