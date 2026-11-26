// 停留所データ（固定ルート15か所）と時刻表
import { TILE, tileCenter, shortestPath, drivePath, RAIL } from '../world/map.js';
import { buildSchedule, dwellTime } from './rules.js';
import { RULES } from '../config.js';

// c,r: 停留所のある車線タイル / curb: 歩道側の方角 / wait: 初期待機人数 / off: 降車人数
// 左側通行で U ターンせずに回れる順路。工場前・南町・新町の 3 区間は、路地を抜けると本線より大きく短縮できる
export const STOP_DEFS = [
  { name: '限界営業所前', kana: 'げんかいえいぎょうしょまえ', c: 9, r: 4, curb: 'S', wait: 6, off: 0 },
  { name: '銀座商店街', kana: 'ぎんざしょうてんがい', c: 4, r: 9, curb: 'E', wait: 14, off: 2 },
  { name: '市役所前', kana: 'しやくしょまえ', c: 4, r: 21, curb: 'E', wait: 13, off: 6 },
  { name: '限界小学校前', kana: 'げんかいしょうがっこうまえ', c: 29, r: 27, curb: 'N', wait: 9, off: 5 },
  { name: '工場前', kana: 'こうじょうまえ', c: 43, r: 18, curb: 'S', wait: 12, off: 7 },
  { name: '北町二丁目', kana: 'きたまちにちょうめ', c: 37, r: 11, curb: 'W', wait: 11, off: 6 },
  { name: '稲荷神社前', kana: 'いなりじんじゃまえ', c: 46, r: 3, curb: 'N', wait: 10, off: 6 },
  { name: '東町一丁目', kana: 'ひがしまちいっちょうめ', c: 55, r: 11, curb: 'E', wait: 8, off: 6 },
  { name: '市民病院前', kana: 'しみんびょういんまえ', c: 38, r: 37, curb: 'E', wait: 15, off: 14 },
  { name: '南町', kana: 'みなみまち', c: 33, r: 54, curb: 'N', wait: 10, off: 9 },
  { name: '東町', kana: 'ひがしまち', c: 54, r: 46, curb: 'W', wait: 9, off: 8 },
  { name: '図書館前', kana: 'としょかんまえ', c: 24, r: 42, curb: 'S', wait: 12, off: 10 },
  { name: '団地中央', kana: 'だんちちゅうおう', c: 4, r: 46, curb: 'E', wait: 16, off: 9 },
  { name: '新町', kana: 'しんまち', c: 28, r: 41, curb: 'N', wait: 10, off: 10 },
  { name: '限界駅（終点）', kana: 'げんかいえき', c: 46, r: 45, curb: 'N', wait: 0, off: 999, terminal: true },
];

// 営業所の前（東行き車線の 1 本南＝西行き車線）から西向きに出発
export const START = { c: 13, r: 4, x: 13 * TILE + 4, z: 4.5 * TILE, heading: -Math.PI / 2 };

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
    travel: { x: TRAVEL[def.curb][0], z: TRAVEL[def.curb][1] },
  };
}

/** 左側通行での停留所への進行方向（歩道が北なら東行き…） */
export const TRAVEL = { N: [1, 0], S: [-1, 0], E: [0, 1], W: [0, -1] };

/** 向き（ラジアン、0 = +z）を東西南北の [dc, dr] に丸める */
export function headingDir(h) {
  const fx = Math.sin(h), fz = Math.cos(h);
  return Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
}

/**
 * 停留所まで、正しい向き（歩道を左に見る向き）で入ってくる経路。
 * startDir（いまの進行方向）を渡すと、その場で U ターンしない経路を選ぶ。曲がり角は少ないほうを選ぶ。
 */
export function approachPath(from, stop, allowAlley = false, blocked = null, startDir = null) {
  const to = { c: stop.c, r: stop.r };
  const endDir = stop.terminal || !stop.curb ? null : TRAVEL[stop.curb];
  return (
    drivePath(from, to, { allowAlley, blocked, startDir, endDir }) ||
    drivePath(from, to, { allowAlley, blocked, endDir }) ||
    drivePath(from, to, { allowAlley, blocked }) ||
    shortestPath(from, to, allowAlley, blocked)
  );
}

/** 停留所を出るときの向き（最初は営業所から東向き） */
export function departDir(prevStop) {
  return prevStop && prevStop.curb && !prevStop.terminal ? TRAVEL[prevStop.curb] : headingDir(START.heading);
}

/** 区間の経路（前の停留所 → 次の停留所。幹線のみ） */
export function legPath(prevStop, stop, blocked = null, allowAlley = false) {
  const from = prevStop ? { c: prevStop.c, r: prevStop.r } : { c: START.c, r: START.r };
  return approachPath(from, stop, allowAlley, blocked, departDir(prevStop));
}

/** 時刻表用の区間の走行時間（停車時間・踏切待ちを除く）。自動運転の実測（3.1 秒 + 距離 ÷ 13.5m/s + 曲がり 1.2 秒）より少し遅い人を想定 */
export function legTime(p) {
  if (!p) return 25;
  return RULES.scheduleLegSec + (p.tiles * TILE) / RULES.scheduleSpeed + (p.turns || 0) * RULES.scheduleTurnSec;
}

/** 経路が線路（踏切）を渡る回数 */
export function railCrossings(p) {
  if (!p) return 0;
  let n = 0;
  for (let i = 1; i < p.path.length; i++) if (RAIL.rows.includes(p.path[i].r) && !RAIL.rows.includes(p.path[i - 1].r)) n++;
  return n;
}

/** 時刻表に載せる区間の秒数：走行 ＋ 踏切待ちの余裕 ＋ 終点のロータリーに入る分 */
export function legSeconds(p, stop) {
  return legTime(p) + railCrossings(p) * RULES.crossingSlackSec + (stop && stop.terminal ? RULES.terminalExtraSec : 0);
}

/** 時刻表に載せる停車時間（待っている客が全員乗った場合の乗降時間） */
export function scheduleDwell(def) {
  return def.terminal ? 0 : dwellTime(def.wait, def.off) + RULES.scheduleDwellExtraSec;
}

export function legDistances() {
  return STOP_DEFS.map((s, i) => {
    const p = legPath(STOP_DEFS[i - 1], s);
    return p ? p.tiles * TILE : 300;
  });
}

/** 各区間で線路（踏切）を渡るか */
export function legCrossesRail() {
  return STOP_DEFS.map((s, i) => railCrossings(legPath(STOP_DEFS[i - 1], s)) > 0);
}

/** 停留所を一部だけ回るコース（入門コース）の時刻表。course は停留所番号の並び */
export function courseSchedule(stops, course) {
  const legs = course.map((i, k) => legSeconds(legPath(k ? stops[course[k - 1]] : null, stops[i]), stops[i]));
  return buildSchedule(legs, { dwells: course.map((i) => scheduleDwell(stops[i])) });
}

export function createStops() {
  // 区間ごとの所要時間（距離 ÷ 想定速度 ＋ 曲がり角 ＋ 踏切待ち）と停車時間を足して時刻表を作る
  const legs = STOP_DEFS.map((s, i) => legSeconds(legPath(STOP_DEFS[i - 1], s), s));
  const sched = buildSchedule(legs, { dwells: STOP_DEFS.map(scheduleDwell) });
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
