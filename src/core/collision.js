// 簡易当たり判定: 円 × AABB / 円 × 円。静的物体は空間ハッシュで管理。

export class SpatialHash {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this._stamp = 0;
  }
  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }
  insertAABB(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const k = this.key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(item);
      }
    }
  }
  query(x, z, r, out = []) {
    const c = this.cell;
    out.length = 0;
    const stamp = ++this._stamp;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const arr = this.map.get(this.key(ix, iz));
        if (!arr) continue;
        for (const it of arr) {
          if (it._q === stamp) continue;
          it._q = stamp;
          out.push(it);
        }
      }
    }
    return out;
  }
}

/** 円と AABB の押し出しベクトル。重なっていなければ null */
export function circleVsAABB(cx, cz, r, b) {
  const px = cx < b.x0 ? b.x0 : cx > b.x1 ? b.x1 : cx;
  const pz = cz < b.z0 ? b.z0 : cz > b.z1 ? b.z1 : cz;
  let dx = cx - px, dz = cz - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // 中心が箱の内部: 最も浅い面へ押し出す
  const l = cx - b.x0, rr = b.x1 - cx, t = cz - b.z0, bb = b.z1 - cz;
  const m = Math.min(l, rr, t, bb);
  if (m === l) return { nx: -1, nz: 0, depth: l + r };
  if (m === rr) return { nx: 1, nz: 0, depth: rr + r };
  if (m === t) return { nx: 0, nz: -1, depth: t + r };
  return { nx: 0, nz: 1, depth: bb + r };
}

export function circleVsCircle(ax, az, ar, bx, bz, br) {
  const dx = ax - bx, dz = az - bz;
  const rr = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  return { nx: dx / d, nz: dz / d, depth: rr - d };
}

/** 回転した長方形（車体）を円の列で近似 */
export function bodyCircles(x, z, heading, length, radius, count, out) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const span = length / 2 - radius;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : -span + (2 * span * i) / (count - 1);
    const c = out[i] || (out[i] = { x: 0, z: 0, off: 0 });
    c.x = x + fx * t;
    c.z = z + fz * t;
    c.off = t;
  }
  out.length = count;
  return out;
}
