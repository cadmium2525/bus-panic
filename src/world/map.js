// タイルベースの街マップ定義（描画・当たり判定・ミニマップ・経路探索で共有）
// 座標系: col → x = col * TILE、row → z = row * TILE。ミニマップでは z が下方向（北が上）。

export const TILE = 8; // 1タイル = 8m（幹線道路 = 2タイル、路地 = 1タイル）
export const N = 60; // 60 x 60 タイル = 480m 四方
export const SIDEWALK = 2.5; // 幹線道路沿いの歩道幅 (m)

export const T = {
  SOLID: 0, // 建物・敷地
  ROAD: 1, // 幹線道路
  ALLEY: 2, // 路地（近道）
  WATER: 3, // 川
  BRIDGE: 4, // 橋
  PLAZA: 5, // 駅前ロータリー等の広場
  BANK: 6, // 河川敷の土手
};

export const isDrivableType = (t) => t === T.ROAD || t === T.ALLEY || t === T.BRIDGE || t === T.PLAZA;
export const isMainType = (t) => t === T.ROAD || t === T.BRIDGE || t === T.PLAZA;

// 幹線道路（タイル index の組）
export const V_ROADS = { A: [3, 4], B: [20, 21], C: [37, 38], D: [54, 55] };
export const H_ROADS = { r1: [3, 4], r2: [17, 18], r3: [27, 28], r4: [41, 42], r5: [54, 55] };
export const RIVER_ROWS = [30, 33];
export const BANK_ROW = 29;
export const PARK_ROWS = [34, 35];

// 路地（近道）: [c0, r0, c1, r1, 種別]
export const ALLEYS = [
  { rect: [12, 5, 12, 16], kind: 'shop', name: '限界銀座商店街' },
  { rect: [22, 10, 36, 10], kind: 'house', name: '二丁目の路地' },
  { rect: [46, 19, 46, 26], kind: 'factory', name: '工場裏の工事路地' },
  { rect: [29, 43, 29, 53], kind: 'house', name: '南町の路地' },
  { rect: [5, 48, 19, 48], kind: 'danchi', name: '団地の抜け道' },
  { rect: [39, 10, 53, 10], kind: 'shrine', name: '参道' },
];

// 区画の用途（見た目用）: [c0, r0, c1, r1, zone]
// 後から書いたものが優先される
export const ZONES = [
  [0, 0, 59, 59, 'office'],
  [5, 5, 19, 16, 'shop'],
  [5, 5, 10, 8, 'depot'],
  [22, 5, 36, 16, 'house'],
  [39, 5, 53, 16, 'house'],
  [43, 5, 49, 9, 'shrine'],
  [5, 19, 19, 26, 'office'],
  [8, 20, 16, 26, 'cityhall'],
  [22, 19, 36, 26, 'school'],
  [39, 19, 53, 26, 'factory'],
  [0, 34, 59, 35, 'park'],
  [5, 36, 36, 40, 'mansion'],
  [39, 36, 53, 40, 'hospital'],
  [5, 43, 19, 53, 'danchi'],
  [22, 43, 36, 53, 'house'],
  [22, 43, 28, 47, 'library'],
  [39, 43, 53, 53, 'station'],
  // 線路の南側
  [39, 52, 53, 53, 'house'],
  [5, 49, 19, 49, 'park'],
  [5, 52, 19, 53, 'park'],
  // 東西に走る鉄道（道路と交わるところが踏切）
  [0, 50, 59, 51, 'rail'],
];

// 鉄道：複線の中心（z）。行 50〜51 の帯を通る
export const RAIL = { rows: [50, 51], tracks: [407.2, 411.4], z0: 401, z1: 415 };

export const PLAZAS = [[41, 43, 51, 46]]; // 限界駅 バスロータリー

function buildGrid() {
  const grid = new Uint8Array(N * N).fill(T.SOLID);
  const zone = new Array(N * N).fill('office');
  const set = (c, r, t) => {
    if (c >= 0 && r >= 0 && c < N && r < N) grid[r * N + c] = t;
  };
  const fill = (c0, r0, c1, r1, t) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, t);
  };

  for (const [c0, r0, c1, r1, z] of ZONES) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) zone[r * N + c] = z;
  }

  // 川・土手
  fill(0, RIVER_ROWS[0], N - 1, RIVER_ROWS[1], T.WATER);
  fill(0, BANK_ROW, N - 1, BANK_ROW, T.BANK);

  // 東西の幹線
  for (const rows of Object.values(H_ROADS)) fill(3, rows[0], 55, rows[1], T.ROAD);

  // 南北の幹線
  const vFull = (cols) => {
    fill(cols[0], 3, cols[1], 28, T.ROAD);
    fill(cols[0], 41, cols[1], 55, T.ROAD);
  };
  for (const cols of Object.values(V_ROADS)) vFull(cols);
  // 川を渡る幹線（A と C）
  for (const cols of [V_ROADS.A, V_ROADS.C]) {
    fill(cols[0], 29, cols[1], 35, T.BRIDGE);
    fill(cols[0], 36, cols[1], 40, T.ROAD);
  }

  for (const a of ALLEYS) {
    const [c0, r0, c1, r1] = a.rect;
    fill(c0, r0, c1, r1, T.ALLEY);
  }
  for (const [c0, r0, c1, r1] of PLAZAS) fill(c0, r0, c1, r1, T.PLAZA);

  return { grid, zone };
}

const built = buildGrid();
export const grid = built.grid;
export const zoneGrid = built.zone;

export function tileAt(c, r) {
  if (c < 0 || r < 0 || c >= N || r >= N) return T.SOLID;
  return grid[r * N + c];
}
export function zoneAt(c, r) {
  if (c < 0 || r < 0 || c >= N || r >= N) return 'office';
  return zoneGrid[r * N + c];
}
export function tileAtWorld(x, z) {
  return tileAt(Math.floor(x / TILE), Math.floor(z / TILE));
}
export const tileCenter = (c, r) => ({ x: (c + 0.5) * TILE, z: (r + 0.5) * TILE });

// 非走行タイルの当たり判定矩形（幹線沿いは歩道ぶん内側に縮める）
export function solidRectForTile(c, r) {
  const t = tileAt(c, r);
  if (isDrivableType(t)) return null;
  let x0 = c * TILE, x1 = (c + 1) * TILE, z0 = r * TILE, z1 = (r + 1) * TILE;
  // 歩道は幹線道路・広場に面した側のみ（橋の脇は欄干＝壁）
  const insetFor = (nt) => {
    if (t === T.SOLID && (nt === T.ROAD || nt === T.PLAZA)) return SIDEWALK;
    return 0;
  };
  x0 += insetFor(tileAt(c - 1, r));
  x1 -= insetFor(tileAt(c + 1, r));
  // 土手は北側（川沿い道路側）に1.4mの路肩
  z0 += t === T.BANK && tileAt(c, r - 1) === T.ROAD ? 1.4 : insetFor(tileAt(c, r - 1));
  z1 -= insetFor(tileAt(c, r + 1));
  return { x0, z0, x1, z1 };
}

// 4近傍の経路探索（タイル単位）。allowAlley=false で幹線のみ。
export function shortestPath(from, to, allowAlley = true, blocked = null) {
  const ok0 = (t) => (allowAlley ? isDrivableType(t) : isMainType(t));
  const ok = blocked ? (t, i) => ok0(t) && !blocked.has(i) : ok0;
  const start = from.r * N + from.c;
  const goal = to.r * N + to.c;
  const dist = new Int32Array(N * N).fill(-1);
  const prev = new Int32Array(N * N).fill(-1);
  const q = [start];
  dist[start] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    if (cur === goal) break;
    const c = cur % N, r = (cur / N) | 0;
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
      const ni = nr * N + nc;
      if (dist[ni] >= 0 || !ok(grid[ni], ni)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (dist[goal] < 0) return null;
  const path = [];
  for (let i = goal; i !== -1; i = prev[i]) path.push({ c: i % N, r: (i / N) | 0 });
  path.reverse();
  return { tiles: dist[goal], path };
}
