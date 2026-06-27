import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');

const maskableSvg = svg.replace(
  '<rect width="64" height="64" rx="14" fill="#0f172a"/>',
  '<rect width="64" height="64" rx="0" fill="#0f172a"/><g transform="translate(8,8) scale(0.75)">',
).replace('</svg>', '</g></svg>');

function render(source, size, outPath) {
  const r = new Resvg(source, {
    fitTo: { mode: 'width', value: size },
    background: '#0f172a',
  });
  writeFileSync(join(root, outPath), r.render().asPng());
  console.log(`wrote ${outPath} (${size}x${size})`);
}

render(svg, 192, 'public/icon-192.png');
render(svg, 512, 'public/icon-512.png');
render(svg, 180, 'public/apple-touch-icon.png');
render(maskableSvg, 512, 'public/icon-512-maskable.png');
