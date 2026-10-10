/** Generates original SVG placeholder product images (no third-party assets, works under a strict CSP). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { products } from '../prisma/seed-data';

const outDir = join(__dirname, '..', '..', 'web', 'public', 'products');
mkdirSync(outDir, { recursive: true });
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

for (const p of products) {
  const initials = p.name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${esc(p.name)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${p.hue} 70% 92%)"/><stop offset="1" stop-color="hsl(${(p.hue + 40) % 360} 65% 78%)"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
<circle cx="300" cy="270" r="150" fill="hsl(${p.hue} 55% 38%)" opacity="0.9"/>
<text x="300" y="305" font-family="Arial, Helvetica, sans-serif" font-size="110" font-weight="700" text-anchor="middle" fill="#fff">${esc(initials)}</text>
<text x="300" y="500" font-family="Arial, Helvetica, sans-serif" font-size="30" text-anchor="middle" fill="hsl(${p.hue} 45% 22%)">${esc(p.brand)}</text>
</svg>`;
  writeFileSync(join(outDir, `${p.sku}.svg`), svg);
}
console.log(`Generated ${products.length} product images in ${outDir}`);
