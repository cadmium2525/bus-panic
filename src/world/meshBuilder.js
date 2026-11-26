// 頂点カラー付きのローポリ形状をまとめて1つの BufferGeometry にするビルダー
import * as THREE from 'three';

const _c = new THREE.Color();

export class MeshBuilder {
  constructor(defaultUV = [0, 0]) {
    this.duv = defaultUV;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
  }
  get vertexCount() {
    return this.pos.length / 3;
  }
  _color(color) {
    if (color instanceof THREE.Color) return color;
    return _c.set(color);
  }
  /** 4頂点の面（反時計回りで表）。uvs 省略時は (0,0) */
  quad(p0, p1, p2, p3, color, uvs) {
    const base = this.vertexCount;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const c = this._color(color);
    for (const p of [p0, p1, p2, p3]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(c.r, c.g, c.b);
    }
    if (uvs) for (const u of uvs) this.uv.push(u[0], u[1]);
    else for (let i = 0; i < 4; i++) this.uv.push(this.duv[0], this.duv[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(p0, p1, p2, color, uvs) {
    const base = this.vertexCount;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const c = this._color(color);
    for (const p of [p0, p1, p2]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(c.r, c.g, c.b);
    }
    if (uvs) for (const u of uvs) this.uv.push(u[0], u[1]);
    else for (let i = 0; i < 3; i++) this.uv.push(this.duv[0], this.duv[1]);
    this.idx.push(base, base + 1, base + 2);
  }
  /**
   * 軸平行の箱。opts.uv = 'facade' で側面を幅/高さに比例したUVにする（窓テクスチャ用）
   * opts.top=false で天面なし、opts.bottom=true で底面あり、opts.topColor 天面色
   */
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const { uv = null, top = true, bottom = false, topColor = null, uw = 8, uh = 6, sides = true, skip = null } = opts;
    const c = new THREE.Color().copy(this._color(color));
    const tc = topColor ? new THREE.Color().copy(this._color(topColor)) : c;
    const fu = (w, h) => (uv === 'facade' ? [[0, 0], [w / uw, 0], [w / uw, h / uh], [0, h / uh]] : null);
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const vo = uv === 'facade' ? opts.vOffset || 0 : 0;
    const sh = (arr) => (arr ? arr.map(([a, b]) => [a, b + vo]) : arr);
    if (sides) {
      // +z 面（南）
      if (!skip || !skip.includes('s')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, sh(fu(w, h)));
      // -z 面（北）
      if (!skip || !skip.includes('n')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c, sh(fu(w, h)));
      // +x 面（東）
      if (!skip || !skip.includes('e')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c, sh(fu(d, h)));
      // -x 面（西）
      if (!skip || !skip.includes('w')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c, sh(fu(d, h)));
    }
    const plain = uv === 'facade' ? [[0.02, 0.98], [0.02, 0.98], [0.02, 0.98], [0.02, 0.98]] : null;
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], tc, plain);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, plain);
  }
  /** 中心・サイズ・Y回転指定の箱 */
  boxRot(cx, cy, cz, sx, sy, sz, rotY, color) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const c = new THREE.Color().copy(this._color(color));
    const v = [
      P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
      P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz),
    ];
    this.quad(v[4], v[5], v[6], v[7], c);
    this.quad(v[1], v[0], v[3], v[2], c);
    this.quad(v[5], v[1], v[2], v[6], c);
    this.quad(v[0], v[4], v[7], v[3], c);
    this.quad(v[7], v[6], v[2], v[3], c);
  }
  /** 切妻屋根: 棟が x 方向 (alongX) または z 方向 */
  gableRoof(x0, z0, x1, z1, y, rise, color, alongX = true, overhang = 0.4) {
    x0 -= overhang; x1 += overhang; z0 -= overhang; z1 += overhang;
    const c = new THREE.Color().copy(this._color(color));
    const dark = c.clone().multiplyScalar(0.8);
    if (alongX) {
      const zm = (z0 + z1) / 2;
      this.quad([x0, y, z1], [x1, y, z1], [x1, y + rise, zm], [x0, y + rise, zm], c);
      this.quad([x1, y, z0], [x0, y, z0], [x0, y + rise, zm], [x1, y + rise, zm], dark);
      this.tri([x1, y, z1], [x1, y, z0], [x1, y + rise, zm], c);
      this.tri([x0, y, z0], [x0, y, z1], [x0, y + rise, zm], c);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad([x1, y, z1], [x1, y, z0], [xm, y + rise, z0], [xm, y + rise, z1], c);
      this.quad([x0, y, z0], [x0, y, z1], [xm, y + rise, z1], [xm, y + rise, z0], dark);
      this.tri([x0, y, z1], [x1, y, z1], [xm, y + rise, z1], c);
      this.tri([x1, y, z0], [x0, y, z0], [xm, y + rise, z0], c);
    }
  }
  /** 縦の円柱（側面＋天面） */
  cylinder(cx, y0, cz, r, h, color, seg = 6, topColor = null) {
    const c = new THREE.Color().copy(this._color(color));
    const tc = topColor ? new THREE.Color().copy(this._color(topColor)) : c;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    for (let i = 0; i < seg; i++) {
      const a = pts[i], b = pts[(i + 1) % seg];
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y0 + h, a[1]], [b[0], y0 + h, b[1]], c);
    }
    for (let i = 1; i < seg - 1; i++) {
      this.tri([pts[0][0], y0 + h, pts[0][1]], [pts[i + 1][0], y0 + h, pts[i + 1][1]], [pts[i][0], y0 + h, pts[i][1]], tc);
    }
  }
  /** 円錐（木の葉など） */
  cone(cx, y0, cz, r, h, color, seg = 6) {
    const c = new THREE.Color().copy(this._color(color));
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(
        [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r],
        [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r],
        [cx, y0 + h, cz],
        c,
      );
    }
  }
  /** 低ポリの球（八面体を少し分割） */
  blob(cx, cy, cz, r, color, ry = r) {
    const c = new THREE.Color().copy(this._color(color));
    const seg = 6;
    const ring = (y, rr) => {
      const a = [];
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * Math.PI * 2 + (y > 0 ? Math.PI / seg : 0);
        a.push([cx + Math.cos(t) * rr, cy + y, cz + Math.sin(t) * rr]);
      }
      return a;
    };
    const top = [cx, cy + ry, cz], bot = [cx, cy - ry, cz];
    const up = ring(ry * 0.45, r * 0.9), lo = ring(-ry * 0.45, r * 0.9);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.tri(up[j], up[i], top, c);
      this.tri(lo[i], lo[j], bot, c);
      this.quad(lo[j], lo[i], up[i], up[j], c);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
