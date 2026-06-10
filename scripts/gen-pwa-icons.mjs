/**
 * Gera os ícones PWA do Frivo a partir do FrivoMark (gradiente + floco de neve).
 * Rodar: node scripts/gen-pwa-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");

const GRAD = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0EA5E9"/>
      <stop offset="1" stop-color="#10B981"/>
    </linearGradient>
  </defs>`;

// Floco de neve centrado, escala configurável (1 = 512 base)
function floco(scale = 1, cx = 256, cy = 256) {
  const s = scale;
  const p = (v) => cx + (v - 256) * s;
  const q = (v) => cy + (v - 256) * s;
  const sw = 26 * s;
  return `
  <g stroke="white" stroke-width="${sw}" stroke-linecap="round" fill="none">
    <line x1="${p(256)}" y1="${q(115)}" x2="${p(256)}" y2="${q(397)}"/>
    <line x1="${p(115)}" y1="${q(256)}" x2="${p(397)}" y2="${q(256)}"/>
    <line x1="${p(160)}" y1="${q(160)}" x2="${p(352)}" y2="${q(352)}"/>
    <line x1="${p(352)}" y1="${q(160)}" x2="${p(160)}" y2="${q(352)}"/>
    <path d="M ${p(211)} ${q(141)} L ${p(256)} ${q(115)} L ${p(301)} ${q(141)}"/>
    <path d="M ${p(211)} ${q(371)} L ${p(256)} ${q(397)} L ${p(301)} ${q(371)}"/>
    <path d="M ${p(141)} ${q(211)} L ${p(115)} ${q(256)} L ${p(141)} ${q(301)}"/>
    <path d="M ${p(371)} ${q(211)} L ${p(397)} ${q(256)} L ${p(371)} ${q(301)}"/>
  </g>`;
}

// Ícone normal: quadrado arredondado + floco
const iconSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${GRAD}
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  ${floco(1)}
</svg>`;

// Ícone maskable: full-bleed (sem cantos) + floco em ~68% (safe zone)
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${GRAD}
  <rect width="512" height="512" fill="url(#g)"/>
  ${floco(0.68)}
</svg>`;

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const size of SIZES) {
    await sharp(Buffer.from(iconSvg)).resize(size, size).png().toFile(join(outDir, `icon-${size}.png`));
  }
  await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile(join(outDir, "icon-maskable-512.png"));
  // apple-touch-icon: fundo sólido (sem transparência nos cantos) 180x180
  await sharp(Buffer.from(iconSvg)).resize(180, 180).flatten({ background: "#0F2744" }).png().toFile(join(outDir, "apple-touch-icon.png"));

  console.log(`Ícones gerados em ${outDir}: ${SIZES.length + 2} arquivos.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
