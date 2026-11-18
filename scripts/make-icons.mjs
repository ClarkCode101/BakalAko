// Gumagawa ng PNG icons ng app: simpleng gate arch na Pine sa Switchgear.
// Walang dependency: built-in na zlib lang ng Node ang ginagamit.
// Patakbuhin: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0xc9, 0xd3, 0xcc]; // Switchgear
const FG = [0x17, 0x35, 0x2f]; // Pine
const GUARD = [0x1f, 0x7a, 0x55]; // maliit na coil panel

// Hugis sa 0..1 na coordinates. Ibinabalik ang kulay o null (background).
function shape(x, y) {
  const cx = 0.5;
  const cy = 0.46;
  const r = Math.hypot(x - cx, y - cy);

  // Coil panels (berde) sa loob ng mga poste
  const inPanel = (x0) => x >= x0 && x <= x0 + 0.06 && ((y >= 0.5 && y <= 0.6) || (y >= 0.66 && y <= 0.76));
  if (inPanel(0.25) || inPanel(0.69)) return GUARD;

  // Labas ng arch
  const outer = (y >= cy && y <= 0.84 && x >= 0.22 && x <= 0.78) || (y < cy && r <= 0.28);
  // Daanan sa gitna
  const inner = (y >= cy && y <= 0.84 && x >= 0.34 && x <= 0.66) || (y < cy && r <= 0.16);
  if (outer && !inner) return FG;

  // Sahig
  if (y >= 0.86 && y <= 0.9 && x >= 0.14 && x <= 0.86) return FG;
  return null;
}

// scale < 1 = paliitin sa gitna (para sa maskable safe zone)
function render(size, scale = 1) {
  const SS = 4; // supersampling para makinis ang gilid
  const px = Buffer.alloc(size * size * 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          let x = (i + (sx + 0.5) / SS) / size;
          let y = (j + (sy + 0.5) / SS) / size;
          x = (x - 0.5) / scale + 0.5;
          y = (y - 0.52) / scale + 0.52;
          const c = shape(x, y) ?? BG;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const o = (j * size + i) * 3;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  return encodePng(size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('icon-192.png', dir), render(192));
writeFileSync(new URL('icon-512.png', dir), render(512));
writeFileSync(new URL('maskable-512.png', dir), render(512, 0.72));
writeFileSync(new URL('apple-touch-icon.png', dir), render(180, 0.9));
console.log('Nagawa ang icons sa public/icons/');
