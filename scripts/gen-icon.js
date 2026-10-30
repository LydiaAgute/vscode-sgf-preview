'use strict';

// 生成插件图标：media/icon.png（Marketplace 要求 PNG，128×128）和同一几何的 media/icon.svg。
// 只用 Node 内置模块，按 4×4 超采样抗锯齿。修改图标时改这里的几何参数后重新运行 pnpm run icon。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4;

// 棋盘局部：5 纵 5 横，网格坐标 0..4 对应像素 24..104；线条两端各出头 LINE_EXT，不封口
const GRID = [24, 44, 64, 84, 104];
const LINE_W = 2.5;
const LINE_EXT = 13;
const LINE_LO = GRID[0] - LINE_EXT;
const LINE_HI = GRID[GRID.length - 1] + LINE_EXT;
const STONE_R = 9.5;
const BOARD = { x0: 4, y0: 4, x1: 124, y1: 124, r: 20 };
const BLACK_STONES = [
  [1, 1],
  [3, 2],
  [2, 3],
];
const WHITE_STONES = [
  [2, 1],
  [1, 3],
  [3, 3],
];

const C = {
  woodTop: [0xe6, 0xc0, 0x6e],
  woodBottom: [0xd2, 0xa4, 0x4c],
  line: [0x3b, 0x2a, 0x12],
  blackHi: [0x5c, 0x5c, 0x5c],
  blackLo: [0x0b, 0x0b, 0x0b],
  whiteHi: [0xff, 0xff, 0xff],
  whiteLo: [0xcb, 0xcb, 0xc5],
  whiteEdge: [0x85, 0x85, 0x7e],
};

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const px = (i) => GRID[i];

function insideRoundRect(x, y, { x0, y0, x1, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function onGrid(x, y) {
  const h = LINE_W / 2;
  for (const g of GRID) {
    if (Math.abs(y - g) <= h && x >= LINE_LO && x <= LINE_HI) return true;
    if (Math.abs(x - g) <= h && y >= LINE_LO && y <= LINE_HI) return true;
  }
  return false;
}

/** 单个采样点的颜色，返回预乘 alpha 的 [r, g, b, a]，r/g/b 取 0..255 */
function sample(x, y) {
  const dst = [0, 0, 0, 0];
  const paint = (rgb, a) => {
    for (let i = 0; i < 3; i++) dst[i] = rgb[i] * a + dst[i] * (1 - a);
    dst[3] = a + dst[3] * (1 - a);
  };

  if (insideRoundRect(x, y, BOARD)) {
    paint(lerp(C.woodTop, C.woodBottom, clamp01((y - BOARD.y0) / (BOARD.y1 - BOARD.y0))), 1);
  }
  if (onGrid(x, y)) paint(C.line, 1);
  if ((x - 64) ** 2 + (y - 64) ** 2 <= 3.5 ** 2) paint(C.line, 1);

  const stones = [
    ...BLACK_STONES.map(([i, j]) => ({ cx: px(i), cy: px(j), black: true })),
    ...WHITE_STONES.map(([i, j]) => ({ cx: px(i), cy: px(j), black: false })),
  ];
  for (const s of stones) {
    if ((x - s.cx - 1.5) ** 2 + (y - s.cy - 2) ** 2 <= STONE_R ** 2) paint([0, 0, 0], 0.28);
  }
  for (const s of stones) {
    const d = Math.hypot(x - s.cx, y - s.cy);
    if (d > STONE_R) continue;
    // 高光点偏左上，形成立体感
    const t = clamp01(
      Math.hypot(x - (s.cx - 0.3 * STONE_R), y - (s.cy - 0.35 * STONE_R)) / (1.3 * STONE_R),
    );
    if (s.black) {
      paint(lerp(C.blackHi, C.blackLo, t), 1);
    } else {
      paint(lerp(C.whiteHi, C.whiteLo, t), 1);
      if (d >= STONE_R - 1.2) paint(C.whiteEdge, 1);
    }
  }
  return dst;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

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

function renderPng() {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // 每行的滤波类型：None
    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          for (let i = 0; i < 4; i++) acc[i] += s[i];
        }
      }
      const n = SS * SS;
      const a = acc[3] / n;
      const o = y * stride + 1 + x * 4;
      // 预乘颜色还原为 PNG 的直通 alpha
      for (let i = 0; i < 3; i++) raw[o + i] = a > 0 ? Math.round(acc[i] / n / a) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderSvg() {
  const lines = GRID.map((g) => `M${LINE_LO} ${g}H${LINE_HI}M${g} ${LINE_LO}V${LINE_HI}`).join('');
  const stone = ([i, j], black) => {
    const cx = px(i);
    const cy = px(j);
    const shadow = `<circle cx="${cx + 1.5}" cy="${cy + 2}" r="${STONE_R}" fill="#000" fill-opacity="0.28"/>`;
    const body = black
      ? `<circle cx="${cx}" cy="${cy}" r="${STONE_R}" fill="url(#b)"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${STONE_R - 0.6}" fill="url(#w)" stroke="${hex(C.whiteEdge)}" stroke-width="1.2"/>`;
    return { shadow, body };
  };
  const all = [
    ...BLACK_STONES.map((p) => stone(p, true)),
    ...WHITE_STONES.map((p) => stone(p, false)),
  ];
  const { x0, y0, x1, y1, r } = BOARD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <!-- 由 scripts/gen-icon.js 生成，与 icon.png 几何一致 -->
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hex(C.woodTop)}"/>
      <stop offset="1" stop-color="${hex(C.woodBottom)}"/>
    </linearGradient>
    <radialGradient id="b" cx="0.35" cy="0.32" r="0.68" fx="0.35" fy="0.32">
      <stop offset="0" stop-color="${hex(C.blackHi)}"/>
      <stop offset="1" stop-color="${hex(C.blackLo)}"/>
    </radialGradient>
    <radialGradient id="w" cx="0.35" cy="0.32" r="0.68" fx="0.35" fy="0.32">
      <stop offset="0" stop-color="${hex(C.whiteHi)}"/>
      <stop offset="1" stop-color="${hex(C.whiteLo)}"/>
    </radialGradient>
  </defs>
  <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${r}" fill="url(#wood)"/>
  <path d="${lines}" stroke="${hex(C.line)}" stroke-width="${LINE_W}" stroke-linecap="butt" fill="none"/>
  <circle cx="64" cy="64" r="3.5" fill="${hex(C.line)}"/>
  ${all.map((s) => s.shadow).join('\n  ')}
  ${all.map((s) => s.body).join('\n  ')}
</svg>
`;
}

const outDir = path.join(__dirname, '..', 'media');
fs.writeFileSync(path.join(outDir, 'icon.png'), renderPng());
fs.writeFileSync(path.join(outDir, 'icon.svg'), renderSvg(), 'utf8');
console.log(
  'Generated media/icon.png and media/icon.svg / 已生成 media/icon.png 与 media/icon.svg',
);
