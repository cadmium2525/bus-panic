// マップ・停留所データの整合性テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { N, T, TILE, tileAt, isDrivableType, shortestPath, solidRectForTile, laneCheck } from '../src/world/map.js';
import { STOP_DEFS, START, createStops, inZone, legDistances, legPath } from '../src/game/stops.js';
import { RULES } from '../src/config.js';

test('停留所は15か所（調整範囲10〜20）で、終点は1つ', () => {
  assert.ok(STOP_DEFS.length >= 10 && STOP_DEFS.length <= 20);
  assert.equal(STOP_DEFS.length, 15);
  assert.equal(STOP_DEFS.filter((s) => s.terminal).length, 1);
  assert.ok(STOP_DEFS[STOP_DEFS.length - 1].terminal);
});

test('各停留所は走行可能な車線上にあり、歩道側は建物（停車できる）', () => {
  const dirs = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  for (const s of STOP_DEFS) {
    assert.ok(isDrivableType(tileAt(s.c, s.r)), `${s.name} の車線`);
    if (s.terminal) continue;
    const [dx, dz] = dirs[s.curb];
    assert.equal(tileAt(s.c + dx, s.r + dz), T.SOLID, `${s.name} の歩道側`);
  }
});

test('すべての停留所へ幹線道路だけで到達できる', () => {
  let prev = { c: START.c, r: START.r };
  for (const s of STOP_DEFS) {
    const p = shortestPath(prev, { c: s.c, r: s.r }, false);
    assert.ok(p, `${s.name} に到達できない`);
    prev = { c: s.c, r: s.r };
  }
});

test('近道（路地）で短縮できる区間が複数ある（複数ルートの勝ち筋。左側通行・U ターンなしで比べる）', () => {
  let shortcuts = 0;
  STOP_DEFS.forEach((s, i) => {
    const main = legPath(STOP_DEFS[i - 1], s).tiles;
    const any = legPath(STOP_DEFS[i - 1], s, null, true).tiles;
    if (main - any >= 8) shortcuts++;
  });
  assert.ok(shortcuts >= 3, `近道のある区間: ${shortcuts}`);
});

test('おすすめルートは逆走も U ターンもしない', () => {
  STOP_DEFS.forEach((s, i) => {
    const p = legPath(STOP_DEFS[i - 1], s);
    assert.equal(p.wrong, 0, `${s.name}：逆走 ${p.wrong} マス`);
    const dirs = [];
    for (let k = 1; k < p.path.length; k++) dirs.push([p.path[k].c - p.path[k - 1].c, p.path[k].r - p.path[k - 1].r]);
    // 4 マス以内に向きが真逆になることはない
    for (let a = 0; a < dirs.length; a++) {
      for (let b = a + 1; b < Math.min(dirs.length, a + 5); b++) {
        assert.ok(!(dirs[a][0] === -dirs[b][0] && dirs[a][1] === -dirs[b][1]), `${s.name}：${a} マス目付近で折り返し`);
      }
    }
  });
});

test('車線の判定（左側通行）', () => {
  // 東西の道 r2（行 17・18）：北側が東行き
  assert.equal(laneCheck(10, 17, 1, 0), 'ok');
  assert.equal(laneCheck(10, 17, -1, 0), 'wrong');
  assert.equal(laneCheck(10, 18, -1, 0), 'ok');
  // 南北の道 B（列 20・21）：東側が南行き
  assert.equal(laneCheck(21, 10, 0, 1), 'ok');
  assert.equal(laneCheck(20, 10, 0, 1), 'wrong');
  assert.equal(laneCheck(20, 10, 0, -1), 'ok');
  // 路地は自由
  assert.equal(laneCheck(12, 10, 0, 1), 'free');
});

test('時刻表: 定刻は単調増加し、制限時間内に収まる（1プレイ5〜10分）', () => {
  const stops = createStops();
  for (let i = 1; i < stops.length; i++) assert.ok(stops[i].scheduled > stops[i - 1].scheduled);
  const limit = stops[stops.length - 1].scheduled + RULES.timeLimitMarginSec;
  assert.ok(limit >= 5 * 60 && limit <= 10 * 60, `制限時間 ${limit}s`);
  assert.equal(legDistances().length, stops.length);
});

test('停車判定ゾーンの中心は走行可能で、ゾーン内判定が機能する', () => {
  for (const s of createStops()) {
    const t = tileAt(Math.floor(s.zone.cx / TILE), Math.floor(s.zone.cz / TILE));
    assert.ok(isDrivableType(t), s.name);
    assert.ok(inZone(s, s.zone.cx, s.zone.cz));
    assert.ok(!inZone(s, s.zone.cx + s.zone.hx + 0.5, s.zone.cz));
  }
});

test('建物の当たり判定は幹線沿いで歩道ぶん後退している', () => {
  // 道路 r1 の北側タイル (9,2) は建物 / 道路に面した辺は 2.5m 後退
  const r = solidRectForTile(9, 2);
  assert.ok(r);
  assert.equal(r.z1, 3 * TILE - 2.5);
  assert.equal(solidRectForTile(9, 3), null, '道路タイルは当たり判定なし');
  // マップ外は壁
  assert.equal(tileAt(-1, 5), T.SOLID);
  assert.equal(tileAt(N, 5), T.SOLID);
});
