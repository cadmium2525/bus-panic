// Canvas で生成する自作テクスチャ（外部素材なし）
import * as THREE from 'three';

const JP_FONT = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** ビルの窓（横8m × 縦6m で1リピート、2列×2段）。左上の小領域は無地（屋上用） */
export function windowTexture() {
  const W = 256, H = 192;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = seeded(7);
  g.fillStyle = '#f2efe8';
  g.fillRect(0, 0, W, H);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x = col * 128 + 18, y = row * 96 + 22, w = 92, h = 52;
      g.fillStyle = '#8f9aa3';
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      const lit = rnd() < 0.25;
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, lit ? '#e8dcb0' : '#5d7387');
      grd.addColorStop(1, lit ? '#bfae78' : '#2f4152');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 6, y + 4, 18, h - 8);
      g.fillStyle = '#8f9aa3';
      g.fillRect(x + w / 2 - 2, y, 4, h);
    }
    // 階の境目
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(0, row * 96 + 92, W, 4);
  }
  // 屋上用の無地サンプル領域
  g.fillStyle = '#f2efe8';
  g.fillRect(0, 0, 10, 10);
  return finish(c, { repeat: true });
}

/** 住宅の壁（小窓） 6m × 3m で1リピート */
export function houseTexture() {
  const W = 192, H = 96;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, W, H);
  // 下見板の線
  g.strokeStyle = 'rgba(0,0,0,0.06)';
  for (let y = 4; y < H; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.fillStyle = '#6a7f8c';
  g.fillRect(40, 30, 44, 34);
  g.fillRect(120, 30, 30, 34);
  g.fillStyle = '#d6d0c2';
  g.fillRect(40, 46, 44, 3);
  g.fillRect(61, 30, 2, 34);
  g.fillRect(0, 0, 8, 8);
  return finish(c, { repeat: true });
}

const SHOP_SIGNS = [
  ['ラーメン', '#c0392b', '#fff'],
  ['喫茶', '#6d4c41', '#ffe9b0'],
  ['薬', '#1565c0', '#fff'],
  ['居酒屋', '#212121', '#ffcc33'],
  ['本', '#2e7d32', '#fff'],
  ['酒', '#f5f0e1', '#b71c1c'],
  ['寿司', '#1a237e', '#fff'],
  ['床屋', '#ffffff', '#d32f2f'],
  ['カラオケ', '#8e24aa', '#fff'],
  ['パン', '#ff8f00', '#fff'],
  ['うどん', '#fff8e1', '#4e342e'],
  ['定食', '#00695c', '#fff'],
  ['八百屋', '#558b2f', '#fffde7'],
  ['営業中', '#d84315', '#fff'],
  ['銭湯', '#0277bd', '#fff'],
  ['質', '#37474f', '#ffd54f'],
];

/** 看板アトラス 4×4。縦書き看板として使う。uvRect(i) でセル範囲を返す */
export function signAtlas() {
  const S = 128;
  const c = canvas(S * 4, S * 8);
  const g = c.getContext('2d');
  SHOP_SIGNS.forEach(([text, bg, fg], i) => {
    const x = (i % 4) * S, y = Math.floor(i / 4) * S * 2;
    g.fillStyle = bg;
    g.fillRect(x, y, S, S * 2);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(x + 6, y + 6, S - 12, S * 2 - 12);
    g.fillStyle = fg;
    const chars = [...text];
    const size = Math.min(96, Math.floor((S * 2 - 30) / chars.length));
    g.font = `bold ${size}px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const total = size * chars.length;
    chars.forEach((ch, k) => {
      g.fillText(ch, x + S / 2, y + S - total / 2 + size * (k + 0.5));
    });
  });
  const tex = finish(c);
  tex.userData = {
    count: SHOP_SIGNS.length,
    uvRect(i) {
      const col = i % 4, row = Math.floor(i / 4);
      return { u0: col / 4, u1: (col + 1) / 4, v0: 1 - (row + 1) / 4, v1: 1 - row / 4 };
    },
  };
  return tex;
}

/** 行先表示器（LED風） */
export function destinationTexture(text = '限界駅 行') {
  const c = canvas(512, 96);
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ff9a1f';
  g.shadowColor = '#ff7b00';
  g.shadowBlur = 12;
  g.font = `bold 62px ${JP_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  return finish(c);
}

/** 車体側面の社名・ストライプ */
export function busSideTexture() {
  const c = canvas(1024, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#f7f5ee';
  g.fillRect(0, 0, 1024, 256);
  // ストライプ
  g.fillStyle = '#1f8a4c';
  g.fillRect(0, 170, 1024, 34);
  g.fillStyle = '#f2b705';
  g.fillRect(0, 206, 1024, 10);
  g.fillStyle = '#1f8a4c';
  g.font = `bold 46px ${JP_FONT}`;
  g.textBaseline = 'middle';
  g.fillText('限界交通', 640, 120);
  g.font = `bold 22px ${JP_FONT}`;
  g.fillText('GENKAI BUS', 650, 152);
  return finish(c);
}

/** 停留所名などを表示するラベル（Sprite 用） */
export function labelTexture(lines, { w = 512, h = 160, bg = 'rgba(20,24,32,0.82)', fg = '#fff', accent = '#ffcf33' } = {}) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = 26;
  g.fillStyle = bg;
  roundRectPath(g, 4, 4, w - 8, h - 8, r);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = accent;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const [l1, l2] = lines;
  g.fillStyle = accent;
  g.font = `bold 40px ${JP_FONT}`;
  g.fillText(l1, w / 2, l2 ? h * 0.32 : h / 2);
  if (l2) {
    g.fillStyle = fg;
    g.font = `bold 56px ${JP_FONT}`;
    g.fillText(l2, w / 2, h * 0.68, w - 30);
  }
  return finish(c);
}

/** バス停の丸い標識 */
export function busStopPlateTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f8a4c';
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold 34px ${JP_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('バス', 64, 50);
  g.font = `bold 22px ${JP_FONT}`;
  g.fillText('のりば', 64, 84);
  return finish(c);
}

/** 駅舎の看板 */
export function stationSignTexture() {
  const c = canvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0d3b66';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff';
  g.font = `bold 64px ${JP_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('限界駅', 256, 54);
  g.font = `bold 22px ${JP_FONT}`;
  g.fillText('GENKAI STATION', 256, 104);
  return finish(c);
}

export function textPlateTexture(text, bg = '#ffffff', fg = '#222', w = 512, h = 128) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.55)}px ${JP_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 20);
  return finish(c);
}

/**
 * 壊せる小物用のアトラス (1024×512)。
 * 白ブロック(単色部品用) / 立て看板4種 / のぼり2種 / 工事バリケード / 標識3種
 */
export function propAtlas() {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const cells = {};
  const uv = (x, y, w, h) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });
  cells.white = uv(996, 4, 24, 24);

  // 立て看板（A型）
  const boards = [
    ['ラーメン', '#c0392b', '#fff'],
    ['居酒屋', '#1f1f1f', '#ffcc33'],
    ['本日特売', '#ffffff', '#d32f2f'],
    ['営業中', '#1565c0', '#fff'],
  ];
  boards.forEach(([text, bg, fg], i) => {
    const x = i * 128, y = 0;
    g.fillStyle = bg;
    g.fillRect(x, y, 128, 256);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(x + 8, y + 8, 112, 240);
    g.fillStyle = fg;
    const chars = [...text];
    const size = Math.min(70, Math.floor(220 / chars.length));
    g.font = `bold ${size}px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    chars.forEach((ch, k) => g.fillText(ch, x + 64, y + 128 - (size * chars.length) / 2 + size * (k + 0.5)));
    cells['board' + i] = uv(x, y, 128, 256);
  });

  // のぼり旗
  const nobori = [
    ['限界まつり', '#d32f2f', '#ffffff'],
    ['大売出し', '#ffffff', '#c62828'],
  ];
  nobori.forEach(([text, bg, fg], i) => {
    const x = 512 + i * 64, y = 0;
    g.fillStyle = bg;
    g.fillRect(x, y, 64, 512);
    g.fillStyle = fg;
    g.fillRect(x, y, 64, 18);
    g.fillRect(x + 54, y, 10, 512);
    const chars = [...text];
    const size = 50;
    g.font = `bold ${size}px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    chars.forEach((ch, k) => g.fillText(ch, x + 28, y + 70 + k * 78));
    cells['nobori' + i] = uv(x, y, 64, 512);
  });

  // 工事バリケード
  {
    const x = 640, y = 0, w = 256, h = 96;
    g.fillStyle = '#ffd400';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#111';
    for (let k = -4; k < 12; k++) {
      g.beginPath();
      g.moveTo(x + k * 32, y + h);
      g.lineTo(x + k * 32 + 16, y + h);
      g.lineTo(x + k * 32 + 16 + h * 0.6, y);
      g.lineTo(x + k * 32 + h * 0.6, y);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(x + 70, y + 20, 116, 56);
    g.fillStyle = '#c62828';
    g.font = `bold 42px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('工事中', x + 128, y + 50);
    cells.barricade = uv(x, y, w, h);
  }

  // 標識: 止まれ（逆三角）
  {
    const x = 640, y = 128, s = 128;
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, s, s);
    g.fillStyle = '#d0021b';
    g.beginPath();
    g.moveTo(x + 6, y + 14);
    g.lineTo(x + s - 6, y + 14);
    g.lineTo(x + s / 2, y + s - 6);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold 30px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('止まれ', x + s / 2, y + 48);
    cells.signStop = uv(x, y, s, s);
  }
  // 標識: 青い円（指定方向）
  {
    const x = 768, y = 128, s = 128;
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, s, s);
    g.fillStyle = '#1e5bb8';
    g.beginPath();
    g.arc(x + 64, y + 64, 58, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(x + 64, y + 104);
    g.lineTo(x + 64, y + 34);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(x + 40, y + 50);
    g.lineTo(x + 88, y + 50);
    g.lineTo(x + 64, y + 20);
    g.closePath();
    g.fill();
    cells.signBlue = uv(x, y, s, s);
  }
  // 標識: 黄色のひし形（飛び出し注意）
  {
    const x = 896, y = 128, s = 128;
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, s, s);
    g.fillStyle = '#ffc400';
    g.beginPath();
    g.moveTo(x + 64, y + 4);
    g.lineTo(x + 124, y + 64);
    g.lineTo(x + 64, y + 124);
    g.lineTo(x + 4, y + 64);
    g.closePath();
    g.fill();
    g.strokeStyle = '#111';
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x + 64, y + 40, 10, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x + 58, y + 52, 12, 34);
    g.fillRect(x + 46, y + 60, 36, 7);
    g.fillRect(x + 52, y + 84, 7, 22);
    g.fillRect(x + 69, y + 84, 7, 22);
    cells.signWarn = uv(x, y, s, s);
  }
  const t = finish(c);
  t.userData = { cells };
  return t;
}
