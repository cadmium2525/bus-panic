// 壊せる小物（コーン・植木鉢・標識・看板・のぼり・バリケード・ガードレール）
// InstancedMesh で描画し、衝突したら派手に吹き飛ぶ。罰金は物体単位で一度だけ。
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshBuilder.js';
import { propAtlas } from '../world/textures.js';
import { SpatialHash, circleVsCircle, circleVsAABB } from '../core/collision.js';
import { tileAtWorld, T, solidRectForTile, TILE } from '../world/map.js';

const WHITE_UV = [0.05, 0.05];

// 種類ごとの性質: cls = 罰金区分, r = 当たり半径, slow = バスの減速率, lift = 打ち上げ係数
const KINDS = {
  cone: { cls: 'cone', r: 0.35, slow: 0.02, lift: 1.25, mass: 0.2, label: 'コーン' },
  pot: { cls: 'cone', r: 0.45, slow: 0.04, lift: 0.9, mass: 0.4, label: '植木鉢' },
  sign: { cls: 'sign', r: 0.3, slow: 0.08, lift: 0.8, mass: 0.6, label: '道路標識' },
  board: { cls: 'sign', r: 0.55, slow: 0.05, lift: 1.1, mass: 0.4, label: '立て看板' },
  nobori: { cls: 'sign', r: 0.3, slow: 0.03, lift: 1.0, mass: 0.3, label: 'のぼり旗' },
  barricade: { cls: 'sign', r: 0.75, slow: 0.07, lift: 0.9, mass: 0.6, label: '工事看板' },
  guardrail: { cls: 'guardrail', r: 0, slow: 0.22, lift: 0.55, mass: 1.5, label: 'ガードレール' },
};

function geoCone(at) {
  const m = new MeshBuilder(WHITE_UV);
  m.box(-0.33, 0, -0.33, 0.33, 0.06, 0.33, '#222');
  m.cone(0, 0.06, 0, 0.26, 0.72, '#ff6a00', 8);
  m.cylinder(0, 0.32, 0, 0.17, 0.12, '#f5f5f5', 8);
  return m.build();
}
function geoPot() {
  const m = new MeshBuilder(WHITE_UV);
  m.cylinder(0, 0, 0, 0.36, 0.5, '#b5582f', 8, '#5b3b24');
  m.blob(0, 0.85, 0, 0.42, '#4f9a3f', 0.45);
  m.blob(0.15, 1.15, 0.05, 0.2, '#e85d8a', 0.18);
  m.blob(-0.18, 1.08, -0.1, 0.16, '#ffd23f', 0.15);
  return m.build();
}
function geoSign(at, variant) {
  const m = new MeshBuilder(WHITE_UV);
  const cell = [at.cells.signStop, at.cells.signBlue, at.cells.signWarn][variant] || at.cells.signBlue;
  m.cylinder(0, 0, 0, 0.05, 2.6, '#b9bec2', 6);
  const y0 = 2.0, y1 = 2.9, hw = 0.45;
  const U = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
  // 表（南向き +z）と裏
  m.quad([-hw, y0, 0.07], [hw, y0, 0.07], [hw, y1, 0.07], [-hw, y1, 0.07], '#ffffff', U);
  m.quad([hw, y0, 0.05], [-hw, y0, 0.05], [-hw, y1, 0.05], [hw, y1, 0.05], '#d8dadb');
  // 北向きにも同じ標識
  m.quad([hw, y0, -0.07], [-hw, y0, -0.07], [-hw, y1, -0.07], [hw, y1, -0.07], '#ffffff', U);
  return m.build();
}
function geoBoard(at, variant) {
  const m = new MeshBuilder(WHITE_UV);
  const cell = at.cells['board' + (variant % 4)];
  const U = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
  const h = 1.15, hw = 0.32, foot = 0.35;
  // A型の2枚の板（前後）
  m.quad([-hw, 0, foot], [hw, 0, foot], [hw, h, 0.03], [-hw, h, 0.03], '#ffffff', U);
  m.quad([hw, 0, -foot], [-hw, 0, -foot], [-hw, h, -0.03], [hw, h, -0.03], '#ffffff', U);
  m.quad([hw, 0, foot - 0.02], [-hw, 0, foot - 0.02], [-hw, h, 0.01], [hw, h, 0.01], '#444');
  m.quad([-hw, 0, -foot + 0.02], [hw, 0, -foot + 0.02], [hw, h, -0.01], [-hw, h, -0.01], '#444');
  m.box(-hw - 0.03, h - 0.03, -0.05, hw + 0.03, h + 0.04, 0.05, '#333');
  return m.build();
}
function geoNobori(at, variant) {
  const m = new MeshBuilder(WHITE_UV);
  const cell = at.cells['nobori' + (variant % 2)];
  m.cylinder(0, 0, 0, 0.035, 3.6, '#ddd', 5);
  m.box(-0.1, 0, -0.1, 0.1, 0.25, 0.1, '#333');
  m.box(0, 3.45, -0.02, 0.62, 3.5, 0.02, '#ccc');
  const U = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
  const x0 = 0.04, x1 = 0.62, y0 = 0.9, y1 = 3.45;
  m.quad([x0, y0, 0.01], [x1, y0, 0.01], [x1, y1, 0.01], [x0, y1, 0.01], '#fff', U);
  m.quad([x1, y0, -0.01], [x0, y0, -0.01], [x0, y1, -0.01], [x1, y1, -0.01], '#fff', [U[1], U[0], U[3], U[2]]);
  return m.build();
}
function geoBarricade(at) {
  const m = new MeshBuilder(WHITE_UV);
  const cell = at.cells.barricade;
  const U = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
  for (const sx of [-0.8, 0.8]) {
    m.box(sx - 0.04, 0, -0.04, sx + 0.04, 1.0, 0.04, '#ddd');
    m.box(sx - 0.08, 0, -0.3, sx + 0.08, 0.06, 0.3, '#333');
  }
  m.quad([-0.9, 0.55, 0.05], [0.9, 0.55, 0.05], [0.9, 1.05, 0.05], [-0.9, 1.05, 0.05], '#fff', U);
  m.quad([0.9, 0.55, -0.05], [-0.9, 0.55, -0.05], [-0.9, 1.05, -0.05], [0.9, 1.05, -0.05], '#fff', U);
  // 回転灯
  m.cylinder(0.8, 1.0, 0, 0.08, 0.14, '#ff3b1f', 6);
  return m.build();
}
function geoGuardrail() {
  const m = new MeshBuilder(WHITE_UV);
  // 白いビーム（x方向に4m）と支柱
  m.box(-2.0, 0.55, -0.06, 2.0, 0.9, 0.06, '#f2f2ee');
  m.box(-2.0, 0.66, -0.1, 2.0, 0.79, 0.1, '#e1e1dc');
  for (const x of [-1.6, 0.4]) m.box(x - 0.06, 0, -0.06, x + 0.06, 0.85, 0.06, '#c9c9c4');
  return m.build();
}

export class Props {
  constructor(scene, spawns, { onHit, shadows = false }) {
    this.onHit = onHit;
    this.atlas = propAtlas();
    this.material = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    this.items = [];
    this.flying = [];
    this.hash = new SpatialHash(12);
    this.meshes = [];
    this._dummy = new THREE.Object3D();
    this._q = new THREE.Quaternion();
    this._near = [];

    const at = this.atlas.userData;
    const builders = {
      cone: () => geoCone(at),
      pot: () => geoPot(at),
      sign: (v) => geoSign(at, v),
      board: (v) => geoBoard(at, v),
      nobori: (v) => geoNobori(at, v),
      barricade: () => geoBarricade(at),
      guardrail: () => geoGuardrail(at),
    };
    // 種類×バリエーションごとに InstancedMesh
    const groups = new Map();
    for (const [type, list] of Object.entries(spawns)) {
      for (const s of list) {
        const variant = type === 'sign' || type === 'board' || type === 'nobori' ? s.variant | 0 : 0;
        const key = type + ':' + variant;
        if (!groups.has(key)) groups.set(key, { type, variant, list: [] });
        groups.get(key).list.push(s);
      }
    }
    let id = 0;
    for (const grp of groups.values()) {
      const geo = builders[grp.type](grp.variant);
      const mesh = new THREE.InstancedMesh(geo, this.material, grp.list.length);
      mesh.name = 'props-' + grp.type;
      mesh.castShadow = shadows;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const kind = KINDS[grp.type];
      grp.list.forEach((s, i) => {
        const groundY = tileAtWorld(s.x, s.z) === T.SOLID || tileAtWorld(s.x, s.z) === T.BANK ? 0.15 : 0;
        const item = {
          id: 'prop' + id++,
          type: grp.type,
          kind,
          mesh,
          index: i,
          x: s.x,
          z: s.z,
          y: groundY,
          groundY,
          rot: s.rot || 0,
          state: 0,
          q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot || 0),
          vx: 0, vy: 0, vz: 0,
          w: new THREE.Vector3(),
          rest: 0,
        };
        if (grp.type === 'guardrail') {
          const along = Math.abs(Math.sin(item.rot)) < 0.5; // rot 0 → x 方向
          item.box = along
            ? { x0: s.x - 2.0, x1: s.x + 2.0, z0: s.z - 0.15, z1: s.z + 0.15 }
            : { x0: s.x - 0.15, x1: s.x + 0.15, z0: s.z - 2.0, z1: s.z + 2.0 };
          this.hash.insertAABB(item, item.box.x0, item.box.z0, item.box.x1, item.box.z1);
        } else {
          this.hash.insertAABB(item, s.x - kind.r, s.z - kind.r, s.x + kind.r, s.z + kind.r);
        }
        this.items.push(item);
        this._write(item);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      scene.add(mesh);
    }
  }

  _write(it) {
    const d = this._dummy;
    d.position.set(it.x, it.y, it.z);
    d.quaternion.copy(it.q);
    const s = it.hidden ? 0.0001 : 1;
    d.scale.set(s, s, s);
    d.updateMatrix();
    it.mesh.setMatrixAt(it.index, d.matrix);
  }

  /** 車体の円列と衝突判定。衝突した小物を吹き飛ばし、バスの減速率を返す */
  collideBus(circles, radius, bus, t) {
    let slow = 0;
    const near = this._near;
    for (const c of circles) {
      this.hash.query(c.x, c.z, radius + 2.2, near);
      for (const it of near) {
        if (it.state !== 0) continue;
        let hit;
        if (it.box) hit = circleVsAABB(c.x, c.z, radius, it.box);
        else hit = circleVsCircle(c.x, c.z, radius, it.x, it.z, it.kind.r);
        if (!hit) continue;
        this._launch(it, bus, c);
        slow = Math.max(slow, it.kind.slow);
        this.onHit && this.onHit(it, t);
      }
    }
    return slow;
  }

  /** 他車などが当たったとき（罰金なし） */
  collideOther(x, z, r, vx, vz) {
    const near = this._near;
    this.hash.query(x, z, r + 2.2, near);
    for (const it of near) {
      if (it.state !== 0) continue;
      const hit = it.box ? circleVsAABB(x, z, r, it.box) : circleVsCircle(x, z, r, it.x, it.z, it.kind.r);
      if (!hit) continue;
      this._launch(it, { vx, vz, speed: Math.hypot(vx, vz), x, z }, { x, z });
      it.noCharge = true;
    }
  }

  _launch(it, bus, c) {
    const sp = Math.max(2.5, bus.speed);
    let ax = it.x - c.x, az = it.z - c.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const k = it.kind;
    const fling = (0.9 + Math.random() * 0.5) / Math.sqrt(k.mass + 0.3);
    it.vx = bus.vx * 1.1 * fling + ax * (2 + sp * 0.3);
    it.vz = bus.vz * 1.1 * fling + az * (2 + sp * 0.3);
    it.vy = (2.5 + sp * 0.55) * k.lift * (0.8 + Math.random() * 0.5);
    const spin = (3 + sp * 0.6) * (0.6 + Math.random());
    it.w.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize().multiplyScalar(spin / Math.sqrt(k.mass + 0.2));
    it.state = 1;
    it.rest = 0;
    this.flying.push(it);
  }

  update(dt) {
    if (!this.flying.length) return;
    const g = 22;
    const tmpAxis = new THREE.Vector3();
    const touched = new Set();
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const it = this.flying[i];
      it.vy -= g * dt;
      let nx = it.x + it.vx * dt, nz = it.z + it.vz * dt;
      // 建物にぶつかったら跳ね返る
      const tt = tileAtWorld(nx, nz);
      if (tt === T.SOLID && it.y < 12) {
        const r = solidRectForTile(Math.floor(nx / TILE), Math.floor(nz / TILE));
        if (r && nx > r.x0 && nx < r.x1 && nz > r.z0 && nz < r.z1) {
          const inX = it.x > r.x0 && it.x < r.x1;
          const inZ = it.z > r.z0 && it.z < r.z1;
          if (!inX) it.vx *= -0.35;
          if (!inZ) it.vz *= -0.35;
          nx = it.x;
          nz = it.z;
        }
      }
      it.x = nx;
      it.z = nz;
      it.y += it.vy * dt;
      const wl = it.w.length();
      if (wl > 1e-4) {
        tmpAxis.copy(it.w).divideScalar(wl);
        this._q.setFromAxisAngle(tmpAxis, wl * dt);
        it.q.premultiply(this._q);
      }
      const tile = tileAtWorld(it.x, it.z);
      const ground = tile === T.WATER ? -1.9 : tile === T.SOLID || tile === T.BANK ? 0.15 : 0;
      if (it.y < ground) {
        if (tile === T.WATER) {
          // 川に落ちた
          it.hidden = true;
          it.state = 2;
          this.onSplash && this.onSplash(it);
          this._write(it);
          touched.add(it.mesh);
          this.flying.splice(i, 1);
          continue;
        }
        it.y = ground;
        if (it.vy < -2.5) {
          it.vy = -it.vy * 0.35;
          it.vx *= 0.6;
          it.vz *= 0.6;
          it.w.multiplyScalar(0.6);
        } else {
          it.vy = 0;
          it.vx *= Math.pow(0.02, dt);
          it.vz *= Math.pow(0.02, dt);
          it.w.multiplyScalar(Math.pow(0.01, dt));
          it.rest += dt;
        }
      }
      this._write(it);
      touched.add(it.mesh);
      if (it.rest > 1.2 && Math.hypot(it.vx, it.vz) < 0.2) {
        it.state = 2;
        this.flying.splice(i, 1);
      }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  setShadows(on) {
    for (const m of this.meshes) m.castShadow = on;
  }

  /** ミニマップ・テスト用 */
  countStanding() {
    return this.items.filter((i) => i.state === 0).length;
  }
}

export { KINDS as PROP_KINDS };
