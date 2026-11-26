// ピタ止め・定時コンボ・ハプニング・日替わり・暴走モードのテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { comboBonus, pitaGrade, rampageMultiplier, resolveStop, computeScore, rankFor } from '../src/game/rules.js';
import { dailyChallenge, seededRandom, defaultMods, DAILY_MODS } from '../src/game/modes.js';
import { planClosures, planHurry, planRivals } from '../src/game/happenings.js';
import { createStops, stopError, inZone, START } from '../src/game/stops.js';
import { H_ROADS, V_ROADS, N, T, tileAt, shortestPath } from '../src/world/map.js';
import { isIntersection } from '../src/world/city.js';
import { RULES, RAMPAGE } from '../src/config.js';

test('定時コンボ：1 回目 ¥500 から 1 つごとに +¥250、上限 ¥2,000、倍率がかかる', () => {
  assert.equal(comboBonus(1), 500);
  assert.equal(comboBonus(2), 750);
  assert.equal(comboBonus(4), 1250);
  assert.equal(comboBonus(7), 2000);
  assert.equal(comboBonus(15), RULES.comboMaxBonus);
  assert.equal(comboBonus(3, 2), 2000);
});

test('ピタ止めの判定：ずれと縁石からの距離で 4 段階', () => {
  assert.equal(pitaGrade(0.2, 0.4).grade, 'perfect');
  assert.equal(pitaGrade(-0.5, 0.8).grade, 'perfect');
  assert.equal(pitaGrade(1.2, 0.4).grade, 'great');
  assert.equal(pitaGrade(0.2, 1.4).grade, 'great');
  assert.equal(pitaGrade(2.5, 0.4).grade, 'good');
  assert.equal(pitaGrade(4, 0.4).grade, 'miss');
  assert.equal(pitaGrade(0, 3).grade, 'miss');
  assert.equal(pitaGrade(0.1, 0.5).bonus, RULES.pita.perfect);
  assert.equal(pitaGrade(0.1, 0.5, 3).bonus, RULES.pita.perfect * 3);
  assert.equal(pitaGrade(5, 5).bonus, 0);
});

test('ピタ止めの目標位置は全停留所で停留所枠の中にある', () => {
  for (const s of createStops()) {
    assert.ok(inZone(s, s.target.x, s.target.z), `${s.name} の目標が枠の外`);
    const e = stopError(s, s.target.x, s.target.z);
    assert.ok(Math.abs(e.along) < 1e-6, s.name);
    assert.equal(pitaGrade(e.along, e.gap).grade, 'perfect', s.name);
  }
});

test('暴走モードの倍率はコンボ数で 1 → 1.5 → 2 → 3', () => {
  assert.equal(rampageMultiplier(1), 1);
  assert.equal(rampageMultiplier(3), 1.5);
  assert.equal(rampageMultiplier(7), 2);
  assert.equal(rampageMultiplier(20), 3);
  assert.equal(rankFor(200000, RAMPAGE.ranks).rank, 'S');
  assert.equal(rankFor(0, RAMPAGE.ranks).rank, 'D');
});

test('ライバルに横取りされた客は乗せられず、帰った客には数えない', () => {
  const r = resolveStop({ initialWaiting: 10, alighting: 2, scheduledSec: 100, arrivalSec: 95, onboard: 5, taken: 5 });
  assert.equal(r.board, 5);
  assert.equal(r.lost, 0);
  const late = resolveStop({ initialWaiting: 10, alighting: 0, scheduledSec: 100, arrivalSec: 130, onboard: 0, taken: 4 });
  assert.equal(late.lost, 3);
  assert.equal(late.board, 3);
});

test('総合スコアに運転技術ボーナスとチップが入る', () => {
  const s = computeScore({ fare: 10000, onTimeBonus: 3000, skillBonus: 1500, tips: 4000, allStops: true, damage: 2000, other: 500 });
  assert.equal(s.total, 10000 + 3000 + 1500 + 4000 + RULES.allStopsBonus - 2000 - 500);
});

test('日替わりチャレンジは同じ日なら同じ条件、日が変われば変わりうる', () => {
  const a = dailyChallenge(new Date(2026, 10, 26, 9));
  const b = dailyChallenge(new Date(2026, 10, 26, 23));
  assert.equal(a.key, '2026-11-26');
  assert.deepEqual(a.picks.map((p) => p.id), b.picks.map((p) => p.id));
  assert.equal(a.seed, b.seed);
  assert.equal(new Set(a.picks.map((p) => p.id)).size, 2);
  const keys = new Set();
  for (let d = 1; d <= 30; d++) keys.add(dailyChallenge(new Date(2026, 0, d)).picks.map((p) => p.id).join('+'));
  assert.ok(keys.size >= 10, '30 日でほとんど同じ条件になっている');
  // 条件はすべて通常値から変化させる
  for (const m of DAILY_MODS) {
    const mods = defaultMods();
    m.apply(mods);
    assert.notDeepEqual(mods, defaultMods(), m.id);
  }
});

/** traffic.js と同じ方法で交差点のグラフを作る */
function roadGraph() {
  const nodes = [];
  for (const [r0] of Object.values(H_ROADS)) for (const [c0] of Object.values(V_ROADS)) if (isIntersection(c0, r0)) nodes.push({ id: nodes.length, c: c0, r: r0, nb: [] });
  const roadLike = (t) => t === T.ROAD || t === T.BRIDGE;
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.r === b.r && b.c > a.c && !nodes.some((n) => n.r === a.r && n.c > a.c && n.c < b.c)) {
        let ok = true;
        for (let c = a.c; c <= b.c; c++) if (!roadLike(tileAt(c, a.r))) ok = false;
        if (ok) { a.nb.push(b); b.nb.push(a); }
      }
      if (a.c === b.c && b.r > a.r && !nodes.some((n) => n.c === a.c && n.r > a.r && n.r < b.r)) {
        let ok = true;
        for (let r = a.r; r <= b.r; r++) if (!roadLike(tileAt(a.c, r))) ok = false;
        if (ok) { a.nb.push(b); b.nb.push(a); }
      }
    }
  }
  return nodes;
}

test('工事の通行止めがあっても全停留所に行ける（いろいろな乱数で）', () => {
  const nodes = roadGraph();
  const stops = createStops();
  assert.ok(nodes.length > 10);
  for (let seed = 1; seed <= 25; seed++) {
    const closures = planClosures(nodes, stops, START, seededRandom(seed), 4);
    assert.ok(closures.length >= 1, `seed ${seed}: 通行止めが作られない`);
    const blocked = new Set(closures.flatMap((c) => c.seg.tiles));
    for (const s of stops) assert.ok(!blocked.has(s.r * N + s.c), `seed ${seed}: ${s.name} が通行止め`);
    let prev = { c: START.c, r: START.r };
    for (const s of stops) {
      assert.ok(shortestPath(prev, { c: s.c, r: s.r }, true, blocked), `seed ${seed}: ${s.name} に行けない`);
      prev = { c: s.c, r: s.r };
    }
    for (const c of closures) assert.ok(c.spawns.some((sp) => sp.type === 'barricade'));
  }
});

test('急ぎの客とライバルは途中の停留所に、重ならないように現れる', () => {
  const stops = createStops();
  for (let seed = 1; seed <= 25; seed++) {
    const hs = planHurry(stops, seededRandom(seed), 3);
    assert.equal(hs.length, 3);
    for (const h of hs) {
      assert.ok(h.from >= 1 && h.to < stops.length - 1, `seed ${seed}: 範囲外`);
      assert.equal(h.to, h.from + 2);
    }
    const rv = planRivals(stops, seededRandom(seed), 2);
    assert.equal(rv.length, 2);
    assert.ok(rv[1] - rv[0] >= 3);
  }
});

test('日替わりの「急ぎの客 6 人」「ライバル 4 回」は毎日その数だけ出る', async () => {
  const { pickSpaced } = await import('../src/game/happenings.js');
  const stops = createStops();
  for (let seed = 1; seed <= 40; seed++) {
    assert.equal(planHurry(stops, seededRandom(seed), 6).length, 6);
    assert.equal(planRivals(stops, seededRandom(seed), 4).length, 4);
    const p = pickSpaced(1, 11, 3, 2, seededRandom(seed));
    for (let k = 1; k < p.length; k++) assert.ok(p[k] - p[k - 1] >= 2);
    assert.ok(p[0] >= 1 && p[p.length - 1] <= 11);
  }
});

test('おすすめルートは歩道を左に見る向きで停留所に入る（左側通行）', async () => {
  const { approachPath, TRAVEL } = await import('../src/game/stops.js');
  let prev = { c: START.c, r: START.r };
  for (const s of createStops()) {
    const p = approachPath(prev, s, false);
    assert.ok(p, s.name);
    if (!s.terminal) {
      const a = p.path[p.path.length - 2], b = p.path[p.path.length - 1];
      assert.deepEqual([b.c - a.c, b.r - a.r], TRAVEL[s.curb], `${s.name} に逆向きで入る`);
    }
    prev = { c: s.c, r: s.r };
  }
});

test('入門コースは 5 停留所・約 2 分で、終点は限界駅', async () => {
  const { courseSchedule } = await import('../src/game/stops.js');
  const { INTRO } = await import('../src/config.js');
  const stops = createStops();
  assert.equal(INTRO.course.length, 5);
  assert.ok(stops[INTRO.course[INTRO.course.length - 1]].terminal);
  const t = courseSchedule(stops, INTRO.course);
  assert.equal(t.length, 5);
  for (let k = 1; k < t.length; k++) assert.ok(t[k] > t[k - 1]);
  assert.ok(t[t.length - 1] >= 90 && t[t.length - 1] <= 180, `入門コースの時間 ${t[t.length - 1]}s`);
  assert.equal(rankFor(25000, INTRO.ranks).rank, 'S');
  const { achievementsForResult } = await import('../src/game/achievements.js');
  assert.deepEqual(achievementsForResult({ mode: 'intro', reason: 'clear' }), ['intro']);
  assert.deepEqual(achievementsForResult({ mode: 'intro', reason: 'timeout' }), []);
});
