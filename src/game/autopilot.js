// デバッグ・動作検証用の自動運転（URL に ?autopilot を付けると有効）
// 経路探索した車線タイルの中心を pure pursuit で追従する。
import { TILE, shortestPath, tileCenter } from '../world/map.js';
import { inZone } from './stops.js';

export class Autopilot {
  constructor({ alleys = false, cruise = 15, turnSpeed = 6.5, decel = 6 } = {}) {
    this.alleys = alleys;
    this.cruise = cruise;
    this.turnSpeed = turnSpeed;
    this.decel = decel;
    this.path = null;
    this.target = -1;
    this.replan = 0;
  }

  _plan(bus, stop) {
    const from = { c: Math.floor(bus.x / TILE), r: Math.floor(bus.z / TILE) };
    const to = { c: stop.c, r: stop.r };
    const p = (this.blocked && shortestPath(from, to, this.alleys, this.blocked)) || shortestPath(from, to, this.alleys);
    if (!p) return;
    this.path = p.path.map((t) => tileCenter(t.c, t.r));
    // 最後はピタ止めの位置（なければゾーン中心）
    this.path.push(stop.target ? { x: stop.target.x, z: stop.target.z } : { x: stop.zone.cx, z: stop.zone.cz });
    this.idx = 0;
  }

  drive(bus, stop, dt) {
    // 引っかかったらしばらく後退する
    if (this.backing > 0) {
      this.backing -= dt;
      if (this.backing <= 0) this.replan = 0;
      return { throttle: false, brake: true, steer: -this.backSteer, handbrake: false };
    }
    if (this._wantMove && bus.speed < 0.6) this.stuck = (this.stuck || 0) + dt;
    else this.stuck = 0;
    if (this.stuck > 1.2) {
      this.stuck = 0;
      this.backing = 1.6;
      this.backSteer = this._lastSteer || 0;
      return { throttle: false, brake: true, steer: 0, handbrake: false };
    }
    this.replan -= dt;
    if (this.target !== stop.index || this.replan <= 0 || !this.path) {
      this.target = stop.index;
      this.replan = 1.5;
      this._plan(bus, stop);
    }
    const out = { throttle: false, brake: false, steer: 0, handbrake: false };
    if (!this.path) return out;
    // 最寄りの経路点から先を見る
    let best = this.idx, bd = Infinity;
    for (let i = this.idx; i < Math.min(this.path.length, this.idx + 6); i++) {
      const d = Math.hypot(this.path[i].x - bus.x, this.path[i].z - bus.z);
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    const look = Math.max(7, bus.speed * 0.9);
    let tgt = this.path[this.path.length - 1];
    for (let i = this.idx; i < this.path.length; i++) {
      if (Math.hypot(this.path[i].x - bus.x, this.path[i].z - bus.z) >= look) { tgt = this.path[i]; break; }
    }
    const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
    const dx = tgt.x - bus.x, dz = tgt.z - bus.z;
    const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz); // 正 = 右
    out.steer = Math.max(-1, Math.min(1, ang * 2.2));
    // 次の曲がり角までの距離から目標速度を決める
    let distTurn = Infinity;
    {
      let acc = Math.hypot(this.path[this.idx].x - bus.x, this.path[this.idx].z - bus.z);
      for (let i = this.idx; i < this.path.length - 2; i++) {
        const a = this.path[i], b = this.path[i + 1], c = this.path[i + 2];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(c.x - b.x, c.z - b.z);
        let d = Math.abs(t2 - t1);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > 0.5) { distTurn = acc; break; }
        if (acc > 80) break;
      }
    }
    const end = this.path[this.path.length - 1];
    const toEnd = Math.hypot(end.x - bus.x, end.z - bus.z);
    let vt = Math.min(this.cruise, Math.sqrt(this.turnSpeed * this.turnSpeed + 2 * this.decel * Math.max(0, distTurn - 6)));
    if (Math.abs(ang) > 0.6) vt = Math.min(vt, 5);
    // ピタ止め位置の手前で 5km/h を切るように減速する
    vt = Math.min(vt, Math.sqrt(2 * this.decel * Math.max(0, toEnd - 0.5)) + 0.6);
    if (inZone(stop, bus.x, bus.z) && toEnd < 1.2) vt = 0;
    // 踏切が鳴っていたら手前で止まる（railway を渡されたときだけ）
    if (this.railway) {
      const d = this.railway.shouldStop(bus.x, bus.z, bus.h) - 5.5;
      if (d < 30) vt = Math.min(vt, Math.max(0, Math.sqrt(2 * this.decel * Math.max(0, d - 0.5)) - 0.4));
    }
    if (bus.speed < vt - 0.5) out.throttle = true;
    else if (bus.speed > vt + 0.8) out.brake = true;
    if (vt === 0) out.brake = bus.speed > 0.2;
    this._wantMove = vt > 1 && out.throttle;
    this._lastSteer = out.steer;
    return out;
  }
}
