// 折り畳み可能なミニマップ（進行方向が上）
import { N, TILE, T, tileAt, RAIL } from '../world/map.js';

const SCALE = 2; // px / m（オフスクリーン）

export class Minimap {
  constructor(canvas, stops) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stops = stops;
    this.view = 200; // 表示範囲 (m)
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = N * TILE * SCALE;
    this._drawBase();
  }

  _drawBase() {
    const g = this.base.getContext('2d');
    const s = TILE * SCALE;
    g.fillStyle = '#c9c4b6';
    g.fillRect(0, 0, this.base.width, this.base.height);
    const colors = {
      [T.ROAD]: '#4a4e55',
      [T.BRIDGE]: '#5a5e66',
      [T.ALLEY]: '#7d7468',
      [T.PLAZA]: '#5b6070',
      [T.WATER]: '#5aa7d6',
      [T.BANK]: '#8fbf6a',
    };
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = tileAt(c, r);
        if (t === T.SOLID) continue;
        g.fillStyle = colors[t];
        g.fillRect(c * s, r * s, s + 0.5, s + 0.5);
      }
    }
    // 線路（枕木つき）
    for (const z of RAIL.tracks) {
      g.fillStyle = '#6b6258';
      g.fillRect(0, (z - 1.2) * SCALE, this.base.width, 2.4 * SCALE);
      g.fillStyle = '#3a3a3a';
      for (let x = 0; x < N * TILE; x += 3) g.fillRect(x * SCALE, (z - 1.2) * SCALE, 0.8 * SCALE, 2.4 * SCALE);
    }
    // 路地は点線っぽく
    g.fillStyle = 'rgba(255,214,102,0.55)';
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (tileAt(c, r) !== T.ALLEY) continue;
        g.fillRect(c * s + s * 0.42, r * s + s * 0.42, s * 0.16, s * 0.16);
      }
    }
  }

  draw({ bus, next, stopStates, cars, time, visible, route, closures = [], rival = null, hurryTo = [] }) {
    if (!visible) return;
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w < 16 || h < 16) return; // 非表示のときは描かない
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const px = (cv.width / this.view); // px per m
    g.save();
    g.beginPath();
    g.arc(cv.width / 2, cv.height / 2, cv.width / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#b9b4a6';
    g.fillRect(0, 0, cv.width, cv.height);
    // バス中心・進行方向が上
    g.translate(cv.width / 2, cv.height / 2 + cv.height * 0.12);
    g.rotate(Math.PI + bus.h);
    g.scale(px, px);
    g.translate(-bus.x, -bus.z);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, this.base.width, this.base.height, 0, 0, N * TILE, N * TILE);

    // おすすめルート
    if (route && route.length > 1) {
      g.save();
      g.lineWidth = 3.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,210,63,0.85)';
      g.setLineDash([6, 4]);
      g.lineDashOffset = -time * 20;
      g.beginPath();
      g.moveTo(bus.x, bus.z);
      for (let i = 1; i < route.length; i++) g.lineTo(route[i].x, route[i].z);
      g.stroke();
      g.restore();
    }
    // 停留所
    for (const s of this.stops) {
      const st = stopStates[s.index];
      if (st === 'off') continue; // このコースでは回らない停留所
      const isNext = s.index === next;
      if (st === 'done' && !isNext) {
        g.fillStyle = 'rgba(80,80,80,0.8)';
      } else g.fillStyle = isNext ? '#ffd23f' : s.terminal ? '#ff6b6b' : '#ffffff';
      const r = isNext ? 5 + Math.sin(time * 6) * 1.2 : 3.4;
      g.beginPath();
      g.arc(s.center.x, s.center.z, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = '#222';
      g.stroke();
    }
    // 通行止め（赤い ✕）
    g.lineCap = 'round';
    for (const c of closures) {
      const x0 = c.c0 * TILE, x1 = (c.c1 + 1) * TILE, z0 = c.r0 * TILE, z1 = (c.r1 + 1) * TILE;
      g.fillStyle = 'rgba(231,76,60,0.35)';
      g.fillRect(x0, z0, x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      for (const k of [0, 1]) {
        g.beginPath();
        g.moveTo(mx - 6, mz - 6 + k * 12);
        g.lineTo(mx + 6, mz + 6 - k * 12);
        g.stroke();
      }
      g.strokeStyle = '#e74c3c';
      g.lineWidth = 3;
      for (const k of [0, 1]) {
        g.beginPath();
        g.moveTo(mx - 6, mz - 6 + k * 12);
        g.lineTo(mx + 6, mz + 6 - k * 12);
        g.stroke();
      }
    }
    // 急ぎの客の行き先（水色の輪）
    for (const i of hurryTo) {
      const s = this.stops[i];
      if (!s) continue;
      g.strokeStyle = '#4fd2ff';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(s.center.x, s.center.z, 8 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2);
      g.stroke();
    }
    // 他車
    g.fillStyle = '#e74c3c';
    for (const c of cars) {
      if (c.state !== 'drive') continue;
      g.fillRect(c.x - 1.6, c.z - 1.6, 3.2, 3.2);
    }
    // ライバルのバス
    if (rival) {
      g.fillStyle = '#ff3b8a';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(rival.x, rival.z, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();

    // 自車
    g.save();
    g.translate(cv.width / 2, cv.height / 2 + cv.height * 0.12);
    g.fillStyle = '#2ecc71';
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(0, -9 * dpr);
    g.lineTo(6 * dpr, 7 * dpr);
    g.lineTo(0, 4 * dpr);
    g.lineTo(-6 * dpr, 7 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // 次の停留所が範囲外なら縁に矢印
    const ns = this.stops[next];
    if (ns) {
      const dx = ns.center.x - bus.x, dz = ns.center.z - bus.z;
      const dist = Math.hypot(dx, dz);
      // 画面上の方向（進行方向が上になるよう回転）
      const ch = Math.cos(bus.h), sh = Math.sin(bus.h);
      const vx = -dx * ch + dz * sh, vy = -dx * sh - dz * ch;
      const vl = Math.hypot(vx, vy) || 1;
      const rad = cv.width / 2 - 10 * dpr;
      if (Math.hypot((vx / vl) * dist * px, (vy / vl) * dist * px + cv.height * 0.12) > rad * 0.92) {
        const cx = cv.width / 2 + (vx / vl) * rad;
        const cy = cv.height / 2 + (vy / vl) * rad;
        g.save();
        g.translate(cx, cy);
        g.rotate(Math.atan2(vx, -vy));
        g.fillStyle = '#ffd23f';
        g.strokeStyle = '#222';
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        g.moveTo(0, -8 * dpr);
        g.lineTo(6 * dpr, 4 * dpr);
        g.lineTo(-6 * dpr, 4 * dpr);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    }
    // 外枠
    g.beginPath();
    g.arc(cv.width / 2, cv.height / 2, cv.width / 2 - 2, 0, Math.PI * 2);
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.stroke();
  }
}
