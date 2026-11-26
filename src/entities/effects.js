// 演出用のパーティクル（破片・火花・土煙・排気・水しぶき・紙吹雪）とタイヤ痕
import * as THREE from 'three';
import { tileAtWorld, T } from '../world/map.js';

const _d = new THREE.Object3D();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

class Pool {
  constructor(scene, geo, mat, cap, name) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.cap = cap;
    this.items = [];
    for (let i = 0; i < cap; i++) {
      this.items.push({ i, alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, sx: 1, sy: 1, sz: 1, g: 0, drag: 0, grow: 0, q: new THREE.Quaternion(), w: new THREE.Vector3(), bounce: 0, flutter: 0 });
      this.mesh.setColorAt(i, _c.set(0xffffff));
      _d.position.set(0, -100, 0);
      _d.scale.setScalar(0.0001);
      _d.updateMatrix();
      this.mesh.setMatrixAt(i, _d.matrix);
    }
    this.next = 0;
    this.live = 0;
    scene.add(this.mesh);
  }
  spawn() {
    // 空きがなければ一番古いものを使い回す
    for (let k = 0; k < this.cap; k++) {
      const it = this.items[(this.next + k) % this.cap];
      if (!it.alive) {
        this.next = (it.i + 1) % this.cap;
        return it;
      }
    }
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.cap;
    return it;
  }
  update(dt) {
    let live = 0;
    for (const p of this.items) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        _d.position.set(0, -100, 0);
        _d.scale.setScalar(0.0001);
        _d.updateMatrix();
        this.mesh.setMatrixAt(p.i, _d.matrix);
        continue;
      }
      live++;
      p.vy -= p.g * dt;
      const dk = Math.exp(-p.drag * dt);
      p.vx *= dk;
      p.vz *= dk;
      if (p.flutter) {
        p.vx += Math.sin(p.life * 7 + p.i) * p.flutter * dt;
        p.vz += Math.cos(p.life * 5 + p.i) * p.flutter * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const floor = p.bounce >= 0 ? groundAt(p.x, p.z) : -100;
      if (p.y < floor) {
        p.y = floor;
        if (p.bounce > 0 && p.vy < -1) {
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.6;
          p.vz *= 0.6;
          p.w.multiplyScalar(0.5);
        } else {
          p.vy = 0;
          p.vx *= 0.8;
          p.vz *= 0.8;
          p.w.multiplyScalar(0.8);
        }
      }
      const wl = p.w.length();
      if (wl > 1e-3) {
        _axis.copy(p.w).divideScalar(wl);
        _q.setFromAxisAngle(_axis, wl * dt);
        p.q.premultiply(_q);
      }
      const t = 1 - p.life / p.max;
      let s = p.size * (1 + p.grow * t);
      if (p.grow) s *= Math.min(1, (p.life / p.max) * 3); // 消える前に縮む
      _d.position.set(p.x, p.y, p.z);
      _d.quaternion.copy(p.q);
      _d.scale.set(s * p.sx, s * p.sy, s * p.sz);
      _d.updateMatrix();
      this.mesh.setMatrixAt(p.i, _d.matrix);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    for (const p of this.items) p.life = 0;
    this.update(0);
  }
}

function groundAt(x, z) {
  const t = tileAtWorld(x, z);
  if (t === T.WATER) return -1.8;
  if (t === T.SOLID || t === T.BANK) return 0.17;
  return 0.02;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Effects {
  constructor(scene, { lowQuality = false } = {}) {
    this.scale = lowQuality ? 0.55 : 1;
    this.chips = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), lowQuality ? 200 : 360, 'fx-chips');
    this.sparks = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: false }), 140, 'fx-sparks');
    this.puffs = new Pool(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.62, depthWrite: false }), lowQuality ? 90 : 160, 'fx-puffs');
    this.puffs.mesh.renderOrder = 4;
    this.skid = new SkidMarks(scene, lowQuality ? 260 : 500);
  }

  _n(n) {
    return Math.max(1, Math.round(n * this.scale));
  }

  /** 破片（色の配列から） */
  chips_(x, y, z, n, colors, { vx = 0, vz = 0, speed = 5, up = 5, size = [0.08, 0.22], life = [1.2, 2.2] } = {}) {
    for (let k = 0; k < this._n(n); k++) {
      const p = this.chips.spawn();
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.3, 1) * speed;
      Object.assign(p, {
        alive: true, x: x + rnd(-0.3, 0.3), y: y + rnd(0, 0.5), z: z + rnd(-0.3, 0.3),
        vx: vx * rnd(0.4, 0.9) + Math.cos(a) * sp, vy: rnd(0.4, 1) * up, vz: vz * rnd(0.4, 0.9) + Math.sin(a) * sp,
        life: rnd(...life), size: rnd(...size), g: 18, drag: 0.6, grow: 0, bounce: 0.35, flutter: 0,
        sx: rnd(0.6, 1.4), sy: rnd(0.3, 1), sz: rnd(0.6, 1.4),
      });
      p.max = p.life;
      p.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
      p.w.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(rnd(6, 16));
      this.chips.mesh.setColorAt(p.i, _c.set(pick(colors)));
    }
    this.chips.mesh.instanceColor.needsUpdate = true;
  }

  sparks_(x, y, z, n, { vx = 0, vz = 0, speed = 7 } = {}) {
    for (let k = 0; k < this._n(n); k++) {
      const p = this.sparks.spawn();
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.4, 1) * speed;
      Object.assign(p, {
        alive: true, x, y: y + rnd(0, 0.6), z,
        vx: vx * 0.5 + Math.cos(a) * sp, vy: rnd(1, 5), vz: vz * 0.5 + Math.sin(a) * sp,
        life: rnd(0.25, 0.6), size: rnd(0.04, 0.09), g: 14, drag: 1.5, grow: 0, bounce: 0.3, flutter: 0,
        sx: 1, sy: 1, sz: 3.5,
      });
      p.max = p.life;
      p.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(p.vx, p.vy, p.vz).normalize());
      p.w.set(0, 0, 0);
      this.sparks.mesh.setColorAt(p.i, _c.set(pick(['#fff3a0', '#ffd24a', '#ff9a2e', '#ffffff'])));
    }
    this.sparks.mesh.instanceColor.needsUpdate = true;
  }

  puffs_(x, y, z, n, colors, { spread = 0.6, rise = 1.2, size = [0.35, 0.7], grow = 2, life = [0.6, 1.1], vx = 0, vz = 0, drag = 2 } = {}) {
    for (let k = 0; k < this._n(n); k++) {
      const p = this.puffs.spawn();
      Object.assign(p, {
        alive: true, x: x + rnd(-spread, spread), y: y + rnd(0, 0.3), z: z + rnd(-spread, spread),
        vx: vx + rnd(-0.8, 0.8), vy: rnd(0.5, 1) * rise, vz: vz + rnd(-0.8, 0.8),
        life: rnd(...life), size: rnd(...size), g: -0.3, drag, grow, bounce: -1, flutter: 0,
        sx: 1, sy: 0.8, sz: 1,
      });
      p.max = p.life;
      p.q.identity();
      p.w.set(0, rnd(-1, 1), 0);
      this.puffs.mesh.setColorAt(p.i, _c.set(pick(colors)));
    }
    this.puffs.mesh.instanceColor.needsUpdate = true;
  }

  // ---- 用途別 ----
  hitProp(kind, x, y, z, vx, vz) {
    const v = { vx, vz };
    if (kind === 'cone') this.chips_(x, y, z, 6, ['#ff6a00', '#ffffff', '#222222'], { ...v, size: [0.06, 0.16] });
    else if (kind === 'pot') {
      this.chips_(x, y, z, 10, ['#b5582f', '#8a4022', '#4f9a3f', '#e85d8a', '#5b3b24'], { ...v, size: [0.07, 0.18] });
      this.puffs_(x, y + 0.2, z, 4, ['#8b6b4a', '#a08060'], { size: [0.25, 0.45], life: [0.5, 0.9] });
    } else if (kind === 'guardrail') {
      this.sparks_(x, y + 0.6, z, 22, { ...v, speed: 9 });
      this.chips_(x, y + 0.6, z, 6, ['#e8e8e4', '#c9c9c4'], { ...v, size: [0.08, 0.2] });
    } else if (kind === 'sign' || kind === 'barricade') {
      this.sparks_(x, y + 1, z, 10, v);
      this.chips_(x, y + 1, z, 6, ['#d0021b', '#1e5bb8', '#ffffff', '#ffd400'], v);
    } else {
      this.chips_(x, y + 0.6, z, 8, ['#c0392b', '#ffffff', '#6d4c41', '#1565c0', '#ffcc33'], v);
    }
  }

  carCrash(x, z, vx, vz) {
    this.sparks_(x, 0.6, z, 34, { vx, vz, speed: 11 });
    this.chips_(x, 0.8, z, 16, ['#c9e3f5', '#ffffff', '#9aa3ad', '#222222', '#ffcc33'], { vx, vz, speed: 7, up: 7 });
    this.puffs_(x, 0.5, z, 10, ['#d9d4cc', '#bdb6aa', '#e8e3da'], { spread: 1.2, rise: 2, size: [0.6, 1.1], grow: 2.2, life: [0.8, 1.4] });
  }

  wreckSmoke(x, z) {
    this.puffs_(x, 1, z, 1, ['#55555a', '#6a6a70', '#44444a'], { spread: 0.4, rise: 2.2, size: [0.4, 0.7], grow: 3, life: [1.4, 2.2], drag: 0.5 });
  }

  dust(x, z, n = 2, colors = ['#b9ad97', '#cfc4ad', '#a89c86']) {
    this.puffs_(x, 0.1, z, n, colors, { spread: 0.5, rise: 0.8, size: [0.16, 0.3], grow: 2.2, life: [0.45, 0.8] });
  }

  exhaust(x, y, z, vx, vz) {
    this.puffs_(x, y, z, 1, ['#8d8d92', '#a2a2a7', '#77777c'], { spread: 0.1, rise: 0.6, size: [0.15, 0.25], grow: 3.5, life: [0.5, 0.9], vx, vz, drag: 3 });
  }

  splash(x, z) {
    this.puffs_(x, -1.6, z, 10, ['#ffffff', '#d6efff', '#b8e2ff'], { spread: 1, rise: 4, size: [0.4, 0.8], grow: 1.5, life: [0.6, 1.1] });
    this.chips_(x, -1.6, z, 14, ['#ffffff', '#cdeaff', '#8fd0ff'], { speed: 4, up: 9, size: [0.06, 0.14], life: [0.6, 1.1] });
  }

  confetti(x, y, z, n = 60) {
    for (let k = 0; k < this._n(n); k++) {
      const p = this.chips.spawn();
      Object.assign(p, {
        alive: true, x: x + rnd(-6, 6), y: y + rnd(0, 4), z: z + rnd(-6, 6),
        vx: rnd(-1, 1), vy: rnd(-1, 2), vz: rnd(-1, 1),
        life: rnd(3, 5), size: rnd(0.12, 0.2), g: 2.2, drag: 1.5, grow: 0, bounce: 0, flutter: 6,
        sx: 1, sy: 0.08, sz: 0.6,
      });
      p.max = p.life;
      p.w.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(rnd(3, 8));
      this.chips.mesh.setColorAt(p.i, _c.set(pick(['#ff5a4f', '#ffd23f', '#2ecc71', '#3fa7ff', '#ff8ad8', '#ffffff'])));
    }
    this.chips.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this.chips.update(dt);
    this.sparks.update(dt);
    this.puffs.update(dt);
  }

  clear() {
    this.chips.clear();
    this.sparks.clear();
    this.puffs.clear();
    this.skid.clear();
  }
}

/** タイヤ痕：後輪の位置を毎フレーム受け取り、滑っている間だけ帯を伸ばす（リングバッファ） */
class SkidMarks {
  constructor(scene, cap) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 4 * 3);
    const idx = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: 0x15161a, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'skidmarks';
    scene.add(this.mesh);
    this.next = 0;
    this.last = [null, null];
  }
  /** wheels: [{x,z,y}...], dir: 進行方向, on: 痕を付けるか */
  add(wheels, h, on) {
    const rx = -Math.cos(h), rz = Math.sin(h);
    const w = 0.18;
    wheels.forEach((p, k) => {
      if (!on) {
        this.last[k] = null;
        return;
      }
      const prev = this.last[k];
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) > 0.35) {
        const i = this.next;
        this.next = (this.next + 1) % this.cap;
        const y0 = prev.y + 0.03, y1 = p.y + 0.03;
        this.pos.set([prev.x - rx * w, y0, prev.z - rz * w, prev.x + rx * w, y0, prev.z + rz * w, p.x + rx * w, y1, p.z + rz * w, p.x - rx * w, y1, p.z - rz * w], i * 12);
        this.attr.needsUpdate = true;
        this.last[k] = p;
      } else if (!prev) this.last[k] = p;
    });
  }
  clear() {
    this.pos.fill(0);
    this.attr.needsUpdate = true;
    this.last = [null, null];
  }
}
