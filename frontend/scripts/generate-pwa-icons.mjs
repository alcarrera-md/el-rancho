import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const output = new URL('../public/icons/', import.meta.url);

const colors = {
  green: [31, 57, 40, 255], cream: [244, 240, 230, 255], gold: [222, 188, 105, 255],
};

function setPixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  color.forEach((value, offset) => { png.data[index + offset] = value; });
}

function fillCircle(png, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(png, x, y, color);
    }
  }
}

function line(png, x1, y1, x2, y2, width, color) {
  const minX = Math.floor(Math.min(x1, x2) - width); const maxX = Math.ceil(Math.max(x1, x2) + width);
  const minY = Math.floor(Math.min(y1, y2) - width); const maxY = Math.ceil(Math.max(y1, y2) + width);
  const dx = x2 - x1; const dy = y2 - y1; const length = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const t = length ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0;
    if ((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2 <= (width / 2) ** 2) setPixel(png, x, y, color);
  }
}

function icon(size) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) setPixel(png, x, y, colors.green);
  fillCircle(png, size * 0.75, size * 0.25, size * 0.075, colors.gold);
  const s = size / 28; const w = Math.max(5, size * 0.025);
  [[3,21,25,21],[5,21,5,14],[5,14,9,11],[9,11,9,21],[11,15,25,15],[17,15,17,21],[23,15,23,21],[11,10,8.5,7],[17,10,19.5,7],[11,10,17,10]].forEach(([a,b,c,d]) => line(png,a*s,b*s,c*s,d*s,w,colors.cream));
  fillCircle(png, 13*s, 10.6*s, Math.max(2, size * 0.008), colors.gold);
  fillCircle(png, 15*s, 10.6*s, Math.max(2, size * 0.008), colors.gold);
  line(png, 11.5*s, 11*s, 14*s, 13*s, w * 0.75, colors.cream);
  line(png, 16.5*s, 11*s, 14*s, 13*s, w * 0.75, colors.cream);
  return PNG.sync.write(png);
}

await mkdir(output, { recursive: true });
for (const size of [192, 512]) await writeFile(new URL(`el-rancho-${size}.png`, output), icon(size));
console.log('Iconos PWA generados: 192 px y 512 px');
