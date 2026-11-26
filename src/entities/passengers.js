// 停留所で待つ乗客（待ちきれずに帰る・乗車・降車のアニメーション）
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshBuilder.js';

const CLOTHES = ['#2f5d8a', '#8a2f3c', '#3d7a4a', '#5c5c5c', '#c9a227', '#6b4c9a', '#d9d4c7', '#1f1f1f', '#b5651d', '#4aa3b5'];
const SKIN = '#f1c9a5';

function bodyGeo() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 0.2, 0.75, '#ffffff', 6); // 脚・下半身（服の色）
  m.cylinder(0, 0.75, 0, 0.26, 0.6, '#ffffff', 6);
  return m.build();
}
function headGeo() {
  const m = new MeshBuilder();
  m.blob(0, 1.55, 0, 0.17, SKIN, 0.2);
  m.blob(0, 1.66, -0.02, 0.17, '#2a1f1a', 0.1);
  return m.build();
}

export class Passengers {
  constructor(scene, max = 240) {
    this.max = max;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.bodies = new THREE.InstancedMesh(bodyGeo(), mat, max);
    this.heads = new THREE.InstancedMesh(headGeo(), mat, max);
    for (const m of [this.bodies, this.heads]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    this.people = [];
    const col = new THREE.Color();
    for (let i = 0; i < max; i++) {
      this.people.push({ i, state: 'gone', x: 0, z: 0, y: 0, h: 0, tx: 0, tz: 0, t: 0, phase: Math.random() * 6, stop: -1, cb: null, speed: 1.4 });
      this.bodies.setColorAt(i, col.set(CLOTHES[i % CLOTHES.length]));
    }
    this.bodies.instanceColor.needsUpdate = true;
    this._d = new THREE.Object3D();
    this.byStop = new Map();
  }

  _alloc() {
    return this.people.find((p) => p.state === 'gone');
  }

  /** 停留所の待機客を配置 */
  populate(stops, counts = null) {
    for (const p of this.people) p.state = 'gone';
    this.byStop.clear();
    for (const s of stops) {
      const list = [];
      const n = counts ? counts[s.index] : s.wait;
      for (let k = 0; k < n; k++) {
        const p = this._alloc();
        if (!p) break;
        const slot = this._slot(s, k);
        p.state = 'wait';
        p.stop = s.index;
        p.x = slot.x;
        p.z = slot.z;
        p.y = 0.15;
        p.h = Math.atan2(-s.curbDir.x, -s.curbDir.z) + (Math.random() - 0.5) * 0.8;
        list.push(p);
      }
      this.byStop.set(s.index, list);
    }
  }

  _slot(s, k) {
    // 標柱のまわりに列（歩道上）
    const ax = s.along.x, az = s.along.z;
    const cx = s.curbDir.x, cz = s.curbDir.z;
    const col = k % 6, row = Math.floor(k / 6);
    const along = -2.5 + col * 1.0 + (row % 2) * 0.5;
    const into = 0.6 + row * 0.55;
    const baseX = s.terminal ? s.pole.x + 2 : s.pole.x - cx * 0.6;
    const baseZ = s.terminal ? s.pole.z : s.pole.z - cz * 0.6;
    return { x: baseX + ax * along + cx * (into - 0.6), z: baseZ + az * along + cz * (into - 0.6) };
  }

  waitingAt(stopIndex) {
    return (this.byStop.get(stopIndex) || []).filter((p) => p.state === 'wait');
  }

  /** 遅延で待機客が減ったら、超過分を帰らせる */
  setWaiting(stop, n) {
    const list = this.waitingAt(stop.index);
    for (let k = list.length - 1; k >= n; k--) {
      const p = list[k];
      p.state = 'leave';
      p.t = 0;
      const dir = Math.random() < 0.5 ? 1 : -1;
      p.tx = p.x + stop.along.x * dir * 14;
      p.tz = p.z + stop.along.z * dir * 14;
      p.speed = 1.6;
    }
  }

  /** 乗車: 順番にドアへ歩く。乗り込むたびに cb() */
  board(stop, door, count, cb) {
    const list = this.waitingAt(stop.index).slice(0, count);
    list.forEach((p, k) => {
      p.state = 'board';
      p.t = -k * 0.18;
      p.tx = door.x;
      p.tz = door.z;
      p.cb = cb;
      p.speed = 2.4;
    });
    // 乗りきれない人は残る
    return list.length;
  }

  alight(stop, door, n) {
    for (let k = 0; k < n; k++) {
      const p = this._alloc();
      if (!p) return;
      p.state = 'alight';
      p.stop = -1;
      p.x = door.x;
      p.z = door.z;
      p.y = 0.15;
      p.t = -k * 0.15;
      const spread = (Math.random() - 0.5) * 10;
      p.tx = door.x + stop.curbDir.x * 2.5 + stop.along.x * spread;
      p.tz = door.z + stop.curbDir.z * 2.5 + stop.along.z * spread;
      p.speed = 1.5;
    }
  }

  clearStop(index) {
    for (const p of this.byStop.get(index) || []) if (p.state === 'wait') p.state = 'gone';
  }

  update(dt, time) {
    const d = this._d;
    for (const p of this.people) {
      if (p.state === 'gone') {
        d.position.set(0, -50, 0);
        d.scale.setScalar(0.001);
        d.updateMatrix();
        this.bodies.setMatrixAt(p.i, d.matrix);
        this.heads.setMatrixAt(p.i, d.matrix);
        continue;
      }
      let bob = 0;
      if (p.state !== 'wait') {
        p.t += dt;
        if (p.t > 0) {
          const dx = p.tx - p.x, dz = p.tz - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.1) {
            const step = Math.min(dist, p.speed * dt);
            p.x += (dx / dist) * step;
            p.z += (dz / dist) * step;
            p.h = Math.atan2(dx, dz);
            bob = Math.abs(Math.sin(time * 9 + p.phase)) * 0.08;
          }
          if (dist < 0.35) {
            if (p.state === 'board') {
              p.state = 'gone';
              p.cb && p.cb();
              continue;
            }
            if (p.state === 'leave' || p.state === 'alight') {
              p.t2 = (p.t2 || 0) + dt;
              if (p.state === 'leave' || p.t2 > 1.5) {
                p.state = 'gone';
                p.t2 = 0;
                continue;
              }
            }
          }
          if (p.t > 12) {
            p.state = 'gone';
            continue;
          }
        }
      } else {
        // 待っている間はそわそわ
        bob = Math.max(0, Math.sin(time * 2 + p.phase)) * 0.03;
      }
      d.position.set(p.x, p.y + bob, p.z);
      d.rotation.set(0, p.h, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.bodies.setMatrixAt(p.i, d.matrix);
      this.heads.setMatrixAt(p.i, d.matrix);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
