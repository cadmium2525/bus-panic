// 鉄道：街の南を東西に走る電車と、道路との踏切（警報灯・遮断機）
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshBuilder.js';
import { RAIL } from '../world/map.js';

const CAR_LEN = 20;
const CARS = 6;
const GAP = 0.7;
const SPEED = 21; // m/s
const HALF_W = 1.45;
const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * GAP;
const WARN_AHEAD = SPEED * 6.5; // 電車が来る 6.5 秒前から鳴る
const X_MIN = -420, X_MAX = 900;

function trainGeometry() {
  // 先頭が x=0、後ろへ -x 方向に車両が続く
  const m = new MeshBuilder();
  for (let k = 0; k < CARS; k++) {
    const x1 = -k * (CAR_LEN + GAP), x0 = x1 - CAR_LEN;
    m.box(x0, 0.7, -HALF_W, x1, 3.7, HALF_W, '#efebe1', { topColor: '#9aa0a4' });
    m.box(x0 - 0.01, 2.05, -HALF_W - 0.02, x1 + 0.01, 3.05, HALF_W + 0.02, '#2b3a47', { top: false });
    m.box(x0 - 0.02, 1.35, -HALF_W - 0.03, x1 + 0.02, 1.7, HALF_W + 0.03, '#e8792b', { top: false });
    for (const dx of [2.5, CAR_LEN / 2 - 0.6, CAR_LEN - 3.1]) m.box(x0 + dx, 0.8, HALF_W + 0.01, x0 + dx + 1.3, 3.2, HALF_W + 0.04, '#5d6b75', { top: false });
    for (const dx of [2.5, CAR_LEN / 2 - 0.6, CAR_LEN - 3.1]) m.box(x0 + dx, 0.8, -HALF_W - 0.04, x0 + dx + 1.3, 3.2, -HALF_W - 0.01, '#5d6b75', { top: false });
    m.box(x0 + 1.5, 0.2, -1.1, x0 + 4.5, 0.75, 1.1, '#2a2a2a');
    m.box(x1 - 4.5, 0.2, -1.1, x1 - 1.5, 0.75, 1.1, '#2a2a2a');
    if (k === 1 || k === 4) {
      // パンタグラフ
      m.box(x0 + 8, 3.7, -0.9, x0 + 12, 3.85, 0.9, '#555');
      m.box(x0 + 9.8, 3.85, -0.1, x0 + 10.2, 4.9, 0.1, '#444');
      m.box(x0 + 9.2, 4.9, -0.9, x0 + 10.8, 5.0, 0.9, '#444');
    }
  }
  // 先頭と最後尾の顔
  for (const [x, s] of [[0, 1], [-TRAIN_LEN, -1]]) {
    m.box(Math.min(x, x + s * 0.05), 1.95, -1.2, Math.max(x, x + s * 0.05), 3.2, 1.2, '#1d2730', { top: false });
    m.box(Math.min(x, x + s * 0.06), 1.0, -1.1, Math.max(x, x + s * 0.06), 1.25, -0.7, '#fff6c8', { top: false });
    m.box(Math.min(x, x + s * 0.06), 1.0, 0.7, Math.max(x, x + s * 0.06), 1.25, 1.1, '#fff6c8', { top: false });
  }
  return m.build();
}

function postGeometry() {
  const m = new MeshBuilder();
  // 白黒の柱
  for (let k = 0; k < 8; k++) m.cylinder(0, k * 0.45, 0, 0.09, 0.45, k % 2 ? '#111111' : '#f4f4f4', 8);
  // 警報灯の台
  m.box(-0.75, 2.55, -0.06, 0.75, 2.65, 0.06, '#222');
  m.box(-0.75, 2.3, -0.12, -0.4, 2.9, 0.12, '#111');
  m.box(0.4, 2.3, -0.12, 0.75, 2.9, 0.12, '#111');
  m.box(-0.35, 0, -0.35, 0.35, 0.9, 0.35, '#9aa0a6');
  return m.build();
}

function armGeometry(len) {
  // 黄色と黒の縞の遮断かん（ピボットから +x に伸びる）
  const m = new MeshBuilder();
  const seg = 0.6;
  for (let x = 0, k = 0; x < len; x += seg, k++) m.box(x, -0.06, -0.06, Math.min(len, x + seg), 0.06, 0.06, k % 2 ? '#111111' : '#ffd400');
  m.box(-0.5, -0.15, -0.15, 0, 0.15, 0.15, '#333');
  return m.build();
}

export class Railway {
  constructor(scene, crossings, { period = 34 } = {}) {
    this.scene = scene;
    this.period = period;
    this.timer = 8;
    this.nextDir = 1;
    this.trains = [];
    const geo = trainGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const dir of [1, -1]) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      mesh.rotation.y = dir > 0 ? 0 : Math.PI;
      scene.add(mesh);
      this.trains.push({ dir, z: dir > 0 ? RAIL.tracks[0] : RAIL.tracks[1], x: 0, active: false, mesh });
    }
    // 踏切の設備
    const postGeo = postGeometry();
    const postMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const crossGeo = new THREE.BoxGeometry(1.35, 0.22, 0.05);
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    this.crossings = crossings.map((c) => {
      const width = c.x1 - c.x0;
      const lampOn = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      const lampOff = new THREE.MeshBasicMaterial({ color: 0x3a0d0a });
      const cr = { ...c, warn: false, gate: 0, blink: 0, arms: [], lamps: [], lampOn, lampOff, violated: false, broken: false };
      const sides = [
        // 北側から来る車用（東の端に柱、腕は西へ）
        { px: c.x1 + (c.alley ? 0.5 : 1.0), pz: RAIL.z0 - 2.2, dir: -1, face: 0 },
        // 南側から来る車用（西の端に柱、腕は東へ）
        { px: c.x0 - (c.alley ? 0.5 : 1.0), pz: RAIL.z1 + 2.2, dir: 1, face: Math.PI },
      ];
      for (const sd of sides) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(sd.px, 0.15, sd.pz);
        post.rotation.y = sd.face;
        scene.add(post);
        // ×印の標識（踏切あり）
        for (const r of [Math.PI / 4, -Math.PI / 4]) {
          const xb = new THREE.Mesh(crossGeo, crossMat);
          xb.position.set(sd.px, 3.5, sd.pz);
          xb.rotation.set(0, sd.face, r);
          scene.add(xb);
        }
        for (const lx of [-0.57, 0.57]) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), lampOff);
          const s = sd.face ? -1 : 1;
          lamp.position.set(sd.px + lx * s, 2.6, sd.pz - 0.14 * s);
          lamp.rotation.y = sd.face ? 0 : Math.PI;
          scene.add(lamp);
          cr.lamps.push(lamp);
          // 裏側にも
          const back = lamp.clone();
          back.position.z = sd.pz + 0.14 * s;
          back.rotation.y = sd.face ? Math.PI : 0;
          scene.add(back);
          cr.lamps.push(back);
        }
        const pivot = new THREE.Group();
        pivot.position.set(sd.px, 1.05, sd.pz);
        const arm = new THREE.Mesh(armGeometry(width + 0.4), postMat);
        if (sd.dir < 0) arm.rotation.y = Math.PI;
        pivot.add(arm);
        scene.add(pivot);
        cr.arms.push({ pivot, dir: sd.dir });
      }
      return cr;
    });
    this._setGates(true);
  }

  reset() {
    for (const t of this.trains) {
      t.active = false;
      t.mesh.visible = false;
    }
    this.timer = 6;
    for (const c of this.crossings) {
      c.warn = false;
      c.gate = 0;
      c.violated = false;
      c.broken = false;
    }
    this._setGates(true);
  }

  setPeriod(p) {
    this.period = p;
  }

  _spawn() {
    const t = this.trains.find((tr) => tr.dir === this.nextDir && !tr.active) || this.trains.find((tr) => !tr.active);
    if (!t) return;
    this.nextDir = -t.dir;
    t.active = true;
    t.x = t.dir > 0 ? X_MIN : X_MAX;
    t.mesh.visible = true;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.period * (0.85 + Math.random() * 0.3);
      this._spawn();
    }
    for (const t of this.trains) {
      if (!t.active) continue;
      t.x += t.dir * SPEED * dt;
      t.mesh.position.set(t.x, 0, t.z);
      if ((t.dir > 0 && t.x - TRAIN_LEN > X_MAX) || (t.dir < 0 && t.x + TRAIN_LEN < X_MIN)) {
        t.active = false;
        t.mesh.visible = false;
      }
    }
    for (const c of this.crossings) {
      let warn = false;
      for (const t of this.trains) {
        if (!t.active) continue;
        const head = t.x, tail = t.x - t.dir * TRAIN_LEN;
        const lo = Math.min(head, tail), hi = Math.max(head, tail);
        if (hi > c.x0 - 6 && lo < c.x1 + 6) warn = true; // 通過中
        const ahead = (c.x - head) * t.dir; // 先頭から踏切まで
        if (ahead > 0 && ahead < WARN_AHEAD) warn = true;
      }
      if (warn && !c.warn) {
        c.violated = false;
        c.broken = false;
      }
      c.warn = warn;
      const target = warn ? 1 : 0;
      c.gate += Math.max(-dt / 1.6, Math.min(dt / 2.4, target - c.gate));
      c.blink += dt;
      const on = warn && Math.floor(c.blink * 2.4) % 2 === 0;
      c.lamps.forEach((l, k) => (l.material = warn && (k % 4 < 2) === on ? c.lampOn : c.lampOff));
    }
    this._setGates();
  }

  _setGates() {
    for (const c of this.crossings) {
      const up = (1 - c.gate) * (Math.PI / 2) * 0.96;
      for (const a of c.arms) {
        a.pivot.visible = !c.broken;
        a.pivot.rotation.z = a.dir > 0 ? up : -up;
      }
    }
  }

  /** 電車の当たり判定（AABB） */
  boxes() {
    const out = [];
    for (const t of this.trains) {
      if (!t.active) continue;
      const tail = t.x - t.dir * TRAIN_LEN;
      out.push({ x0: Math.min(t.x, tail), x1: Math.max(t.x, tail), z0: t.z - HALF_W, z1: t.z + HALF_W, train: t });
    }
    return out;
  }

  /** (x, z) が踏切の中なら、その踏切 */
  crossingAt(x, z) {
    if (z < RAIL.tracks[0] - 2.4 || z > RAIL.tracks[1] + 2.4) return null;
    return this.crossings.find((c) => x > c.x0 - 1 && x < c.x1 + 1) || null;
  }

  /** 鳴っている踏切までの距離（音量用） */
  nearestWarn(x, z) {
    let d = Infinity;
    for (const c of this.crossings) if (c.warn) d = Math.min(d, Math.hypot(c.x - x, (RAIL.z0 + RAIL.z1) / 2 - z));
    return d;
  }

  /** いちばん近い電車までの距離 */
  nearestTrain(x, z) {
    let d = Infinity;
    for (const t of this.trains) {
      if (!t.active) continue;
      const tail = t.x - t.dir * TRAIN_LEN;
      const cx = Math.max(Math.min(t.x, tail), Math.min(Math.max(t.x, tail), x));
      d = Math.min(d, Math.hypot(cx - x, t.z - z));
    }
    return d;
  }

  /** 車が踏切の手前で止まるべきか（進行方向 h、位置 x,z） */
  shouldStop(x, z, h) {
    const fz = Math.cos(h);
    if (Math.abs(fz) < 0.7) return Infinity;
    const c = this.crossings.find((cc) => x > cc.x0 - 0.5 && x < cc.x1 + 0.5);
    if (!c || !c.warn) return Infinity;
    const edge = fz > 0 ? RAIL.z0 - 3.2 : RAIL.z1 + 3.2;
    const dist = (edge - z) * Math.sign(fz);
    return dist > -1 ? dist : Infinity;
  }
}

export { TRAIN_LEN };
