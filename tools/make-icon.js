'use strict';

// Generates build/icon.png (512x512) with no external dependencies.
// Run with: npm run icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const img = Buffer.alloc(SIZE * SIZE * 4);

// Envelope geometry
const EX0 = 96, EY0 = 166, EX1 = 416, EY1 = 366, ER = 14;
const FLAP_TIP_Y = 300; // flap lines run from top corners to (256, FLAP_TIP_Y)

function flapEdgeY(x) {
  const half = SIZE / 2;
  const t = x <= half ? (x - EX0) / (half - EX0) : (EX1 - x) / (EX1 - half);
  return EY0 + t * (FLAP_TIP_Y - EY0);
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;

    if (inRoundedRect(x, y, 16, 16, SIZE - 16, SIZE - 16, 104)) {
      // Diagonal blue gradient background
      const t = (x + y) / (2 * SIZE);
      r = Math.round(47 + t * 25);
      g = Math.round(109 + t * 35);
      b = Math.round(233 - t * 60);
      a = 255;

      if (inRoundedRect(x, y, EX0, EY0, EX1, EY1, ER)) {
        // Envelope body
        r = g = b = 250;
        const edge = flapEdgeY(x);
        if (y <= edge) {
          // Flap area, slightly shaded
          r = 226; g = 233; b = 243;
        }
        if (Math.abs(y - edge) < 5 && y > EY0 + 4) {
          // Flap crease line
          r = 58; g = 103; b = 189;
        }
      }
    }

    img[i] = r;
    img[i + 1] = g;
    img[i + 2] = b;
    img[i + 3] = a;
  }
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(img, SIZE, SIZE));
console.log('Wrote', out);
