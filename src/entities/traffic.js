// NPC車両: 交差点グラフ上を左側通行で走り回る。バスがぶつかると吹っ飛ぶ。
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshBuilder.js';
import { TILE, tileAt, T, tileAtWorld } from '../world/map.js';

const LANE = 4; // 道路中心から車線中心まで

const TYPES = {
  kei: { len: 3.4, wid: 1.48, hgt: 1.72, cruise: 10.5, colors: ['#f2f2f2', '#f6d7a7', '#9ccfd8', '#e8a0a8', '#c9d66b', '#ffffff'] },
  sedan: { len: 4.6, wid: 1.76, hgt: 1.45, cruise: 12, colors: ['#1d1f22', '#e9e9e9', '#8d949b', '#7a1f24', '#23406e', '#c8c8c8'] },
  taxi: { len: 4.6, wid: 1.72, hgt: 1.5, cruise: 11, colors: ['#f4c20d', '#2d6b3f', '#1d1f22', '#f08c1a'] },
  truck: { len: 3.4, wid: 1.48, hgt: 1.8, cruise: 9.5, colors: ['#f4f4f4', '#e9e9e9'] },
  van: { len: 4.7, wid: 1.72, hgt: 2.0, cruise: 10, colors: ['#ffffff', '#f1f1f1', '#d7e3ef'] },
};

function buildCarGeo(type) {
  const t = TYPES[type];
  const m = new MeshBuilder();
  const L = t.len / 2, W = t.wid / 2;
  const glass = '#1e2a33';
  const wheel = '#141414';
  const body = '#ffffff';
  if (type === 'kei' || type === 'van') {
    m.box(-W, 0.32, -L, W, t.hgt * 0.62, L, body);
    m.box(-W + 0.04, t.hgt * 0.62, -L + 0.1, W - 0.04, t.hgt, L - (type === 'van' ? 0.6 : 0.35), body);
    m.box(-W + 0.03, t.hgt * 0.64, -L + 0.12, W - 0.03, t.hgt * 0.93, L - (type === 'van' ? 0.62 : 0.37), glass, { top: false });
    m.box(-W + 0.1, t.hgt * 0.64, L - (type === 'van' ? 0.6 : 0.35) - 0.02, W - 0.1, t.hgt * 0.92, L - (type === 'van' ? 0.6 : 0.35) + 0.01, glass);
  } else if (type === 'truck') {
    m.box(-W, 0.32, L - 1.3, W, 1.0, L, body);
    m.box(-W + 0.04, 1.0, L - 1.3, W - 0.04, t.hgt, L - 0.15, body);
    m.box(-W + 0.02, 1.05, L - 1.28, W - 0.02, 1.62, L - 0.17, glass, { top: false });
    // 荷台
    m.box(-W, 0.32, -L, W, 0.65, L - 1.35, '#e6e6e6');
    m.box(-W, 0.65, -L, -W + 0.06, 1.05, L - 1.35, '#dcdcdc');
    m.box(W - 0.06, 0.65, -L, W, 1.05, L - 1.35, '#dcdcdc');
    m.box(-W, 0.65, -L, W, 1.05, -L + 0.06, '#dcdcdc');
  } else {
    m.box(-W, 0.3, -L, W, 0.95, L, body);
    m.box(-W + 0.1, 0.95, -L + 0.9, W - 0.1, t.hgt, L - 1.25, body);
    m.box(-W + 0.08, 0.98, -L + 0.92, W - 0.08, t.hgt - 0.08, L - 1.27, glass, { top: false });
    if (type === 'taxi') {
      m.box(-0.28, t.hgt, -0.25, 0.28, t.hgt + 0.25, 0.1, '#ff9a1f');
    }
  }
  // ライト
  m.box(-W + 0.15, 0.6, L - 0.01, -W + 0.45, 0.78, L + 0.02, '#fff6c8');
  m.box(W - 0.45, 0.6, L - 0.01, W - 0.15, 0.78, L + 0.02, '#fff6c8');
  m.box(-W + 0.1, 0.6, -L - 0.02, -W + 0.35, 0.8, -L + 0.01, '#c0181c');
  m.box(W - 0.35, 0.6, -L - 0.02, W - 0.1, 0.8, -L + 0.01, '#c0181c');
  // タイヤ
  for (const z of [L - 0.75, -L + 0.75]) {
    for (const sx of [-1, 1]) m.box(sx * W - 0.12, 0, z - 0.33, sx * W + 0.12, 0.62, z + 0.33, wheel);
  }
  // ナンバー
  m.box(-0.22, 0.38, L, 0.22, 0.52, L + 0.03, '#f0f0e8');
  return m.build();
}

export class Traffic {
  constructor(scene, intersections, { count = 14, onHit, onHonk }) {
    this.onHit = onHit;
    this.onHonk = onHonk;
    this.nodes = intersections.map((it, i) => ({ id: i, x: it.x, z: it.z, c: it.c, r: it.r, nb: [] }));
    this._buildEdges();
    this.cars = [];
    this.meshes = {};
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    const typeKeys = Object.keys(TYPES);
    const weights = { kei: 4, sedan: 4, taxi: 2, truck: 2, van: 2 };
    const pool = [];
    for (const k of typeKeys) for (let i = 0; i < weights[k]; i++) pool.push(k);
    const counts = {};
    const assigned = [];
    for (let i = 0; i < count; i++) {
      const tp = pool[(i * 7 + 3) % pool.length];
      assigned.push(tp);
      counts[tp] = (counts[tp] || 0) + 1;
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const k of typeKeys) {
      if (!counts[k]) continue;
      const mesh = new THREE.InstancedMesh(buildCarGeo(k), mat, counts[k]);
      mesh.name = 'cars-' + k;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.meshes[k] = mesh;
      scene.add(mesh);
      counts[k] = 0;
    }
    assigned.forEach((tp, i) => {
      const spec = TYPES[tp];
      const car = {
        id: 'car' + i,
        type: tp,
        spec,
        mesh: this.meshes[tp],
        index: counts[tp]++,
        x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, y: 0,
        speed: 0,
        state: 'drive',
        solid: true,
        circles: [{ x: 0, z: 0, r: spec.wid / 2 + 0.05 }, { x: 0, z: 0, r: spec.wid / 2 + 0.05 }],
        pieces: [],
        piece: 0,
        dist: 0,
        from: null,
        to: null,
        wait: 0,
        honkCd: 0,
        q: new THREE.Quaternion(),
        vy: 0, vx: 0, vz: 0, w: new THREE.Vector3(), rest: 0, sink: 0,
        cruise: spec.cruise * (0.85 + Math.random() * 0.3),
      };
      const col = spec.colors[i % spec.colors.length];
      car.mesh.setColorAt(car.index, this._col.set(col));
      this.cars.push(car);
    });
    for (const m of Object.values(this.meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  _buildEdges() {
    const nodes = this.nodes;
    const roadLike = (t) => t === T.ROAD || t === T.BRIDGE;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        if (a.r === b.r && b.c > a.c) {
          // 同じ東西道路で隣り合う
          const between = nodes.some((n) => n.r === a.r && n.c > a.c && n.c < b.c);
          if (between) continue;
          let ok = true;
          for (let c = a.c; c <= b.c; c++) if (!roadLike(tileAt(c, a.r))) ok = false;
          if (ok) { a.nb.push(b); b.nb.push(a); }
        }
        if (a.c === b.c && b.r > a.r) {
          const between = nodes.some((n) => n.c === a.c && n.r > a.r && n.r < b.r);
          if (between) continue;
          let ok = true;
          for (let r = a.r; r <= b.r; r++) if (!roadLike(tileAt(a.c, r))) ok = false;
          if (ok) { a.nb.push(b); b.nb.push(a); }
        }
      }
    }
  }

  static dirOf(a, b) {
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    return { x: dx, z: dz };
  }
  static leftOf(d) {
    return { x: d.z, z: -d.x };
  }

  _lineFor(a, b) {
    const d = Traffic.dirOf(a, b), l = Traffic.leftOf(d);
    const p0 = { x: a.x + d.x * 9 + l.x * LANE, z: a.z + d.z * 9 + l.z * LANE };
    const p1 = { x: b.x - d.x * 9 + l.x * LANE, z: b.z - d.z * 9 + l.z * LANE };
    return { type: 'line', p0, p1, len: Math.hypot(p1.x - p0.x, p1.z - p0.z), d };
  }

  _turnFor(prevLine, b, next) {
    const d1 = prevLine.d, d2 = Traffic.dirOf(b, next);
    const l1 = Traffic.leftOf(d1), l2 = Traffic.leftOf(d2);
    const p0 = prevLine.p1;
    const p1 = { x: b.x + d2.x * 9 + l2.x * LANE, z: b.z + d2.z * 9 + l2.z * LANE };
    if (d1.x === d2.x && d1.z === d2.z) return { type: 'line', p0, p1, len: Math.hypot(p1.x - p0.x, p1.z - p0.z), d: d1 };
    const c = { x: b.x + LANE * (l1.x + l2.x) + (d1.x === -d2.x && d1.z === -d2.z ? 0 : 0), z: b.z + LANE * (l1.z + l2.z) };
    let len = 0, lx = p0.x, lz = p0.z;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x;
      const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * c.z + t * t * p1.z;
      len += Math.hypot(x - lx, z - lz);
      lx = x; lz = z;
    }
    return { type: 'bez', p0, c, p1, len, turn: true };
  }

  /** 通行止めの区間（ノードの組）。車はそこへ入らない */
  setClosed(pairs) {
    this.closed = new Set(pairs.map(([a, b]) => this._edgeKey(a, b)));
  }
  _edgeKey(a, b) {
    return a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
  }
  _open(a, b) {
    return !this.closed || !this.closed.has(this._edgeKey(a, b));
  }

  _plan(car) {
    // 現在の行き先ノード car.to から次を選ぶ
    const b = car.to;
    let opts = b.nb.filter((n) => n !== car.from && this._open(b, n));
    if (!opts.length) opts = b.nb.filter((n) => this._open(b, n));
    if (!opts.length) opts = b.nb;
    const next = opts[Math.floor(Math.random() * opts.length)];
    const prevLine = this._lineFor(car.from, b);
    const turn = this._turnFor(prevLine, b, next);
    const line = this._lineFor(b, next);
    car.pieces = [turn, line];
    car.piece = 0;
    car.dist = 0;
    car.from = b;
    car.to = next;
  }

  spawn(car, avoid) {
    for (let tries = 0; tries < 40; tries++) {
      const a = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      if (!a.nb.length) continue;
      const b = a.nb[Math.floor(Math.random() * a.nb.length)];
      if (!this._open(a, b)) continue;
      const line = this._lineFor(a, b);
      const d = Math.random() * line.len;
      const x = line.p0.x + line.d.x * d, z = line.p0.z + line.d.z * d;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < (avoid.r || 70)) continue;
      if (this.cars.some((o) => o !== car && o.state === 'drive' && Math.hypot(o.x - x, o.z - z) < 12)) continue;
      car.from = a;
      car.to = b;
      car.pieces = [line];
      car.piece = 0;
      car.dist = d;
      car.state = 'drive';
      car.solid = true;
      car.speed = car.cruise * 0.6;
      car.y = 0;
      car.sink = 0;
      car.wait = 0;
      this._place(car);
      car.px = car.x; car.pz = car.z; car.ph = car.h;
      return true;
    }
    return false;
  }

  spawnAll(avoid) {
    for (const car of this.cars) this.spawn(car, avoid);
    this.sync(1);
  }

  _pointAt(piece, s) {
    if (piece.type === 'line') {
      const t = piece.len > 0 ? s / piece.len : 0;
      return {
        x: piece.p0.x + (piece.p1.x - piece.p0.x) * t,
        z: piece.p0.z + (piece.p1.z - piece.p0.z) * t,
        hx: piece.p1.x - piece.p0.x,
        hz: piece.p1.z - piece.p0.z,
      };
    }
    const t = Math.min(1, s / piece.len);
    const { p0, c, p1 } = piece;
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x;
    const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * c.z + t * t * p1.z;
    const hx = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x);
    const hz = 2 * (1 - t) * (c.z - p0.z) + 2 * t * (p1.z - c.z);
    return { x, z, hx, hz };
  }

  _place(car) {
    const p = this._pointAt(car.pieces[car.piece], car.dist);
    car.x = p.x;
    car.z = p.z;
    if (Math.abs(p.hx) + Math.abs(p.hz) > 1e-6) car.h = Math.atan2(p.hx, p.hz);
    car.q.setFromAxisAngle(_up, car.h);
    this._circles(car);
  }

  _circles(car) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    const off = car.spec.len / 2 - car.circles[0].r;
    car.circles[0].x = car.x + fx * off;
    car.circles[0].z = car.z + fz * off;
    car.circles[1].x = car.x - fx * off;
    car.circles[1].z = car.z - fz * off;
  }

  /** 前方の障害物までの距離 */
  _gapAhead(car, bus) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    let gap = Infinity, byBus = false;
    const test = (x, z, halfLen, halfWid) => {
      const dx = x - car.x, dz = z - car.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > 26) return;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > halfWid + car.spec.wid / 2 + 0.6) return;
      const g = along - halfLen - car.spec.len / 2;
      if (g < gap) { gap = g; return true; }
    };
    for (const o of this.cars) {
      if (o === car || o.sink > 0.5) continue;
      test(o.x, o.z, o.spec.len / 2, o.spec.wid / 2);
    }
    for (const b of [bus, ...(this.extraBuses || [])]) {
      if (!b || b.hidden) continue;
      // バスは長いので3点で判定
      const bfx = Math.sin(b.h), bfz = Math.cos(b.h);
      for (const k of [-4, 0, 4]) if (test(b.x + bfx * k, b.z + bfz * k, 1.5, 1.3)) byBus = b === bus || byBus;
    }
    return { gap, byBus };
  }

  /** バス（ライバルも）が交差点 node の中にいる、または 2 秒以内に入ってくるか。車の真後ろを走っているバスは除く */
  _busComing(car, node, bus) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    for (const b of [bus, ...(this.extraBuses || [])]) {
      if (!b || b.hidden) continue;
      const rx = b.x - car.x, rz = b.z - car.z;
      if (rx * fx + rz * fz < 0 && Math.abs(rx * fz - rz * fx) < 4) continue; // 同じ車線の後ろ
      const vx = b.vx || 0, vz = b.vz || 0;
      for (let t = 0; t <= 2; t += 0.5) {
        if (Math.abs(b.x + vx * t - node.x) < 10.5 && Math.abs(b.z + vz * t - node.z) < 10.5) return true;
      }
    }
    return false;
  }

  update(dt, bus, props) {
    for (const car of this.cars) {
      car.px = car.x; car.pz = car.z; car.ph = car.h;
      car.honkCd = Math.max(0, car.honkCd - dt);
      if (car.state === 'drive') {
        const piece = car.pieces[car.piece];
        let target = car.cruise;
        if (piece.turn) target = 6;
        else {
          const remain = piece.len - car.dist;
          if (remain < 14) target = Math.min(target, 6 + remain * 0.5);
        }
        const { gap, byBus } = this._gapAhead(car, bus);
        if (gap < 14) target = Math.min(target, Math.max(0, (gap - 3) * 1.1));
        // 交差点の手前：バスが交差点の中にいるか、すぐ入ってくるなら停止線で待つ（バス優先）
        let yielding = false;
        if (!piece.turn) {
          const remain = piece.len - car.dist;
          if (remain < 16 && remain > 0.3 && this._busComing(car, car.to, bus)) {
            target = Math.min(target, Math.max(0, (remain - 1.2) * 1.1));
            yielding = true;
          }
        }
        // 踏切が鳴っていたら手前で止まる
        let atCrossing = false;
        if (this.railway) {
          const d = this.railway.shouldStop(car.x, car.z, car.h) - car.spec.len / 2;
          if (d < 18) {
            target = Math.min(target, Math.max(0, (d - 0.5) * 1.2));
            atCrossing = true;
          }
        }
        if (gap < 3.2) target = 0;
        if (target < 0.5 && (byBus || yielding)) {
          car.wait += dt;
          if (car.wait > 2.5 && car.honkCd <= 0) {
            car.honkCd = 7;
            this.onHonk && this.onHonk(car);
          }
        } else if (target > 1) car.wait = 0;
        // 長時間詰まったら少しずつ前進（すり抜け防止のためバス相手は除く）
        if (target < 0.5 && !byBus && !atCrossing && !yielding) {
          car.wait += dt;
          if (car.wait > 6) target = 2;
        }
        const acc = target > car.speed ? 3.5 : 9;
        car.speed += THREE.MathUtils.clamp(target - car.speed, -acc * dt, acc * dt);
        car.dist += car.speed * dt;
        while (car.dist >= car.pieces[car.piece].len) {
          car.dist -= car.pieces[car.piece].len;
          car.piece++;
          if (car.piece >= car.pieces.length) this._plan(car);
        }
        this._place(car);
        car.vx = Math.sin(car.h) * car.speed;
        car.vz = Math.cos(car.h) * car.speed;
      } else if (car.state === 'fly') {
        car.vy -= 20 * dt;
        car.x += car.vx * dt;
        car.z += car.vz * dt;
        car.y += car.vy * dt;
        const wl = car.w.length();
        if (wl > 1e-4) {
          _axis.copy(car.w).divideScalar(wl);
          _q.setFromAxisAngle(_axis, wl * dt);
          car.q.premultiply(_q);
        }
        // 建物の壁で止める
        const tt = tileAtWorld(car.x, car.z);
        if (tt === T.SOLID && car.y < 10) {
          car.x = car.px; car.z = car.pz;
          car.vx *= -0.3; car.vz *= -0.3;
        }
        const ground = tt === T.WATER ? -2.2 : 0;
        if (car.y < ground) {
          car.y = ground;
          if (car.vy < -3) {
            car.vy *= -0.3;
            car.vx *= 0.6; car.vz *= 0.6;
            car.w.multiplyScalar(0.5);
          } else {
            car.vy = 0;
            car.vx *= Math.pow(0.05, dt);
            car.vz *= Math.pow(0.05, dt);
            car.w.multiplyScalar(Math.pow(0.02, dt));
            car.rest += dt;
          }
        }
        if (car.rest > 3.5) {
          car.state = 'sink';
        }
      } else if (car.state === 'sink') {
        car.sink += dt;
        car.y -= dt * 0.8;
        if (car.sink > 2.5) {
          this.spawn(car, { x: bus.x, z: bus.z, r: 90 });
        }
      }
      if (props && car.state === 'drive' && car.speed > 1) props.collideOther(car.x, car.z, car.spec.wid / 2, car.vx, car.vz);
    }
  }

  /** バスと接触したとき（Bus から呼ばれる） */
  handleBusHit(car, bus, hit, t) {
    if (car.state !== 'drive') return false;
    // バスが動いていない（相手から当たってきた）場合は罰金なし
    const towardCar = -(bus.vx * hit.nx + bus.vz * hit.nz);
    if (bus.speed < 1.5 && towardCar < 0.8) {
      car.speed = 0;
      return false;
    }
    const sp = Math.max(4, bus.speed);
    car.state = 'fly';
    car.solid = false;
    car.vx = -hit.nx * (3 + sp * 0.7) + bus.vx * 0.6;
    car.vz = -hit.nz * (3 + sp * 0.7) + bus.vz * 0.6;
    car.vy = 4 + sp * 0.45;
    car.w.set(Math.random() - 0.5, (Math.random() - 0.5) * 2, Math.random() - 0.5).normalize().multiplyScalar(2 + sp * 0.4);
    car.rest = 0;
    car.y = 0.01;
    this.onHit && this.onHit(car, t);
    return true;
  }

  sync(alpha) {
    const d = this._dummy;
    for (const car of this.cars) {
      const x = car.px + (car.x - car.px) * alpha;
      const z = car.pz + (car.z - car.pz) * alpha;
      d.position.set(x, car.y, z);
      if (car.state === 'drive') {
        let dh = car.h - car.ph;
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        d.quaternion.setFromAxisAngle(_up, car.ph + dh * alpha);
      } else d.quaternion.copy(car.q);
      d.scale.setScalar(1);
      d.updateMatrix();
      car.mesh.setMatrixAt(car.index, d.matrix);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }

  setShadows(on) {
    for (const m of Object.values(this.meshes)) m.castShadow = on;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
