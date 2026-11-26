// 停留所データ（固定ルート15か所）と時刻表
import { TILE, tileCenter, shortestPath, RAIL } from '../world/map.js';
import { buildSchedule } from './rules.js';
import { RULES } from '../config.js';

// c,r: 停留所のある車線タイル / curb: 歩道側の方角 / wait: 初期待機人数 / off: 降車人数
export const STOP_DEFS = [
  { name: '限界営業所前', kana: 'げんかいえいぎょうしょまえ', c: 9, r: 3, curb: 'N', wait: 6, off: 0 },
  { name: '銀座商店街', kana: 'ぎんざしょうてんがい', c: 15, r: 17, curb: 'N', wait: 14, off: 2 },
  { name: '限界小学校前', kana: 'げんかいしょうがっこうまえ', c: 21, r: 24, curb: 'E', wait: 9, off: 4 },
  { name: '工場前', kana: 'こうじょうまえ', c: 44, r: 27, curb: 'N', wait: 12, off: 5 },
  { name: '東町一丁目', kana: 'ひがしまちいっちょうめ', c: 50, r: 17, curb: 'N', wait: 8, off: 6 },
  { name: '稲荷神社前', kana: 'いなりじんじゃまえ', c: 46, r: 4, curb: 'S', wait: 10, off: 5 },
  { name: '北町二丁目', kana: 'きたまちにちょうめ', c: 38, r: 12, curb: 'E', wait: 11, off: 6 },
  { name: '市民病院前', kana: 'しみんびょういんまえ', c: 45, r: 41, curb: 'N', wait: 15, off: 12 },
  { name: '東町', kana: 'ひがしまち', c: 55, r: 48, curb: 'E', wait: 9, off: 7 },
  { name: '南町', kana: 'みなみまち', c: 33, r: 55, curb: 'S', wait: 10, off: 9 },
  { name: '図書館前', kana: 'としょかんまえ', c: 25, r: 42, curb: 'S', wait: 12, off: 10 },
  { name: '団地中央', kana: 'だんちちゅうおう', c: 4, r: 46, curb: 'E', wait: 16, off: 10 },
  { name: '新町', kana: 'しんまち', c: 12, r: 54, curb: 'N', wait: 10, off: 12 },
  { name: '市役所前', kana: 'しやくしょまえ', c: 12, r: 27, curb: 'N', wait: 13, off: 15 },
  { name: '限界駅（終点）', kana: 'げんかいえき', c: 46, r: 45, curb: 'N', wait: 0, off: 999, terminal: true },
];

export const START = { c: 5, r: 3, x: 5 * TILE + 2, z: 3.5 * TILE, heading: Math.PI / 2 };

const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function geometry(def) {
  const ctr = tileCenter(def.c, def.r);
  const [dx, dz] = DIRS[def.curb];
  if (def.terminal) {
    // ロータリー奥のバス乗り場（駅舎側 = 南）
    const curbLine = 47 * TILE;
    return {
      zone: { cx: ctr.x, cz: ctr.z + 4.5, hx: 8, hz: 6.5 },
      pole: { x: ctr.x - 7, z: 47 * TILE + 1.2 },
      curbDir: { x: 0, z: 1 },
      along: { x: 1, z: 0 },
      center: { x: ctr.x, z: ctr.z + 4 },
      curbLine,
      // 理想の停車位置（バスの中心）。縁石から 0.5m あけてぴったり寄せる
      target: { x: ctr.x, z: curbLine - 1.75 },
    };
  }
  const alongX = dz !== 0; // 歩道が南北側なら道路は東西方向
  const zone = alongX
    ? { cx: ctr.x, cz: ctr.z, hx: 11, hz: 4.3 }
    : { cx: ctr.x, cz: ctr.z, hx: 4.3, hz: 11 };
  // 歩道上（縁石から1.2m）に標柱。左側通行なので、歩道が北なら東行き・南なら西行き・東なら南行き・西なら北行き。
  // 標柱は進行方向の前寄りに立てる（ここに中扉を合わせて止めるとピタ止め）
  const fwd = def.curb === 'N' || def.curb === 'E' ? 1 : -1;
  const curbEdgeX = ctr.x + dx * (TILE / 2);
  const curbEdgeZ = ctr.z + dz * (TILE / 2);
  const pole = { x: curbEdgeX + dx * 1.2 + (alongX ? 5 * fwd : 0), z: curbEdgeZ + dz * 1.2 + (alongX ? 0 : 5 * fwd) };
  const curbLine = curbEdgeX * dx + curbEdgeZ * dz; // curbDir 方向の座標
  // 理想の停車位置（バスの中心）：中扉を標柱の横に、縁石から 0.5m
  const lat = (curbLine - 1.75) * (alongX ? dz : dx);
  const target = alongX ? { x: pole.x, z: lat } : { x: lat, z: pole.z };
  return {
    zone,
    pole,
    curbDir: { x: dx, z: dz },
    along: alongX ? { x: 1, z: 0 } : { x: 0, z: 1 },
    center: { x: ctr.x, z: ctr.z },
    curbLine,
    target,
  };
}

export function legDistances() {
  const out = [];
  let prev = { c: START.c, r: START.r };
  for (const s of STOP_DEFS) {
    const p = shortestPath(prev, { c: s.c, r: s.r }, false);
    out.push(p ? p.tiles * TILE : 300);
    prev = { c: s.c, r: s.r };
  }
  return out;
}

/** 各区間で線路（踏切）を渡るか。渡る区間は電車待ちの分だけ時刻表に余裕を持たせる */
export function legCrossesRail() {
  const out = [];
  let prev = { c: START.c, r: START.r };
  for (const s of STOP_DEFS) {
    const p = shortestPath(prev, { c: s.c, r: s.r }, false);
    out.push(!!p && p.path.some((t) => RAIL.rows.includes(t.r)));
    prev = { c: s.c, r: s.r };
  }
  return out;
}

export function createStops() {
  const cross = legCrossesRail();
  const sched = buildSchedule(legDistances().map((d, i) => d + (cross[i] ? RULES.crossingSlackSec * RULES.scheduleSpeed : 0)));
  return STOP_DEFS.map((def, i) => ({
    index: i,
    ...def,
    ...geometry(def),
    scheduled: sched[i], // 発車からの秒数
  }));
}

/** ピタ止めの測定：停止位置からの前後のずれ（m）と縁石とのすき間（m） */
export function stopError(stop, x, z) {
  const along = (x - stop.target.x) * stop.along.x + (z - stop.target.z) * stop.along.z;
  const gap = stop.curbLine - (x * stop.curbDir.x + z * stop.curbDir.z) - 1.25;
  return { along, gap };
}

export function inZone(stop, x, z) {
  const zn = stop.zone;
  return Math.abs(x - zn.cx) <= zn.hx && Math.abs(z - zn.cz) <= zn.hz;
}
