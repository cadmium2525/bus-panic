// 街の静的メッシュ生成（道路・歩道・建物・川・樹木・電柱など）と、壊せる小物の配置点の決定
import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';
import {
  TILE, N, T, SIDEWALK, tileAt, zoneAt, isMainType, isDrivableType, solidRectForTile,
  H_ROADS, V_ROADS, ALLEYS,
} from './map.js';
import * as TX from './textures.js';

const SW_H = 0.15; // 歩道の高さ
const WATER_Y = -1.8;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const range = (rnd, a, b) => a + (b - a) * rnd();

const PAL = {
  office: ['#d9d4c7', '#c9c3b5', '#e6e1d6', '#b8b2a6', '#d0c4ae', '#a9b1b5', '#c7b299', '#e8e4da', '#bfc6c9'],
  shop: ['#eadfcd', '#d8c8b0', '#f0e6d2', '#cbb79c', '#e3d3bd', '#d6cfc4'],
  awning: ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400'],
  houseWall: ['#efe7d6', '#e5dcc8', '#d9cdb5', '#f3eee3', '#cfc6b4', '#e8d9c0', '#dcd6cc'],
  roof: ['#4a5560', '#3f4a5a', '#5b4a3f', '#6b3e2e', '#2f3b46', '#556b5d', '#7a4b3a'],
  car: ['#e8e8e8', '#202020', '#9aa3ad', '#b03a2e', '#2c5aa0', '#f2f2f2', '#c9b27c'],
};

const isH = (r) => Object.values(H_ROADS).some(([a, b]) => r === a || r === b);
const isV = (c) => Object.values(V_ROADS).some(([a, b]) => c === a || c === b);
export const isIntersection = (c, r) => tileAt(c, r) === T.ROAD && isH(r) && isV(c);

/** 非走行タイルを用途ごとの長方形にまとめる（貪欲法） */
function zoneRects() {
  const used = new Uint8Array(N * N);
  const out = [];
  const ok = (c, r, z) => c >= 0 && r >= 0 && c < N && r < N && !used[r * N + c] && tileAt(c, r) === T.SOLID && zoneAt(c, r) === z;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (used[r * N + c] || tileAt(c, r) !== T.SOLID) continue;
      const z = zoneAt(c, r);
      let c1 = c;
      while (ok(c1 + 1, r, z)) c1++;
      let r1 = r;
      for (;;) {
        let all = true;
        for (let cc = c; cc <= c1; cc++) if (!ok(cc, r1 + 1, z)) { all = false; break; }
        if (!all) break;
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr * N + cc] = 1;
      out.push({ zone: z, c0: c, r0: r, c1, r1 });
    }
  }
  return out;
}

/** 長方形の各辺の向こう側の種別 */
function sideInfo(R) {
  const kinds = { n: [], s: [], w: [], e: [] };
  for (let c = R.c0; c <= R.c1; c++) {
    kinds.n.push(tileAt(c, R.r0 - 1));
    kinds.s.push(tileAt(c, R.r1 + 1));
  }
  for (let r = R.r0; r <= R.r1; r++) {
    kinds.w.push(tileAt(R.c0 - 1, r));
    kinds.e.push(tileAt(R.c1 + 1, r));
  }
  const info = {};
  for (const k of ['n', 's', 'w', 'e']) {
    const arr = kinds[k];
    info[k] = {
      main: arr.some((t) => t === T.ROAD || t === T.PLAZA),
      street: arr.some(isDrivableType),
      alley: arr.some((t) => t === T.ALLEY),
      water: arr.some((t) => t === T.WATER || t === T.BANK),
    };
  }
  return info;
}

export function buildCity(scene, { decorDensity = 1, stops = [] } = {}) {
  const rnd = seeded(20261106);
  const tex = {
    windows: TX.windowTexture(),
    house: TX.houseTexture(),
    signs: TX.signAtlas(),
    station: TX.stationSignTexture(),
    stopPlate: TX.busStopPlateTexture(),
  };
  const B = {
    ground: new MeshBuilder(),
    marks: new MeshBuilder(),
    facade: new MeshBuilder(),
    house: new MeshBuilder(),
    plain: new MeshBuilder(),
    signs: new MeshBuilder(),
    water: new MeshBuilder(),
  };
  const colliders = { circles: [] }; // 建物タイルは map.solidRectForTile を直接使う
  const nearStop = (x, z, d) => stops.some((st) => Math.abs(st.center.x - x) < d && Math.abs(st.center.z - z) < d);
  const spawns = { cone: [], pot: [], sign: [], board: [], nobori: [], guardrail: [], barricade: [] };
  const wires = [];
  const textPlates = []; // {texture, x,y,z,w,h,rotY}

  // ---------- 地面・道路・歩道・川 ----------
  const asphalt = new THREE.Color('#4b4e53');
  const alleyCol = new THREE.Color('#5d5f62');
  const plazaCol = new THREE.Color('#56595d');
  const swCol = new THREE.Color('#b7b3aa');
  const curbCol = new THREE.Color('#d2cfc8');
  const grass = new THREE.Color('#6f9a4a');
  const concrete = new THREE.Color('#a9a59b');
  const tmp = new THREE.Color();

  const g = B.ground;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const t = tileAt(c, r);
      const x0 = c * TILE, x1 = x0 + TILE, z0 = r * TILE, z1 = z0 + TILE;
      const jitter = (rnd() - 0.5) * 0.03;
      if (t === T.ROAD || t === T.ALLEY || t === T.PLAZA || t === T.BRIDGE) {
        const base = t === T.ALLEY ? alleyCol : t === T.PLAZA ? plazaCol : asphalt;
        tmp.copy(base).offsetHSL(0, 0, jitter);
        g.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], tmp);
        if (t === T.BRIDGE) buildBridgeTile(c, r, x0, z0, x1, z1);
        continue;
      }
      if (t === T.WATER) {
        B.water.quad([x0, WATER_Y, z1], [x1, WATER_Y, z1], [x1, WATER_Y, z0], [x0, WATER_Y, z0], '#3b7fa3');
        // 護岸（川の両側の壁）
        if (tileAt(c, r + 1) === T.SOLID) g.quad([x1, -3, z1], [x0, -3, z1], [x0, SW_H, z1], [x1, SW_H, z1], '#9a978e');
        continue;
      }
      if (t === T.BANK) {
        buildBankTile(c, r, x0, z0, x1, z1);
        continue;
      }
      // SOLID
      const rect = solidRectForTile(c, r);
      const zone = zoneAt(c, r);
      const ground = zone === 'park' || zone === 'shrine' ? grass : concrete;
      tmp.copy(ground).offsetHSL(0, 0, jitter);
      g.quad([rect.x0, SW_H, rect.z1], [rect.x1, SW_H, rect.z1], [rect.x1, SW_H, rect.z0], [rect.x0, SW_H, rect.z0], tmp);
      // 歩道帯
      if (rect.z0 > z0) g.quad([x0, SW_H, rect.z0], [x1, SW_H, rect.z0], [x1, SW_H, z0], [x0, SW_H, z0], swCol);
      if (rect.z1 < z1) g.quad([x0, SW_H, z1], [x1, SW_H, z1], [x1, SW_H, rect.z1], [x0, SW_H, rect.z1], swCol);
      if (rect.x0 > x0) g.quad([x0, SW_H, rect.z1], [rect.x0, SW_H, rect.z1], [rect.x0, SW_H, rect.z0], [x0, SW_H, rect.z0], swCol);
      if (rect.x1 < x1) g.quad([rect.x1, SW_H, rect.z1], [x1, SW_H, rect.z1], [x1, SW_H, rect.z0], [rect.x1, SW_H, rect.z0], swCol);
      // 縁石（走行可能タイルとの境）
      if (isDrivableType(tileAt(c, r - 1))) g.quad([x1, 0, z0], [x0, 0, z0], [x0, SW_H, z0], [x1, SW_H, z0], curbCol);
      if (isDrivableType(tileAt(c, r + 1))) g.quad([x0, 0, z1], [x1, 0, z1], [x1, SW_H, z1], [x0, SW_H, z1], curbCol);
      if (isDrivableType(tileAt(c - 1, r))) g.quad([x0, 0, z0], [x0, 0, z1], [x0, SW_H, z1], [x0, SW_H, z0], curbCol);
      if (isDrivableType(tileAt(c + 1, r))) g.quad([x1, 0, z1], [x1, 0, z0], [x1, SW_H, z0], [x1, SW_H, z1], curbCol);
    }
  }

  function buildBankTile(c, r, x0, z0, x1, z1) {
    // 北側（道路側）は1.4m の路肩、その先は川へ向かう斜面
    const edge = z0 + 1.4;
    g.quad([x0, SW_H, edge], [x1, SW_H, edge], [x1, SW_H, z0], [x0, SW_H, z0], '#a7a399');
    g.quad([x0, -2.2, z1], [x1, -2.2, z1], [x1, SW_H, edge], [x0, SW_H, edge], '#7ea356');
    if (isDrivableType(tileAt(c, r - 1))) g.quad([x1, 0, z0], [x0, 0, z0], [x0, SW_H, z0], [x1, SW_H, z0], curbCol);
    // 橋に接する側面
    for (const [dc, xx] of [[-1, x0], [1, x1]]) {
      if (tileAt(c + dc, r) !== T.BRIDGE) continue;
      if (dc < 0) g.quad([xx, -2.2, z0], [xx, -2.2, z1], [xx, SW_H, edge], [xx, SW_H, z0], '#8f8b80');
      else g.quad([xx, -2.2, z1], [xx, -2.2, z0], [xx, SW_H, z0], [xx, SW_H, edge], '#8f8b80');
    }
  }

  function buildBridgeTile(c, r, x0, z0, x1, z1) {
    const below = r >= 29 && r <= 33; // 川・土手の上
    if (below) {
      // 橋の下にも水面と斜面を描く
      if (r >= 30) B.water.quad([x0, WATER_Y, z1], [x1, WATER_Y, z1], [x1, WATER_Y, z0], [x0, WATER_Y, z0], '#3b7fa3');
      else {
        g.quad([x0, -2.2, z1], [x1, -2.2, z1], [x1, SW_H - 0.3, z0 + 1.4], [x0, SW_H - 0.3, z0 + 1.4], '#6d8f4c');
      }
      // 桁の底面
      g.quad([x0, -1.2, z0], [x1, -1.2, z0], [x1, -1.2, z1], [x0, -1.2, z1], '#77736b');
      if (r === 31) {
        // 橋脚
        const cx = (x0 + x1) / 2;
        if (tileAt(c - 1, r) !== T.BRIDGE) B.plain.box(cx - 1, -3, z0 + 2, cx + 1, -1.2, z1 - 2, '#8d8a82');
      }
    }
    // 欄干（川・公園側）
    for (const [dc, side] of [[-1, 'w'], [1, 'e']]) {
      const nt = tileAt(c + dc, r);
      if (nt === T.BRIDGE || nt === T.ROAD) continue;
      const xa = side === 'w' ? x0 - 0.45 : x1, xb = side === 'w' ? x0 : x1 + 0.45;
      B.plain.box(xa, below ? -1.2 : 0, z0, xb, 1.05, z1, '#c9c6bd', { topColor: '#e0ddd5' });
      // 高欄の手すり
      B.plain.box(xa - 0.05, 1.05, z0, xb + 0.05, 1.18, z1, '#3f6e8c');
      if (below) {
        const f = side === 'w' ? x0 - 0.45 : x1 + 0.45;
        // 桁側面
        if (side === 'w') g.quad([f, -1.2, z0], [f, -1.2, z1], [f, 0, z1], [f, 0, z0], '#8a867d');
        else g.quad([f, -1.2, z1], [f, -1.2, z0], [f, 0, z0], [f, 0, z1], '#8a867d');
      }
    }
  }

  // 地図外の地面と川の延長
  {
    const ext = 700;
    g.quad([-ext, -0.03, 232], [480 + ext, -0.03, 232], [480 + ext, -0.03, -ext], [-ext, -0.03, -ext], '#8d9873');
    g.quad([-ext, -0.03, 480 + ext], [480 + ext, -0.03, 480 + ext], [480 + ext, -0.03, 288], [-ext, -0.03, 288], '#8d9873');
    for (const [xa, xb] of [[-ext, 0], [480, 480 + ext]]) {
      B.water.quad([xa, WATER_Y, 272], [xb, WATER_Y, 272], [xb, WATER_Y, 240], [xa, WATER_Y, 240], '#3b7fa3');
      g.quad([xa, -2.2, 240], [xb, -2.2, 240], [xb, -0.03, 232], [xa, -0.03, 232], '#7ea356');
      g.quad([xa, -0.03, 288], [xb, -0.03, 288], [xb, -0.03, 272], [xa, -0.03, 272], '#79a052');
      g.quad([xb, -3, 272], [xa, -3, 272], [xa, -0.03, 272], [xb, -0.03, 272], '#9a978e');
    }
  }

  // ---------- 路面標示 ----------
  const white = '#ecebe6', yellow = '#f0c330';
  const M = B.marks;
  const Y = 0.02;
  const flat = (xa, za, xb, zb, col) => M.quad([xa, Y, zb], [xb, Y, zb], [xb, Y, za], [xa, Y, za], col);

  // 中央線・外側線
  for (const [r0] of Object.values(H_ROADS)) {
    const zc = (r0 + 1) * TILE;
    for (let c = 3; c <= 55; c++) {
      if (tileAt(c, r0) !== T.ROAD || isIntersection(c, r0)) continue;
      let xa = c * TILE, xb = xa + TILE;
      if (isIntersection(c - 1, r0)) xa += 5;
      if (isIntersection(c + 1, r0)) xb -= 5;
      flat(xa, zc - 0.12, xb, zc + 0.12, isIntersection(c - 1, r0) || isIntersection(c + 1, r0) ? white : yellow);
      // 外側線（破線）
      for (const [rr, zz] of [[r0 - 1, r0 * TILE + 0.6], [r0 + 2, (r0 + 2) * TILE - 0.6]]) {
        if (isDrivableType(tileAt(c, rr))) continue;
        for (let k = 0; k < 2; k++) flat(xa + k * 4 + 0.5, zz - 0.08, Math.min(xb, xa + k * 4 + 3.5), zz + 0.08, white);
      }
    }
  }
  for (const [c0] of Object.values(V_ROADS)) {
    const xc = (c0 + 1) * TILE;
    for (let r = 3; r <= 55; r++) {
      const t = tileAt(c0, r);
      if ((t !== T.ROAD && t !== T.BRIDGE) || isIntersection(c0, r)) continue;
      let za = r * TILE, zb = za + TILE;
      if (isIntersection(c0, r - 1)) za += 5;
      if (isIntersection(c0, r + 1)) zb -= 5;
      flat(xc - 0.12, za, xc + 0.12, zb, isIntersection(c0, r - 1) || isIntersection(c0, r + 1) ? white : yellow);
      for (const [cc, xx] of [[c0 - 1, c0 * TILE + 0.6], [c0 + 2, (c0 + 2) * TILE - 0.6]]) {
        if (isDrivableType(tileAt(cc, r)) && tileAt(cc, r) !== T.BRIDGE) continue;
        for (let k = 0; k < 2; k++) flat(xx - 0.08, za + k * 4 + 0.5, xx + 0.08, Math.min(zb, za + k * 4 + 3.5), white);
      }
    }
  }
  // 横断歩道と停止線
  const intersections = [];
  for (const [r0] of Object.values(H_ROADS)) {
    for (const [c0] of Object.values(V_ROADS)) {
      if (!isIntersection(c0, r0)) continue;
      intersections.push({ c: c0, r: r0, x: (c0 + 1) * TILE, z: (r0 + 1) * TILE });
      const X0 = c0 * TILE, X1 = (c0 + 2) * TILE, Z0 = r0 * TILE, Z1 = (r0 + 2) * TILE;
      // 西側
      if (tileAt(c0 - 1, r0) === T.ROAD) {
        for (let z = Z0 + 0.8; z < Z1 - 0.6; z += 1.1) flat(X0 - 4.2, z, X0 - 0.8, z + 0.5, white);
        flat(X0 - 5.4, Z0 + 0.3, X0 - 4.9, Z0 + TILE - 0.2, white);
      }
      if (tileAt(c0 + 2, r0) === T.ROAD) {
        for (let z = Z0 + 0.8; z < Z1 - 0.6; z += 1.1) flat(X1 + 0.8, z, X1 + 4.2, z + 0.5, white);
        flat(X1 + 4.9, Z0 + TILE + 0.2, X1 + 5.4, Z1 - 0.3, white);
      }
      if (tileAt(c0, r0 - 1) === T.ROAD) {
        for (let x = X0 + 0.8; x < X1 - 0.6; x += 1.1) flat(x, Z0 - 4.2, x + 0.5, Z0 - 0.8, white);
        flat(X0 + TILE + 0.2, Z0 - 5.4, X1 - 0.3, Z0 - 4.9, white);
      }
      if (tileAt(c0, r0 + 2) === T.ROAD) {
        for (let x = X0 + 0.8; x < X1 - 0.6; x += 1.1) flat(x, Z1 + 0.8, x + 0.5, Z1 + 4.2, white);
        flat(X0 + 0.3, Z1 + 4.9, X0 + TILE - 0.2, Z1 + 5.4, white);
      }
    }
  }
  // 路地の出口の停止線
  for (const a of ALLEYS) {
    const [c0, r0, c1, r1] = a.rect;
    if (c0 === c1) {
      const x = c0 * TILE;
      flat(x + 0.4, r0 * TILE + 0.6, x + TILE - 0.4, r0 * TILE + 1.0, white);
      flat(x + 0.4, (r1 + 1) * TILE - 1.0, x + TILE - 0.4, (r1 + 1) * TILE - 0.6, white);
    } else {
      const z = r0 * TILE;
      flat(c0 * TILE + 0.6, z + 0.4, c0 * TILE + 1.0, z + TILE - 0.4, white);
      flat((c1 + 1) * TILE - 1.0, z + 0.4, (c1 + 1) * TILE - 0.6, z + TILE - 0.4, white);
    }
  }

  // ---------- 建物 ----------
  const rects = zoneRects();
  const P = B.plain;

  function insetRect(R) {
    const si = sideInfo(R);
    return {
      x0: R.c0 * TILE + (si.w.main ? SIDEWALK : 0),
      x1: (R.c1 + 1) * TILE - (si.e.main ? SIDEWALK : 0),
      z0: R.r0 * TILE + (si.n.main ? SIDEWALK : 0),
      z1: (R.r1 + 1) * TILE - (si.s.main ? SIDEWALK : 0),
      si,
    };
  }

  /** 長方形を lotMin〜lotMax の区画に分割 */
  function splitLots(x0, z0, x1, z1, lotMin, lotMax, depthMax) {
    const lots = [];
    const W = x1 - x0, D = z1 - z0;
    const alongX = W >= D;
    const len = alongX ? W : D, dep = alongX ? D : W;
    const rows = dep > depthMax ? Math.max(2, Math.round(dep / depthMax)) : 1;
    for (let k = 0; k < rows; k++) {
      let p = 0;
      while (p < len - 0.01) {
        let w = range(rnd, lotMin, lotMax);
        if (len - p - w < lotMin) w = len - p;
        const a = p, b = p + w;
        const d0 = (dep * k) / rows, d1 = (dep * (k + 1)) / rows;
        if (alongX) lots.push({ x0: x0 + a, x1: x0 + b, z0: z0 + d0, z1: z0 + d1, edge: { n: k === 0, s: k === rows - 1, w: a === 0, e: b >= len - 0.01 } });
        else lots.push({ x0: x0 + d0, x1: x0 + d1, z0: z0 + a, z1: z0 + b, edge: { w: k === 0, e: k === rows - 1, n: a === 0, s: b >= len - 0.01 } });
        p = b;
      }
    }
    return lots;
  }

  function officeBuilding(L, hMin, hMax, palette = PAL.office) {
    const gap = 0.25;
    const x0 = L.x0 + gap, x1 = L.x1 - gap, z0 = L.z0 + gap, z1 = L.z1 - gap;
    const floors = Math.round(range(rnd, hMin, hMax) / 3);
    const h = Math.max(2, floors) * 3 + 0.6;
    const col = pick(rnd, palette);
    B.facade.box(x0, SW_H, z0, x1, h, z1, col, { uv: 'facade', topColor: new THREE.Color(col).multiplyScalar(0.78) });
    // 屋上
    if (rnd() < 0.55) {
      const cx = range(rnd, x0 + 1.5, x1 - 3), cz = range(rnd, z0 + 1.5, z1 - 3);
      P.box(cx, h, cz, cx + 1.6, h + 1.1, cz + 1.4, '#9ea3a6');
    }
    if (rnd() < 0.25) P.cylinder((x0 + x1) / 2 + 1, h, (z0 + z1) / 2, 1.0, 2.0, '#b5b9bb', 8);
    if (rnd() < 0.2 && x1 - x0 > 6) {
      // 屋上の縦看板
      const i = Math.floor(rnd() * tex.signs.userData.count);
      const uv = tex.signs.userData.uvRect(i);
      const cx = (x0 + x1) / 2, z = z1 - 1;
      P.box(cx - 0.9, h, z - 0.3, cx + 0.9, h + 0.6, z - 0.1, '#555');
      B.signs.quad([cx - 0.9, h + 0.6, z], [cx + 0.9, h + 0.6, z], [cx + 0.9, h + 4.2, z], [cx - 0.9, h + 4.2, z], '#fff', [
        [uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1],
      ]);
    }
    return h;
  }

  function verticalSign(x, z, y0, nx, nz) {
    // 袖看板: 壁から突き出す縦長の板（両面）
    const i = Math.floor(rnd() * tex.signs.userData.count);
    const uv = tex.signs.userData.uvRect(i);
    const h = 2.6, w = 0.9;
    const px = x + nx * 0.15, pz = z + nz * 0.15; // 壁際
    const qx = x + nx * (0.15 + w), qz = z + nz * (0.15 + w);
    const U = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
    B.signs.quad([px, y0, pz], [qx, y0, qz], [qx, y0 + h, qz], [px, y0 + h, pz], '#fff', U);
    B.signs.quad([qx, y0, qz], [px, y0, pz], [px, y0 + h, pz], [qx, y0 + h, qz], '#fff', U);
  }

  function shopFront(L, side, h) {
    // side の面に庇と看板を付ける
    const aw = pick(rnd, PAL.awning);
    const y = 2.7;
    if (side === 'n' || side === 's') {
      const z = side === 'n' ? L.z0 + 0.25 : L.z1 - 0.25;
      const dz = side === 'n' ? -1 : 1;
      P.box(L.x0 + 0.5, y, Math.min(z, z + dz * 1.3), L.x1 - 0.5, y + 0.35, Math.max(z, z + dz * 1.3), aw);
      P.box(L.x0 + 0.6, SW_H, Math.min(z, z + dz * 0.05), L.x1 - 0.6, 2.5, Math.max(z, z + dz * 0.05), '#6c7378');
      if (h > 5.5 && rnd() < 0.8) verticalSign(L.x0 + 0.8, z, 3.4, 0, dz);
    } else {
      const x = side === 'w' ? L.x0 + 0.25 : L.x1 - 0.25;
      const dx = side === 'w' ? -1 : 1;
      P.box(Math.min(x, x + dx * 1.3), y, L.z0 + 0.5, Math.max(x, x + dx * 1.3), y + 0.35, L.z1 - 0.5, aw);
      P.box(Math.min(x, x + dx * 0.05), SW_H, L.z0 + 0.6, Math.max(x, x + dx * 0.05), 2.5, L.z1 - 0.6, '#6c7378');
      if (h > 5.5 && rnd() < 0.8) verticalSign(x, L.z0 + 0.8, 3.4, dx, 0);
    }
  }

  function vending(x, z, rotY) {
    const cols = ['#d32f2f', '#1565c0', '#f5f5f5', '#2e7d32'];
    P.boxRot(x, SW_H + 0.9, z, 1.0, 1.8, 0.75, rotY, pick(rnd, cols));
    // 商品見本の明るい窓
    const fx = Math.sin(rotY), fz = Math.cos(rotY);
    P.boxRot(x + fx * 0.38, SW_H + 1.25, z + fz * 0.38, 0.8, 0.6, 0.02, rotY, '#fff8dc');
  }

  function tree(x, z, kind = 'round', scale = 1) {
    const y = SW_H;
    P.cylinder(x, y, z, 0.18 * scale, 2.2 * scale, '#6b4f3a', 5);
    if (kind === 'pine') {
      P.cone(x, y + 1.6 * scale, z, 1.8 * scale, 3.2 * scale, '#3d6b3a', 6);
      P.cone(x, y + 3.0 * scale, z, 1.3 * scale, 2.6 * scale, '#47783f', 6);
    } else if (kind === 'sakura') {
      P.blob(x, y + 3.2 * scale, z, 2.3 * scale, '#f4b9c8', 1.6 * scale);
      P.blob(x + 0.8 * scale, y + 3.8 * scale, z - 0.5 * scale, 1.4 * scale, '#f7cdd8', 1.1 * scale);
    } else {
      const shade = pick(rnd, ['#4f8a3c', '#5a9442', '#467f37', '#5f9b4a']);
      P.blob(x, y + 3.0 * scale, z, 1.9 * scale, shade, 1.6 * scale);
    }
  }

  function fenceAround(R, col = '#7d8a7a', height = 1.6, skip = {}) {
    const t = 0.12;
    if (!skip.n) P.box(R.x0, SW_H, R.z0, R.x1, height, R.z0 + t, col);
    if (!skip.s) P.box(R.x0, SW_H, R.z1 - t, R.x1, height, R.z1, col);
    if (!skip.w) P.box(R.x0, SW_H, R.z0, R.x0 + t, height, R.z1, col);
    if (!skip.e) P.box(R.x1 - t, SW_H, R.z0, R.x1, height, R.z1, col);
  }

  function hedgeAround(R) {
    const t = 0.7;
    P.box(R.x0, SW_H, R.z0, R.x1, 1.0, R.z0 + t, '#4d7d3a');
    P.box(R.x0, SW_H, R.z1 - t, R.x1, 1.0, R.z1, '#4d7d3a');
    P.box(R.x0, SW_H, R.z0, R.x0 + t, 1.0, R.z1, '#4d7d3a');
    P.box(R.x1 - t, SW_H, R.z0, R.x1, 1.0, R.z1, '#4d7d3a');
  }

  const gens = {
    office(R) {
      const lots = splitLots(R.x0, R.z0, R.x1, R.z1, 9, 17, 18);
      for (const L of lots) officeBuilding(L, 9, rnd() < 0.12 ? 45 : 30);
    },
    shop(R) {
      const lots = splitLots(R.x0, R.z0, R.x1, R.z1, 6, 8.5, 12);
      for (const L of lots) {
        const perimeter = (L.edge.n && R.si.n.street) || (L.edge.s && R.si.s.street) || (L.edge.w && R.si.w.street) || (L.edge.e && R.si.e.street);
        const h = officeBuilding(L, perimeter ? 6 : 10, perimeter ? 10.5 : 16, PAL.shop);
        for (const s of ['n', 's', 'w', 'e']) if (L.edge[s] && R.si[s].street) shopFront(L, s, h);
      }
    },
    mansion(R) {
      const lots = splitLots(R.x0, R.z0, R.x1, R.z1, 22, 32, 40);
      for (const L of lots) {
        if (rnd() < 0.2) {
          // 月極駐車場
          for (let k = 0; k < 3; k++) carProp(range(rnd, L.x0 + 3, L.x1 - 3), range(rnd, L.z0 + 4, L.z1 - 4), rnd() < 0.5 ? 0 : Math.PI);
          fenceAround({ x0: L.x0 + 0.3, x1: L.x1 - 0.3, z0: L.z0 + 0.3, z1: L.z1 - 0.3 }, '#8c8c8c', 0.9);
          continue;
        }
        const inner = { x0: L.x0 + 2, x1: L.x1 - 2, z0: L.z0 + 3, z1: L.z1 - 3, edge: L.edge };
        const h = officeBuilding(inner, 15, 27, ['#ede8dc', '#d7d1c4', '#c9b8a3', '#e2dccf']);
        // バルコニー
        for (let y = 3; y < h - 1; y += 3) {
          P.box(inner.x0, y, inner.z1, inner.x1, y + 0.25, inner.z1 + 1.2, '#f4f1ea');
          P.box(inner.x0, y + 0.25, inner.z1 + 1.05, inner.x1, y + 1.2, inner.z1 + 1.2, '#dcd8cf');
        }
        tree(L.x0 + 1, L.z0 + 1.5, 'round', 0.8);
      }
    },
    house(R) {
      const lots = splitLots(R.x0, R.z0, R.x1, R.z1, 9, 12.5, 12);
      for (const L of lots) houseLot(L, R);
    },
    danchi(R) {
      hedgeAround(R);
      const W = R.x1 - R.x0, D = R.z1 - R.z0;
      const alongX = W >= D;
      const count = Math.max(1, Math.floor((alongX ? D : W) / 18));
      for (let k = 0; k < count; k++) {
        const t0 = (k + 0.5) / count;
        const bl = (alongX ? W : D) - 12;
        const segs = bl > 70 ? 2 : 1;
        for (let s = 0; s < segs; s++) {
          const a = 6 + (bl / segs) * s + 2, b = 6 + (bl / segs) * (s + 1) - 2;
          let L;
          if (alongX) {
            const zc = R.z0 + D * t0;
            L = { x0: R.x0 + a, x1: R.x0 + b, z0: zc - 5, z1: zc + 5 };
          } else {
            const xc = R.x0 + W * t0;
            L = { x0: xc - 5, x1: xc + 5, z0: R.z0 + a, z1: R.z0 + b };
          }
          B.facade.box(L.x0, SW_H, L.z0, L.x1, 15.6, L.z1, '#ece6d6', { uv: 'facade', topColor: '#c9c3b5' });
          P.box(L.x0 - 0.2, 15.6, L.z0 - 0.2, L.x1 + 0.2, 16.1, L.z1 + 0.2, '#b8b2a5');
          // 階段室
          P.box((L.x0 + L.x1) / 2 - 1.5, SW_H, L.z1, (L.x0 + L.x1) / 2 + 1.5, 16.5, L.z1 + 1.5, '#d8d2c2');
        }
      }
      for (let i = 0; i < 6 * decorDensity; i++) tree(range(rnd, R.x0 + 2, R.x1 - 2), range(rnd, R.z0 + 2, R.z1 - 2), 'round', range(rnd, 0.8, 1.2));
    },
    school(R) {
      // 校舎（北側）・体育館（東側）・校庭
      const by = R.z0 + 1;
      B.facade.box(R.x0 + 6, SW_H, by, R.x1 - 34, 13.5, by + 14, '#efe9da', { uv: 'facade', topColor: '#c8c2b3' });
      {
        // 校舎の時計（北面）
        const kx = (R.x0 + R.x1 - 28) / 2;
        P.box(kx - 1.3, 9.6, by - 0.15, kx + 1.3, 12.2, by, '#ffffff');
        P.box(kx - 0.06, 10.9, by - 0.22, kx + 0.06, 11.9, by - 0.15, '#222');
        P.box(kx - 0.06, 10.84, by - 0.22, kx + 0.7, 10.96, by - 0.15, '#222');
      }
      P.box(R.x1 - 30, SW_H, by, R.x1 - 4, 10, by + 24, '#d9d3c0');
      P.gableRoof(R.x1 - 30, by, R.x1 - 4, by + 24, 10, 2.5, '#6a7f8f', false, 0.3);
      P.quad([R.x0 + 2, SW_H + 0.01, R.z1 - 2], [R.x1 - 2, SW_H + 0.01, R.z1 - 2], [R.x1 - 2, SW_H + 0.01, by + 26], [R.x0 + 2, SW_H + 0.01, by + 26], '#c8a679');
      // サッカーゴール
      for (const gx of [R.x0 + 8, R.x1 - 8]) {
        const gz = (by + 26 + R.z1 - 2) / 2;
        P.box(gx - 0.1, SW_H, gz - 3, gx + 0.1, 2.4, gz - 2.8, '#fff');
        P.box(gx - 0.1, SW_H, gz + 2.8, gx + 0.1, 2.4, gz + 3, '#fff');
        P.box(gx - 0.1, 2.3, gz - 3, gx + 0.1, 2.5, gz + 3, '#fff');
      }
      fenceAround(R, '#5e8f6a', 2.2);
      for (let x = R.x0 + 3; x < R.x1 - 3; x += 9) tree(x, R.z1 - 1.2, 'sakura', 0.9);
      textPlates.push({ texture: TX.textPlateTexture('限界小学校', '#ffffff', '#1b3a5c'), x: R.x0 + 18, y: 11.5, z: by - 0.06, w: 9, h: 1.8, rotY: Math.PI });
    },
    cityhall(R) {
      const cx = (R.x0 + R.x1) / 2;
      const L = { x0: R.x0 + 6, x1: R.x1 - 6, z0: R.z0 + 2, z1: R.z1 - 16 };
      B.facade.box(L.x0, SW_H, L.z0, L.x1, 24.6, L.z1, '#c9ccc9', { uv: 'facade', topColor: '#a5a8a6' });
      P.box(cx - 8, SW_H, L.z1, cx + 8, 4, L.z1 + 4, '#8b9196');
      textPlates.push({ texture: TX.textPlateTexture('限界市役所', '#2f3e46', '#ffffff'), x: cx, y: 6, z: L.z1 + 0.05, w: 12, h: 2.2, rotY: 0 });
      for (const fx of [-4, 0, 4]) {
        P.cylinder(cx + fx, SW_H, R.z1 - 5, 0.08, 9, '#ddd', 5);
        P.box(cx + fx, 7.4, R.z1 - 5, cx + fx + 2.2, 8.8, R.z1 - 4.95, fx === 0 ? '#ffffff' : '#1f8a4c');
      }
      for (let x = R.x0 + 3; x < R.x1; x += 10) tree(x, R.z1 - 2, 'round', 0.9);
      P.box(R.x0 + 1, SW_H, L.z1 + 6, R.x1 - 1, SW_H + 0.02, R.z1 - 0.5, '#cfcac0');
    },
    hospital(R) {
      const L = { x0: R.x0 + 4, x1: R.x0 + Math.min(70, R.x1 - R.x0 - 4), z0: R.z0 + 3, z1: R.z1 - 6 };
      B.facade.box(L.x0, SW_H, L.z0, L.x1, 30.6, L.z1, '#f4f4f2', { uv: 'facade', topColor: '#cfd2d4' });
      P.box(L.x0 + 10, SW_H, L.z1, L.x0 + 24, 4, L.z1 + 5, '#9fb3c8');
      textPlates.push({ texture: TX.textPlateTexture('限界市民病院', '#ffffff', '#0b6e4f'), x: (L.x0 + L.x1) / 2, y: 27.5, z: L.z1 + 0.05, w: 18, h: 3, rotY: 0 });
      if (L.x1 < R.x1 - 10) gens.office({ ...R, x0: L.x1 + 2 });
    },
    library(R) {
      const L = { x0: R.x0 + 2, x1: R.x1 - 2, z0: R.z0 + 2, z1: R.z1 - 2 };
      P.box(L.x0, SW_H, L.z0, L.x1, 8, L.z1, '#b89f7a');
      P.box(L.x0 - 0.05, 1.2, L.z0 - 0.05, L.x1 + 0.05, 6.8, L.z0, '#5f7f99');
      P.box(L.x0 - 0.6, 8, L.z0 - 0.6, L.x1 + 0.6, 8.6, L.z1 + 0.6, '#6d5a45');
      textPlates.push({ texture: TX.textPlateTexture('市立図書館', '#6d5a45', '#ffffff'), x: (L.x0 + L.x1) / 2, y: 7.3, z: L.z0 - 0.1, w: 9, h: 1.3, rotY: Math.PI });
    },
    factory(R) {
      fenceAround(R, '#8a8f92', 2.0);
      const L = { x0: R.x0 + 3, x1: R.x1 - 3, z0: R.z0 + 3, z1: R.z1 - 14 };
      const teeth = Math.max(2, Math.floor((L.z1 - L.z0) / 9));
      const dz = (L.z1 - L.z0) / teeth;
      P.box(L.x0, SW_H, L.z0, L.x1, 8, L.z1, '#a9b0b3', { top: false });
      for (let k = 0; k < teeth; k++) {
        const z0 = L.z0 + dz * k, z1 = z0 + dz;
        // のこぎり屋根
        P.quad([L.x0, 8, z1], [L.x1, 8, z1], [L.x1, 11, z0 + 0.2], [L.x0, 11, z0 + 0.2], '#7f8a90');
        P.quad([L.x1, 8, z0], [L.x0, 8, z0], [L.x0, 11, z0 + 0.2], [L.x1, 11, z0 + 0.2], '#c8d4dc');
        P.tri([L.x0, 8, z0], [L.x0, 8, z1], [L.x0, 11, z0 + 0.2], '#a9b0b3');
        P.tri([L.x1, 8, z1], [L.x1, 8, z0], [L.x1, 11, z0 + 0.2], '#a9b0b3');
      }
      const cx = L.x1 - 6, cz = R.z1 - 7;
      for (let k = 0; k < 6; k++) P.cylinder(cx, k * 5, cz, 1.2 - k * 0.08, 5, k % 2 ? '#c0392b' : '#f4f4f4', 8);
      P.cylinder(L.x0 + 6, SW_H, R.z1 - 7, 3.5, 6, '#c7ccd0', 10);
      P.cylinder(L.x0 + 15, SW_H, R.z1 - 7, 3.0, 5, '#d9dde0', 10);
    },
    shrine(R) {
      // 鎮守の森・社殿・朱色の鳥居（参道に面した南側）
      const cx = (R.x0 + R.x1) / 2;
      for (let i = 0; i < 26 * decorDensity; i++) {
        const x = range(rnd, R.x0 + 2, R.x1 - 2), z = range(rnd, R.z0 + 2, R.z1 - 2);
        if (Math.abs(x - cx) < 9 && z > R.z0 + 8) continue;
        tree(x, z, rnd() < 0.4 ? 'pine' : 'round', range(rnd, 1.1, 1.6));
      }
      const hz = R.z0 + 10;
      P.box(cx - 6, SW_H, hz - 4, cx + 6, SW_H + 0.8, hz + 5, '#bdb7aa');
      P.box(cx - 5, 0.95, hz - 3, cx + 5, 4.6, hz + 4, '#8a4b2c');
      P.gableRoof(cx - 5, hz - 3, cx + 5, hz + 4, 4.6, 3.2, '#3c3f3a', true, 1.2);
      P.quad([cx - 1.6, SW_H + 0.01, R.z1], [cx + 1.6, SW_H + 0.01, R.z1], [cx + 1.6, SW_H + 0.01, hz + 5], [cx - 1.6, SW_H + 0.01, hz + 5], '#cfc8b8');
      for (const tz of [R.z1 - 2, R.z1 - 9, R.z1 - 16]) torii(cx, tz, tz === R.z1 - 2 ? 1.25 : 1);
      // 狐の像と灯籠
      for (const sx of [-3, 3]) {
        P.box(cx + sx - 0.4, SW_H, R.z1 - 6, cx + sx + 0.4, 1.2, R.z1 - 5.2, '#a8a39a');
        P.blob(cx + sx, 1.7, R.z1 - 5.6, 0.45, '#efe7d2', 0.6);
        P.box(cx + sx * 1.6 - 0.3, SW_H, R.z1 - 12, cx + sx * 1.6 + 0.3, 2.4, R.z1 - 11.4, '#9e9a92');
      }
    },
    station(R) {
      if (R.x1 - R.x0 < 30) {
        // ロータリー脇の植え込み
        const zz1 = Math.min(R.z1, 47 * TILE - 0.5);
        hedgeAround({ x0: R.x0, x1: R.x1, z0: R.z0, z1: zz1 });
        tree((R.x0 + R.x1) / 2, (R.z0 + zz1) / 2, 'round', 1);
        return;
      }
      const sx0 = R.x0 + 10, sx1 = R.x1 - 10, sz0 = R.z0 + 0.5, sz1 = R.z0 + 20;
      B.facade.box(sx0, SW_H, sz0, sx1, 14.6, sz1, '#dde3e6', { uv: 'facade', topColor: '#aeb6ba' });
      // 駅前の大屋根（バス乗り場の上）
      P.box(sx0 - 2, 5, sz0 - 6, sx1 + 2, 5.5, sz0, '#e6e9eb');
      for (let x = sx0; x <= sx1; x += 12) {
        P.cylinder(x, SW_H, 47 * TILE + 1.0, 0.25, 5, '#9aa3a8', 6);
        colliders.circles.push({ x, z: 47 * TILE + 1.0, r: 0.3, kind: 'static' });
      }
      P.box(sx0 + 18, SW_H, sz0 - 0.1, sx1 - 18, 4.5, sz0, '#6f8ea6');
      textPlates.push({ texture: tex.station, x: (sx0 + sx1) / 2, y: 11, z: sz0 - 0.1, w: 16, h: 4, rotY: Math.PI });
      // 線路・ホーム・電車
      const tz = sz1 + 9;
      const tx0 = 39 * TILE, tx1 = 54 * TILE;
      P.box(tx0, SW_H, tz - 4, tx1, 0.35, tz + 4, '#8b8070');
      for (const rz of [tz - 0.75, tz + 0.75]) P.box(tx0, 0.35, rz - 0.06, tx1, 0.5, rz + 0.06, '#5b5f63');
      P.box(sx0, SW_H, sz1, sx1, 1.1, tz - 2.2, '#c2bdb3');
      for (let k = 0; k < 4; k++) {
        const x0 = sx0 + 4 + k * 20.5;
        P.box(x0, 0.6, tz - 1.45, x0 + 19.5, 4.2, tz + 1.45, '#f1ede3');
        P.box(x0 - 0.02, 2.1, tz - 1.47, x0 + 19.52, 3.3, tz + 1.47, '#2f4152');
        P.box(x0 - 0.03, 1.3, tz - 1.48, x0 + 19.53, 1.7, tz + 1.48, '#e8792b');
      }
      for (let x = tx0 + 3; x < tx1 - 3; x += 4) P.box(x, SW_H, R.z1 - 0.3, x + 0.12, 2, R.z1, '#888');
      P.box(tx0 + 3, 1.7, R.z1 - 0.3, tx1 - 3, 1.8, R.z1, '#888');
    },
    depot(R) {
      const L = { x0: R.x0 + 1, x1: R.x1 - 14, z0: R.z0 + 1, z1: R.z1 - 1 };
      for (let x = L.x0; x <= L.x1; x += 8) for (const z of [L.z0, L.z1]) P.box(x - 0.2, SW_H, z - 0.2, x + 0.2, 6, z + 0.2, '#8a9096');
      P.box(L.x0 - 1, 6, L.z0 - 1, L.x1 + 1, 6.5, L.z1 + 1, '#b0b6ba');
      for (let k = 0; k < 3; k++) parkedBus(L.x0 + 4 + k * 7.5, (L.z0 + L.z1) / 2);
      const ox = R.x1 - 12;
      B.facade.box(ox, SW_H, R.z0 + 2, R.x1 - 1, 9.6, R.z1 - 8, '#e8e4da', { uv: 'facade', topColor: '#bdb8ad' });
      textPlates.push({ texture: TX.textPlateTexture('限界交通 営業所', '#1f8a4c', '#ffffff'), x: ox + 5.5, y: 7.5, z: R.z0 + 1.9, w: 10, h: 1.4, rotY: Math.PI });
    },
    park(R) {
      const step = 11 / decorDensity;
      for (let x = R.x0 + 4; x < R.x1 - 2; x += step) {
        tree(x + range(rnd, -1, 1), (R.z0 + R.z1) / 2 + range(rnd, -2, 2), R.r0 >= 34 && R.r0 <= 35 ? 'sakura' : 'round', range(rnd, 0.9, 1.2));
      }
      P.box(R.x0, SW_H, R.z1 - 0.5, R.x1, 0.9, R.z1, '#4d7d3a');
    },
  };

  function torii(cx, z, s = 1) {
    const red = '#d4401f';
    P.cylinder(cx - 2.2 * s, SW_H, z, 0.25 * s, 4.6 * s, red, 8);
    P.cylinder(cx + 2.2 * s, SW_H, z, 0.25 * s, 4.6 * s, red, 8);
    P.box(cx - 3.2 * s, 4.6 * s, z - 0.3 * s, cx + 3.2 * s, 5.05 * s, z + 0.3 * s, '#222');
    P.box(cx - 2.7 * s, 3.8 * s, z - 0.18 * s, cx + 2.7 * s, 4.1 * s, z + 0.18 * s, red);
    P.box(cx - 0.2 * s, 4.1 * s, z - 0.15 * s, cx + 0.2 * s, 4.6 * s, z + 0.15 * s, red);
  }

  function houseLot(L, R) {
    const set = 1.2;
    const x0 = L.x0 + set, x1 = L.x1 - set, z0 = L.z0 + set, z1 = L.z1 - set;
    if (x1 - x0 < 4 || z1 - z0 < 4) return;
    if (rnd() < 0.08) {
      // 空き地・駐車場
      carProp((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2, rnd() < 0.5 ? 0 : Math.PI / 2);
      return;
    }
    const hx0 = x0 + range(rnd, 0, 1.2), hx1 = x1 - range(rnd, 0, 1.2);
    const hz0 = z0 + range(rnd, 0, 1.2), hz1 = z1 - range(rnd, 0, 1.2);
    const floors = rnd() < 0.75 ? 2 : 1;
    const h = SW_H + floors * 2.9;
    B.house.box(hx0, SW_H, hz0, hx1, h, hz1, pick(rnd, PAL.houseWall), { uv: 'facade', uw: 6, uh: 2.9, top: false });
    const alongX = hx1 - hx0 > hz1 - hz0;
    P.gableRoof(hx0, hz0, hx1, hz1, h, alongX ? (hz1 - hz0) * 0.32 : (hx1 - hx0) * 0.32, pick(rnd, PAL.roof), alongX, 0.5);
    // ブロック塀（道路側）
    const wallCol = '#b5b0a5';
    for (const s of ['n', 's', 'w', 'e']) {
      if (!L.edge[s] || !R.si[s].street) continue;
      const gx = range(rnd, 0.3, 0.6);
      if (s === 'n') { P.box(L.x0 + 0.2, SW_H, L.z0 + 0.2, L.x0 + (L.x1 - L.x0) * gx, 1.3, L.z0 + 0.35, wallCol); P.box(L.x0 + (L.x1 - L.x0) * gx + 2.4, SW_H, L.z0 + 0.2, L.x1 - 0.2, 1.3, L.z0 + 0.35, wallCol); }
      if (s === 's') { P.box(L.x0 + 0.2, SW_H, L.z1 - 0.35, L.x0 + (L.x1 - L.x0) * gx, 1.3, L.z1 - 0.2, wallCol); P.box(L.x0 + (L.x1 - L.x0) * gx + 2.4, SW_H, L.z1 - 0.35, L.x1 - 0.2, 1.3, L.z1 - 0.2, wallCol); }
      if (s === 'w') { P.box(L.x0 + 0.2, SW_H, L.z0 + 0.2, L.x0 + 0.35, 1.3, L.z0 + (L.z1 - L.z0) * gx, wallCol); P.box(L.x0 + 0.2, SW_H, L.z0 + (L.z1 - L.z0) * gx + 2.4, L.x0 + 0.35, 1.3, L.z1 - 0.2, wallCol); }
      if (s === 'e') { P.box(L.x1 - 0.35, SW_H, L.z0 + 0.2, L.x1 - 0.2, 1.3, L.z0 + (L.z1 - L.z0) * gx, wallCol); P.box(L.x1 - 0.35, SW_H, L.z0 + (L.z1 - L.z0) * gx + 2.4, L.x1 - 0.2, 1.3, L.z1 - 0.2, wallCol); }
    }
    if (rnd() < 0.45 * decorDensity) tree(L.x0 + 1.2, L.z0 + 1.2, rnd() < 0.3 ? 'pine' : 'round', 0.6);
  }

  function carProp(x, z, rotY) {
    const col = pick(rnd, PAL.car);
    P.boxRot(x, 0.75, z, 1.7, 0.9, 4.2, rotY, col);
    P.boxRot(x, 1.45, z, 1.5, 0.6, 2.2, rotY, '#2b3640');
  }

  function parkedBus(x, z) {
    P.boxRot(x, 1.75, z, 2.5, 2.9, 10.5, 0, '#f4f2ea');
    P.boxRot(x, 2.3, z, 2.55, 1.0, 9.6, 0, '#2a3a46');
    P.boxRot(x, 0.95, z, 2.56, 0.35, 10.52, 0, '#1f8a4c');
  }

  for (const R0 of rects) {
    const ir = insetRect(R0);
    const R = { ...R0, ...ir };
    const fn = gens[R0.zone] || gens.office;
    fn(R);
  }

  // 駅前ロータリーの時計塔（当たり判定あり）
  {
    const cx = 46.5 * TILE, cz = 44 * TILE;
    P.cylinder(cx, 0, cz, 3.2, 0.4, '#bdb7aa', 12);
    P.cylinder(cx, 0.4, cz, 2.6, 0.1, '#6f9a4a', 12);
    P.box(cx - 0.4, 0.4, cz - 0.4, cx + 0.4, 6, cz + 0.4, '#8d7b62');
    P.box(cx - 0.9, 6, cz - 0.9, cx + 0.9, 7.6, cz + 0.9, '#8d7b62');
    P.box(cx - 0.7, 6.15, cz - 0.95, cx + 0.7, 7.45, cz + 0.95, '#ffffff');
    P.box(cx - 0.95, 6.15, cz - 0.7, cx + 0.95, 7.45, cz + 0.7, '#ffffff');
    P.gableRoof(cx - 0.9, cz - 0.9, cx + 0.9, cz + 0.9, 7.6, 1.2, '#2f4f4f', true, 0.2);
    colliders.circles.push({ x: cx, z: cz, r: 3.2, kind: 'static' });
  }

  // ---------- 電柱と電線 ----------
  const poles = [];
  function pole(x, z, rotY) {
    P.cylinder(x, SW_H, z, 0.2, 9.5, '#9c9a94', 6);
    P.boxRot(x, 8.6, z, 2.2, 0.15, 0.15, rotY, '#7e7c77');
    P.box(x - 0.21, SW_H, z - 0.21, x + 0.21, 1.8, z + 0.21, '#f2c230');
    if (rnd() < 0.3) P.cylinder(x + Math.cos(rotY) * 0.6, 6.5, z - Math.sin(rotY) * 0.6, 0.35, 1.0, '#8e9599', 6);
    colliders.circles.push({ x, z, r: 0.3, kind: 'static' });
    poles.push({ x, z, rotY });
  }
  // 東西道路の北側歩道、南北道路の西側歩道に32m間隔
  const nearAvoid = (x, z) => nearStop(x, z, 14);
  for (const [r0] of Object.values(H_ROADS)) {
    let last = null;
    for (let x = 3 * TILE + 12; x < 56 * TILE - 6; x += 2) {
      const c = Math.floor(x / TILE);
      const z = r0 * TILE - 0.7;
      if (tileAt(c, r0 - 1) !== T.SOLID || isV(c) || isV(Math.floor((x - 5) / TILE)) || isV(Math.floor((x + 5) / TILE))) { last = null; continue; }
      if (last !== null && x - last < 32) continue;
      if (nearAvoid(x, z)) continue;
      pole(x, z, 0);
      last = x;
    }
  }
  for (const [c0] of Object.values(V_ROADS)) {
    let last = null;
    for (let z = 3 * TILE + 12; z < 56 * TILE - 6; z += 2) {
      const r = Math.floor(z / TILE);
      const x = c0 * TILE - 0.7;
      if (tileAt(c0 - 1, r) !== T.SOLID || isH(r) || isH(Math.floor((z - 5) / TILE)) || isH(Math.floor((z + 5) / TILE))) { last = null; continue; }
      if (last !== null && z - last < 32) continue;
      if (nearAvoid(x, z)) continue;
      pole(x, z, Math.PI / 2);
      last = z;
    }
  }
  // 電線: 近い電柱同士をつなぐ
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i];
    for (let j = i + 1; j < poles.length; j++) {
      const b = poles[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 36 || (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.z - b.z) > 0.5)) continue;
      for (const [off, hgt] of [[-0.9, 8.65], [0.9, 8.65], [0, 7.6]]) {
        const ax = a.x + Math.cos(a.rotY) * off, az = a.z - Math.sin(a.rotY) * off;
        const bx = b.x + Math.cos(b.rotY) * off, bz = b.z - Math.sin(b.rotY) * off;
        const segs = 6;
        for (let k = 0; k < segs; k++) {
          const t0 = k / segs, t1 = (k + 1) / segs;
          const sag = (t) => hgt - Math.sin(Math.PI * t) * 0.6;
          wires.push(ax + (bx - ax) * t0, sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, sag(t1), az + (bz - az) * t1);
        }
      }
    }
  }

  // ---------- 壊せる小物の配置 ----------
  const addSpawn = (type, x, z, rot = 0, variant = 0) => {
    if (type !== 'guardrail' && nearStop(x, z, 13)) return;
    spawns[type].push({ x, z, rot, variant });
  };

  // 川沿いのガードレール（r3 の南端）
  {
    const z = 29 * TILE + 0.5;
    for (let x = 5 * TILE; x < 56 * TILE; x += 4) {
      const c = Math.floor((x + 2) / TILE);
      if (tileAt(c, 29) !== T.BANK) continue;
      addSpawn('guardrail', x + 2, z, 0);
    }
  }
  // 小学校前の歩道ガードレール
  {
    const z = 19 * TILE + 0.35;
    for (let x = 22 * TILE + 6; x < 37 * TILE - 6; x += 4) addSpawn('guardrail', x + 2, z, 0);
    const x = 22 * TILE + 0.35;
    for (let zz = 19 * TILE + 6; zz < 27 * TILE - 6; zz += 4) {
      if (Math.abs(zz + 2 - 24.5 * TILE) < 13) continue; // 停留所の前は切れ目
      addSpawn('guardrail', x, zz + 2, Math.PI / 2);
    }
  }

  // 路地ごとの小物
  for (const a of ALLEYS) {
    const [c0, r0, c1, r1] = a.rect;
    const vertical = c0 === c1;
    const len = vertical ? (r1 - r0 + 1) * TILE : (c1 - c0 + 1) * TILE;
    const base = vertical ? r0 * TILE : c0 * TILE;
    const lineA = vertical ? c0 * TILE + 0.8 : r0 * TILE + 0.8;
    const lineB = vertical ? (c0 + 1) * TILE - 0.8 : (r0 + 1) * TILE - 0.8;
    const at = (along, across, type, variant = 0) => {
      const x = vertical ? across : along, z = vertical ? along : across;
      addSpawn(type, x, z, vertical ? 0 : Math.PI / 2, variant);
    };
    for (let p = 6; p < len - 6; p += 3.2) {
      const along = base + p;
      const side = Math.floor(p / 3.2) % 2 === 0 ? lineA : lineB;
      const roll = rnd();
      if (a.kind === 'shop') {
        if (roll < 0.35) at(along, side, 'board', Math.floor(rnd() * 4));
        else if (roll < 0.75) at(along, side, 'pot');
      } else if (a.kind === 'house') {
        if (roll < 0.55) at(along, side, 'pot');
        else if (roll < 0.62) at(along, side, 'board', 3);
      } else if (a.kind === 'factory') {
        // 工事中: ジグザグのコーンとバリケード
        const zig = Math.floor(p / 6.4) % 2 === 0;
        if (roll < 0.8) at(along, zig ? lineA + 1.4 : lineB - 1.4, 'cone');
        if (Math.floor(p / 3.2) % 5 === 2) at(along, zig ? lineB - 0.3 : lineA + 0.3, 'barricade');
      } else if (a.kind === 'danchi') {
        if (roll < 0.35) at(along, side, 'cone');
        else if (roll < 0.65) at(along, side, 'pot');
        else if (roll < 0.72) at(along, side, 'sign', 2);
      } else if (a.kind === 'shrine') {
        if (Math.floor(p / 3.2) % 2 === 0) {
          at(along, lineA, 'nobori');
          at(along, lineB, 'nobori');
        } else if (roll < 0.3) at(along, side, 'pot');
      }
    }
    // 路地の出入口に「止まれ」標識（歩道の角）
    const ends = vertical
      ? [[c0 * TILE - 0.6, r0 * TILE + 0.8], [(c0 + 1) * TILE + 0.6, (r1 + 1) * TILE - 0.8]]
      : [[c0 * TILE + 0.8, (r0 + 1) * TILE + 0.6], [(c1 + 1) * TILE - 0.8, r0 * TILE - 0.6]];
    for (const [x, z] of ends) addSpawn('sign', x, z, 0, 0);
  }

  // 幹線の歩道: 交差点角の標識、商店前の植木鉢・立て看板、工事区間のコーン
  for (const it of intersections) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([sx, sz], k) => {
      const x = it.x + sx * (TILE + 1.1), z = it.z + sz * (TILE + 1.1);
      const c = Math.floor(x / TILE), r = Math.floor(z / TILE);
      if (tileAt(c, r) !== T.SOLID) return;
      if ((k + it.c + it.r) % 2 === 0) addSpawn('sign', x, z, 0, 1);
    });
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (tileAt(c, r) !== T.SOLID) continue;
      const zone = zoneAt(c, r);
      const rect = solidRectForTile(c, r);
      const dirs = [];
      if (rect.z0 > r * TILE) dirs.push(['n', (c + 0.5) * TILE, r * TILE + 1.3]);
      if (rect.z1 < (r + 1) * TILE) dirs.push(['s', (c + 0.5) * TILE, (r + 1) * TILE - 1.3]);
      if (rect.x0 > c * TILE) dirs.push(['w', c * TILE + 1.3, (r + 0.5) * TILE]);
      if (rect.x1 < (c + 1) * TILE) dirs.push(['e', (c + 1) * TILE - 1.3, (r + 0.5) * TILE]);
      for (const [, x, z] of dirs) {
        if (nearPole(x, z)) continue;
        const roll = rnd();
        if (zone === 'shop') {
          if (roll < 0.35) addSpawn('pot', x + range(rnd, -2, 2), z);
          else if (roll < 0.55) addSpawn('board', x + range(rnd, -2, 2), z, rnd() * 0.6 - 0.3, Math.floor(rnd() * 4));
        } else if (zone === 'house' || zone === 'mansion') {
          if (roll < 0.12) addSpawn('pot', x, z);
        } else if (zone === 'office' || zone === 'cityhall' || zone === 'hospital') {
          if (roll < 0.06) addSpawn('board', x, z, 0, Math.floor(rnd() * 4));
          else if (roll < 0.14) addSpawn('pot', x, z);
        } else if (zone === 'station') {
          if (roll < 0.3) addSpawn('pot', x, z);
        }
      }
    }
  }
  function nearPole(x, z) {
    return colliders.circles.some((p) => Math.abs(p.x - x) < 2.5 && Math.abs(p.z - z) < 2.5);
  }
  // 工事区間（路肩にコーン列）
  const works = [
    { x0: 26 * TILE, x1: 31 * TILE, z: 41 * TILE + 1.2 }, // r4 北側路肩
    { x0: 8 * TILE, x1: 13 * TILE, z: 56 * TILE - 1.2 }, // r5 南側路肩
  ];
  for (const w of works) {
    for (let x = w.x0; x <= w.x1; x += 2.5) addSpawn('cone', x, w.z);
    addSpawn('barricade', w.x0 - 1, w.z, Math.PI / 2);
  }
  // 縦の道の路肩にも
  for (let z = 6 * TILE; z <= 10 * TILE; z += 2.5) addSpawn('cone', 55 * TILE + 6.8, z + 0.0);
  for (let z = 44 * TILE; z <= 47 * TILE; z += 2.5) addSpawn('cone', 3 * TILE + 1.2, z);

  // 自動販売機（幹線の歩道、建物の際。当たり判定あり）
  for (const R0 of rects) {
    if (!['shop', 'house', 'office', 'mansion'].includes(R0.zone)) continue;
    if (rnd() > 0.5) continue;
    const ir = insetRect(R0);
    const s = ['n', 's', 'w', 'e'].find((k) => ir.si[k].main);
    if (!s) continue;
    const t = range(rnd, 0.2, 0.8);
    let x, z, rot;
    if (s === 'n') { x = ir.x0 + (ir.x1 - ir.x0) * t; z = ir.z0 - 0.45; rot = Math.PI; }
    if (s === 's') { x = ir.x0 + (ir.x1 - ir.x0) * t; z = ir.z1 + 0.45; rot = 0; }
    if (s === 'w') { x = ir.x0 - 0.45; z = ir.z0 + (ir.z1 - ir.z0) * t; rot = -Math.PI / 2; }
    if (s === 'e') { x = ir.x1 + 0.45; z = ir.z0 + (ir.z1 - ir.z0) * t; rot = Math.PI / 2; }
    if (nearStop(x, z, 14) || nearPole(x, z)) continue;
    vending(x, z, rot);
    colliders.circles.push({ x, z, r: 0.55, kind: 'static' });
  }

  // ---------- メッシュ化 ----------
  // 地面は上から見た平面に UV を割り当てて、粒状のテクスチャを敷く
  const groundGeo = B.ground.build();
  {
    const pos = groundGeo.getAttribute('position'), uv = groundGeo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    uv.needsUpdate = true;
  }
  const mats = {
    ground: new THREE.MeshLambertMaterial({ vertexColors: true, map: TX.groundNoiseTexture() }),
    marks: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    facade: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.windows }),
    house: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.house }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    signs: new THREE.MeshLambertMaterial({ map: tex.signs, side: THREE.FrontSide, emissive: 0x222222 }),
    water: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x88aacc }),
  };
  const group = new THREE.Group();
  group.name = 'city';
  const meshes = {};
  for (const [k, b] of Object.entries(B)) {
    if (!b.vertexCount || !mats[k]) continue;
    const m = new THREE.Mesh(k === 'ground' ? groundGeo : b.build(), mats[k]);
    m.name = k;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    if (k === 'facade' || k === 'house' || k === 'plain') m.castShadow = true;
    if (k !== 'signs') m.receiveShadow = true;
    meshes[k] = m;
    group.add(m);
  }

  if (wires.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const lines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a }));
    lines.name = 'wires';
    group.add(lines);
  }

  for (const p of textPlates) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshLambertMaterial({ map: p.texture, emissive: 0x333333 }));
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.rotY;
    group.add(m);
  }

  scene.add(group);

  return {
    group,
    meshes,
    materials: mats,
    colliders,
    spawns,
    intersections,
    textures: tex,
  };
}
