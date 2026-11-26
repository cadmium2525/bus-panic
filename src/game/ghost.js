// ゴースト：自己ベストの走りを記録して、次の運行で半透明のバスとして再生する
import * as THREE from 'three';
import { labelTexture } from '../world/textures.js';

const KEY = 'genkai-bus:ghost:v1';
const STEP = 0.1; // 秒

export class GhostRecorder {
  constructor() {
    this.data = [];
    this.acc = 0;
  }
  sample(dt, x, z, h) {
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.data.push(Math.round(x * 10), Math.round(z * 10), Math.round(h * 1000));
    }
  }
  save(total) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ v: 1, step: STEP, total, d: this.data }));
      return true;
    } catch (_) {
      return false;
    }
  }
}

export function loadGhost() {
  try {
    const g = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (!g || !Array.isArray(g.d) || g.d.length < 6) return null;
    return g;
  } catch (_) {
    return null;
  }
}

export function clearGhost() {
  try {
    window.localStorage.removeItem(KEY);
  } catch (_) {
    /* noop */
  }
}

/** 半透明のバス */
export class GhostBus {
  constructor(scene) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.32, depthWrite: false });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 10.5), mat);
    body.position.y = 1.75;
    g.add(body);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.6 }));
    edge.position.copy(body.position);
    g.add(edge);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(['GHOST', '自己ベスト'], { accent: '#7fd8ff' }), transparent: true, depthWrite: false }));
    label.scale.set(3.4, 1.1, 1);
    label.position.y = 4.4;
    g.add(label);
    this.mat = mat;
    this.label = label;
    g.visible = false;
    g.renderOrder = 6;
    scene.add(g);
    this.group = g;
    this.data = null;
  }
  setData(ghost) {
    this.data = ghost;
    this.group.visible = false;
  }
  /** 経過時間 t（秒）の位置へ */
  update(t, show, bx = 0, bz = 0) {
    const g = this.data;
    if (!g || !show) {
      this.group.visible = false;
      return;
    }
    const n = g.d.length / 3;
    const f = t / g.step;
    const i = Math.floor(f);
    if (i >= n - 1) {
      this.group.visible = false;
      return;
    }
    const a = f - i;
    const x0 = g.d[i * 3] / 10, z0 = g.d[i * 3 + 1] / 10, h0 = g.d[i * 3 + 2] / 1000;
    const x1 = g.d[i * 3 + 3] / 10, z1 = g.d[i * 3 + 4] / 10, h1 = g.d[i * 3 + 5] / 1000;
    let dh = h1 - h0;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    this.group.position.set(x0 + (x1 - x0) * a, 0, z0 + (z1 - z0) * a);
    this.group.rotation.y = h0 + dh * a;
    this.group.visible = true;
    // 自分のバスと重なっているときは目立たせない
    const d = Math.hypot(this.group.position.x - bx, this.group.position.z - bz);
    const k = Math.max(0, Math.min(1, (d - 6) / 14));
    this.mat.opacity = 0.08 + 0.24 * k;
    this.label.visible = d > 12;
  }
}
