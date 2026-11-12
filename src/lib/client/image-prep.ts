// Screenshots get ready for the AI in the browser: a sensible size, JPEG, and a long scrolling screenshot cut into
// readable slices (a 1080 x 6000 chat shrunk to fit one picture would be too small to read).

const MAX_W = 1280;
const SLICE_H = 1800;
const OVERLAP = 120; // a message cut at a slice edge appears whole in one of them

/** One file into one or more JPEG data URLs, at most `max`. Throws a plain message for files it cannot open. */
export async function prepImage(file: File, max = 4): Promise<string[]> {
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name || "That image"} could not be opened${/heic|heif/i.test(file.type + file.name) ? " (HEIC photo)" : ""}. Take a screenshot instead, or save it as JPEG or PNG.`);
  }
  const scale = Math.min(1, MAX_W / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const tops: number[] = [];
  if (h <= SLICE_H * 1.25) tops.push(0);
  else for (let y = 0; y < h && tops.length < max; y += SLICE_H - OVERLAP) tops.push(Math.min(y, Math.max(0, h - SLICE_H)));
  const out: string[] = [];
  for (const top of [...new Set(tops)]) {
    const sh = Math.min(h - top, tops.length === 1 ? h : SLICE_H);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNGs read badly on black
    ctx.fillRect(0, 0, w, sh);
    ctx.drawImage(img, 0, top / scale, img.width, sh / scale, 0, 0, w, sh);
    out.push(c.toDataURL("image/jpeg", 0.85));
  }
  img.close?.();
  return out;
}

/** Several files, in order, up to `max` pictures in all. Returns the pictures and any files that could not be used. */
export async function prepImages(files: File[], max = 4): Promise<{ urls: string[]; errors: string[] }> {
  const urls: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (urls.length >= max) break;
    try {
      urls.push(...(await prepImage(f, max - urls.length)));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { urls: urls.slice(0, max), errors };
}
