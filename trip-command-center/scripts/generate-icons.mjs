// Renders the PWA icons in public/icons from the Atlas logo (public/icons/logo.svg).
// Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";

const logo = readFileSync("public/icons/logo.svg");

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await sharp(logo, { density: 300 }).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log(`public/icons/${name}`);
}
