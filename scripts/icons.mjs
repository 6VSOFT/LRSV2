// 由 public/roles/icon.svg 生成 PWA 图标 PNG：node scripts/icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/roles/icon.svg', 'utf8');
const render = (size, src = svg) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync('public/icons/icon-192.png', render(192));
writeFileSync('public/icons/icon-512.png', render(512));
writeFileSync('public/icons/apple-touch-icon.png', render(180));
// maskable：在安全区内缩小图案，四周填充背景色
const inner = Buffer.from(render(410)).toString('base64');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#141838"/><image href="data:image/png;base64,${inner}" x="51" y="51" width="410" height="410"/></svg>`;
writeFileSync('public/icons/icon-512-maskable.png', render(512, maskable));
console.log('icons generated');
