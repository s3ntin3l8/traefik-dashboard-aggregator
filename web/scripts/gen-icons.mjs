// gen-icons.mjs — one-off generator for the favicon / PWA icon set.
//
// NOT part of `npm run build`. The outputs are committed to web/public/, so CI
// and Docker never run this. Re-run it only when the source artwork in
// web/branding/ changes:
//
//   cd web && npm i -D --no-save sharp png-to-ico && node scripts/gen-icons.mjs
//
// Sources : web/branding/icon.svg (full-bleed badge), web/branding/favicon.svg
// Outputs : web/public/{favicon.svg, favicon.ico, apple-touch-icon.png,
//                       pwa-192x192.png, pwa-512x512.png, pwa-maskable-512x512.png}

import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const branding = join(root, "branding");
const out = join(root, "public");

const iconSvg = await readFile(join(branding, "icon.svg"));
const faviconSvg = join(branding, "favicon.svg");

await mkdir(out, { recursive: true });

const png = (svg, size) =>
  sharp(svg, { density: 384 }).resize(size, size, { fit: "contain" }).png().toBuffer();

// Plain "any" PWA icons — rendered straight from the full-bleed badge (their
// transparent corners are fine; the OS/launcher decides masking).
const p192 = await png(iconSvg, 192);
const p512 = await png(iconSvg, 512);
// 1024 "any" icon: Android 12+ displays the PWA splash logo at ~288dp, which is
// 576-1152px on 2x-4x screens — a 512 source upscales (blurry). The 1024 lets
// Chrome pick a source large enough to render the splash crisply.
const p1024 = await png(iconSvg, 1024);

// apple-touch must be opaque — iOS composites it on black and applies its own
// corner mask, so flatten the badge's transparent corners onto the accent.
const apple = await sharp(iconSvg, { density: 384 })
  .resize(180, 180, { fit: "contain" })
  .flatten({ background: "#7c6cff" })
  .png()
  .toBuffer();

// Maskable: the badge inset onto a solid-accent full-bleed square so the mark
// stays inside Android's ~80% safe zone after the platform mask crops corners.
// Generated at 512 and 1024 (Android 12+ may use the maskable for the large
// splash logo, which upscales a 512 source on high-density screens).
const maskablePng = async (size) => {
  const inset = await sharp(iconSvg, { density: 384 })
    .resize(Math.round(size * 0.8), Math.round(size * 0.8), {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: "#7c6cff" },
  })
    .composite([{ input: inset, gravity: "center" }])
    .png()
    .toBuffer();
};
const maskable = await maskablePng(512);
const maskable1024 = await maskablePng(1024);

// favicon.ico from the small-tuned favicon mark at 16 + 32.
const ico = await pngToIco([
  await png(faviconSvg, 32),
  await png(faviconSvg, 16),
]);

await copyFile(faviconSvg, join(out, "favicon.svg"));
await writeFile(join(out, "favicon.ico"), ico);
await writeFile(join(out, "apple-touch-icon.png"), apple);
await writeFile(join(out, "pwa-192x192.png"), p192);
await writeFile(join(out, "pwa-512x512.png"), p512);
await writeFile(join(out, "pwa-1024x1024.png"), p1024);
await writeFile(join(out, "pwa-maskable-512x512.png"), maskable);
await writeFile(join(out, "pwa-maskable-1024x1024.png"), maskable1024);

console.log("icons written to web/public/");
