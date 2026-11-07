// Generates the PWA and touch icons from the Daybook mark (same geometry as public/logo.svg and
// src/components/logo.tsx). Renders with Playwright's Chromium, which is not a project dependency:
//   node scripts/make-icons.mjs        (needs `playwright` resolvable, e.g. installed globally)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is needed to render the icons (npm i -g playwright).");
  process.exit(1);
}

const GRAD = '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient>';
const GLYPH = '<path d="M18 13h13.5a19 19 0 0 1 0 38H18z" fill="#fff"/><path d="M25 39.6a7.2 7.2 0 0 1 14.4 0z" fill="#000"/><rect x="22" y="41.2" width="20.5" height="2.6" rx="1.3" fill="#000"/><path d="M32.2 26.2v2.6M24.4 29.6l1.8 1.8M40 29.6l-1.8 1.8" stroke="#000" stroke-width="2.4" stroke-linecap="round"/>';

/** rounded: a tile with transparent corners. full-bleed: the platform rounds or masks it; `scale` keeps the glyph in the safe zone. */
function svg({ rounded, scale = 1 }) {
  const t = `translate(32 32) scale(${scale}) translate(-32 -32)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRAD}<mask id="m"><g transform="${t}">${GLYPH}</g></mask></defs>`
    + `<rect width="64" height="64" ${rounded ? 'rx="14"' : ""} fill="url(#g)"/><rect width="64" height="64" fill="#fff" mask="url(#m)"/></svg>`;
}

const ICONS = [
  ["icon-192.png", 192, { rounded: true }],
  ["icon-512.png", 512, { rounded: true }],
  ["icon-maskable-512.png", 512, { rounded: false, scale: 0.78 }], // Android crops to a circle: keep the D inside the 80% safe zone
  ["apple-touch-icon.png", 180, { rounded: false, scale: 0.9 }], // iOS rounds the corners itself
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, opts] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(opts).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  fs.writeFileSync(path.join(root, "public", name), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log("wrote", name);
}
await browser.close();
