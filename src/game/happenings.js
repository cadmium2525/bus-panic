// 運行中のハプニング：工事の通行止め・急ぎの客・ライバル会社のバス
import * as THREE from 'three';
import { TILE, N, T, tileAt, shortestPath } from '../world/map.js';
import { Bus } from '../entities/bus.js';
import { LIVERIES, labelTexture } from '../world/textures.js';
import { Autopilot } from './autopilot.js';
import { inZone, legPath } from './stops.js';

/** 交差点の間の区間（タイルの範囲と、両端のバリケードを置く位置） */
function segmentOf(a, b) {
  const tiles = [];
  if (a.r === b.r) {
    const [c0, c1] = a.c < b.c ? [a.c + 2, b.c - 1] : [b.c + 2, a.c - 1];
    for (let c = c0; c <= c1; c++) for (const r of [a.r, a.r + 1]) tiles.push(r * N + c);
    return { horizontal: true, c0, c1, r0: a.r, r1: a.r + 1, tiles };
  }
  const [r0, r1] = a.r < b.r ? [a.r + 2, b.r - 1] : [b.r + 2, a.r - 1];
  for (let r = r0; r <= r1; r++) for (const c of [a.c, a.c + 1]) tiles.push(r * N + c);
  return { horizontal: false, c0: a.c, c1: a.c + 1, r0, r1, tiles };
}

/**
 * 通行止めにする区間を選ぶ。橋・停留所のある区間・最初の区間は避け、全停留所に行けることを確かめる。
 * よく使う道（停留所間の最短経路）を優先する。
 */
export function planClosures(nodes, stops, start, rnd, count) {
  if (count <= 0) return [];
  const pairs = [];
  for (const a of nodes) for (const b of a.nb) if (a.id < b.id) pairs.push([a, b]);
  // 停留所間の最短経路（幹線）に含まれるタイル
  const used = new Set();
  stops.forEach((s, i) => {
    const p = legPath(stops[i - 1], s);
    if (p) for (const t of p.path) used.add(t.r * N + t.c);
  });
  const cands = [];
  for (const [a, b] of pairs) {
    const seg = segmentOf(a, b);
    if (seg.tiles.length < 4) continue;
    if (seg.tiles.some((i) => tileAt(i % N, (i / N) | 0) !== T.ROAD)) continue; // 橋・広場を含まない
    if (stops.some((s) => s.c >= seg.c0 - 1 && s.c <= seg.c1 + 1 && s.r >= seg.r0 - 1 && s.r <= seg.r1 + 1)) continue;
    if (seg.r0 <= 5 && seg.c0 <= 12) continue; // 出発直後は避ける
    const score = seg.tiles.filter((i) => used.has(i)).length / seg.tiles.length;
    cands.push({ a, b, seg, w: 0.3 + score * 3 });
  }
  const out = [];
  const blocked = new Set();
  for (let k = 0; k < count && cands.length; k++) {
    // 重み付きで選ぶ
    let total = cands.reduce((s, c) => s + c.w, 0), x = rnd() * total, idx = 0;
    for (; idx < cands.length - 1; idx++) if ((x -= cands[idx].w) <= 0) break;
    const c = cands.splice(idx, 1)[0];
    const trial = new Set([...blocked, ...c.seg.tiles]);
    // 全停留所へ行けるか
    let ok = true;
    let p0 = { c: start.c, r: start.r };
    for (const s of stops) {
      if (!shortestPath(p0, { c: s.c, r: s.r }, true, trial)) { ok = false; break; }
      p0 = { c: s.c, r: s.r };
    }
    if (!ok) { k--; continue; }
    for (const t of c.seg.tiles) blocked.add(t);
    out.push(c);
  }
  return out.map((c) => ({ a: c.a, b: c.b, seg: c.seg, spawns: barricadesFor(c.seg) }));
}

/** 区間の両端に、道幅いっぱいのバリケードとコーン */
function barricadesFor(seg) {
  const sp = [];
  if (seg.horizontal) {
    const z0 = seg.r0 * TILE, z1 = (seg.r1 + 1) * TILE;
    for (const x of [seg.c0 * TILE + 3, (seg.c1 + 1) * TILE - 3]) {
      for (let z = z0 + 1; z < z1 - 0.5; z += 2) sp.push({ type: 'barricade', x, z, rot: Math.PI / 2 });
      const out = x < (seg.c0 + seg.c1 + 1) * TILE / 2 ? -1 : 1;
      for (let z = z0 + 2; z < z1 - 1; z += 3.5) sp.push({ type: 'cone', x: x + out * 2.2, z: z + 1 });
    }
  } else {
    const x0 = seg.c0 * TILE, x1 = (seg.c1 + 1) * TILE;
    for (const z of [seg.r0 * TILE + 3, (seg.r1 + 1) * TILE - 3]) {
      for (let x = x0 + 1; x < x1 - 0.5; x += 2) sp.push({ type: 'barricade', x, z, rot: 0 });
      const out = z < (seg.r0 + seg.r1 + 1) * TILE / 2 ? -1 : 1;
      for (let x = x0 + 2; x < x1 - 1; x += 3.5) sp.push({ type: 'cone', x: x + 1, z: z + out * 2.2 });
    }
  }
  return sp;
}

/**
 * lo〜hi の整数から count 個を、互いに gap 以上離して選ぶ（入りきらなければ入るだけ）。
 * 余白をランダムに配ってから並べるので、指定した数はかならず確保できる。
 */
export function pickSpaced(lo, hi, count, gap, rnd) {
  const n = Math.max(0, Math.min(count, Math.floor((hi - lo) / gap) + 1));
  if (n === 0) return [];
  const free = hi - lo - (n - 1) * gap;
  const offs = Array.from({ length: n }, () => Math.floor(rnd() * (free + 1))).sort((a, b) => a - b);
  return offs.map((o, k) => lo + o + k * gap);
}

/** 急ぎの客：乗る停留所と、2 つ先の降りる停留所（終点には行かない） */
export function planHurry(stops, rnd, count) {
  return pickSpaced(1, stops.length - 4, count, 2, rnd).map((i) => ({ from: i, to: i + 2, state: 'waiting', deadline: 0 }));
}

/** ライバルが現れる停留所（その停留所を発車したときに後ろから来て、2 つ先を狙う） */
export function planRivals(stops, rnd, count) {
  return pickSpaced(1, stops.length - 4, count, 3, rnd);
}

/** ライバル会社「ギリギリ交通」のバス */
export class Rival {
  constructor(scene) {
    this.bus = new Bus(scene, { livery: LIVERIES.rival });
    this.bus.tuning.speed = 0.85;
    this.ap = new Autopilot({ cruise: 13.5, turnSpeed: 7.5, decel: 7 });
    this.state = 'off';
    this.bus.model.root.visible = false;
    this.hidden = true;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(['ライバル', 'ギリギリ交通'], { accent: '#ff6b5e' }), transparent: true, depthWrite: false }));
    label.scale.set(4.2, 1.3, 1);
    label.position.y = 5.2;
    this.bus.model.root.add(label);
    // 自分のバスとぶつかる用の当たり（Bus._collide が車と同じように扱う）
    this.proxy = { solid: true, isRival: true, reach: 9, circles: [], x: 0, z: 0, h: 0 };
  }

  get x() {
    return this.bus.x;
  }
  get z() {
    return this.bus.z;
  }
  get h() {
    return this.bus.h;
  }

  start(x, z, h, target) {
    this.bus.reset(x, z, h);
    this.bus.vx = Math.sin(h) * 12;
    this.bus.vz = Math.cos(h) * 12;
    this.ap = new Autopilot({ cruise: 13.5, turnSpeed: 7.5, decel: 7 });
    this.ap.railway = this.railway;
    this.ap.blocked = this.blocked;
    this.target = target;
    this.state = 'race';
    this.timer = 0;
    this.hidden = false;
    this.bus.model.root.visible = true;
    this.proxy.solid = true;
  }

  stop() {
    this.state = 'off';
    this.hidden = true;
    this.proxy.solid = false;
    this.bus.model.root.visible = false;
  }

  /** env: 衝突用（電柱・他車・電車）、props: 小物（罰金なしで倒す） */
  step(dt, env, props) {
    if (this.state === 'off') return null;
    let input = { throttle: false, brake: false, steer: 0, handbrake: false };
    let event = null;
    if (this.state === 'race') {
      input = this.ap.drive(this.bus, this.target, dt);
      if (inZone(this.target, this.bus.x, this.bus.z) && this.bus.speed < 1.5) {
        this.state = 'dwell';
        this.timer = 3;
        this.bus.doorTarget = 1;
        event = 'arrived';
      }
    } else if (this.state === 'dwell') {
      input.hold = true;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.bus.doorTarget = 0;
        this.state = 'leave';
        this.timer = 6;
      }
    } else if (this.state === 'leave' || this.state === 'giveup') {
      input = { throttle: true, brake: false, steer: 0, handbrake: false };
      this.timer -= dt;
      if (this.timer <= 0) this.stop();
    }
    if (this.state !== 'off') {
      this.bus.step(dt, input, env);
      if (props) for (const c of this.bus.circles.slice(0, 4)) props.collideOther(c.x, c.z, c.r, this.bus.vx, this.bus.vz);
      this.proxy.circles = this.bus.circles.slice(0, 4);
      this.proxy.x = this.bus.x;
      this.proxy.z = this.bus.z;
      this.proxy.h = this.bus.h;
    }
    return event;
  }

  giveUp() {
    if (this.state === 'race') {
      this.state = 'giveup';
      this.timer = 5;
    }
  }

  sync(alpha) {
    if (this.state !== 'off') this.bus.sync(alpha);
  }

  doorPos() {
    const b = this.bus, fx = Math.sin(b.h), fz = Math.cos(b.h);
    return { x: b.x + fz * 1.6, z: b.z - fx * 1.6 };
  }
}

/** 自分のバスの後ろ（走れる場所）を探す */
export function spotBehind(bus, dist) {
  const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
  for (let d = dist; d > 8; d -= 4) {
    const x = bus.x - fx * d, z = bus.z - fz * d;
    const t = tileAt(Math.floor(x / TILE), Math.floor(z / TILE));
    if (t === T.ROAD || t === T.BRIDGE || t === T.PLAZA) return { x, z, h: bus.h };
  }
  return null;
}
