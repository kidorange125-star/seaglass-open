// Redraws everything made from the Seaglass mark (src/client/logo.ts): the favicon, the app icons and the mark in the boot
// screen in index.html. Run after changing logo.ts: npm run icons
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { LOGO_COLORS, logoSvg } from "../src/client/logo.ts";

const root = join(import.meta.dirname, "..");
const pub = (f) => join(root, "public", f);

// favicon: the mark alone, cropped close
writeFileSync(pub("icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 4.5 54 54">${logoSvg("f")}</svg>\n`);

// app icons: the mark on deep sea water. `mark` is its share of the tile (maskable icons keep it inside the safe circle).
const tile = (px, mark) => {
  const m = 64 / mark, o = (m - 64) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-o} ${-o + 0.6} ${m} ${m}"><rect x="${-o}" y="${-o + 0.6}" width="${m}" height="${m}" fill="${LOGO_COLORS.tile}"/>${logoSvg("t")}</svg>`;
};
for (const [file, px, mark] of [["apple-touch-icon.png", 180, 0.74], ["icon-192.png", 192, 0.74], ["icon-512.png", 512, 0.74], ["icon-maskable-512.png", 512, 0.58]]) {
  await sharp(Buffer.from(tile(px, mark))).png().toFile(pub(file));
}

// the boot screen's mark, between the markers in index.html, with class names on its parts for the animation
const html = join(root, "index.html");
const page = readFileSync(html, "utf8");
const start = "<!-- boot:mark -->", end = "<!-- /boot:mark -->";
const a = page.indexOf(start), b = page.indexOf(end);
if (a < 0 || b < a) throw new Error("index.html is missing the boot:mark markers");
writeFileSync(html, `${page.slice(0, a + start.length)}<svg class="boot-mark" viewBox="0 0 64 64" aria-hidden="true">${logoSvg("boot-clip", true)}</svg>${page.slice(b)}`);
console.log("icons and boot mark redrawn");
