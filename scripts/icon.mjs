import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

const size = 256;
const pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const ring = Math.abs(Math.hypot(x - 118, y - 125) - 74) < 5;
    const triangle = x >= 102 && x <= 156 && Math.abs(y - 125) <= (156 - x) * 0.63;
    const plus =
      (Math.abs(x - 188) < 6 && y >= 172 && y <= 212) ||
      (Math.abs(y - 192) < 6 && x >= 168 && x <= 208);
    const white = ring || triangle || plus;
    pixels[offset] = white ? 255 : 255;
    pixels[offset + 1] = white ? 255 : 52;
    pixels[offset + 2] = white ? 255 : 72;
    pixels[offset + 3] =
      Math.hypot(Math.max(0, Math.abs(x - 128) - 58), Math.max(0, Math.abs(y - 128) - 58)) <= 62
        ? 255
        : 0;
  }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  tag.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
await writeFile('assets/icon.png', png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[8] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile('assets/icon.ico', Buffer.concat([ico, png]));
