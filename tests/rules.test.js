// 企画書「8. 受け入れ条件」に対応するロジックのテスト（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingPassengers, resolveStop, computeScore, rankFor, PenaltyLedger, buildSchedule, formatClock, formatYen,
} from '../src/game/rules.js';
import { RULES, PENALTY, RANKS } from '../src/config.js';

test('遅延10秒ごとに待機客が1人減る（式: max(0, 初期 − floor(遅延/10))）', () => {
  assert.equal(remainingPassengers(8, -30), 8, '早着は減らない');
  assert.equal(remainingPassengers(8, 0), 8);
  assert.equal(remainingPassengers(8, 9.99), 8);
  assert.equal(remainingPassengers(8, 10), 7);
  assert.equal(remainingPassengers(8, 19.9), 7);
  assert.equal(remainingPassengers(8, 20), 6);
  assert.equal(remainingPassengers(8, 75), 1);
});

test('待機客は0未満にならない', () => {
  assert.equal(remainingPassengers(3, 30), 0);
  assert.equal(remainingPassengers(3, 1000), 0);
  assert.equal(remainingPassengers(0, 50), 0);
  for (let d = 0; d < 500; d += 3.7) assert.ok(remainingPassengers(5, d) >= 0);
});

test('停留所の乗降処理: 運賃は1人250円、定時ならボーナス', () => {
  const r = resolveStop({ initialWaiting: 10, alighting: 3, scheduledSec: 100, arrivalSec: 95, onboard: 5 });
  assert.equal(r.waiting, 10);
  assert.equal(r.board, 10);
  assert.equal(r.off, 3);
  assert.equal(r.fare, 10 * RULES.farePerPassenger);
  assert.equal(r.fare, 2500);
  assert.equal(r.onTime, true);
  assert.equal(r.bonus, RULES.onTimeBonus);

  const late = resolveStop({ initialWaiting: 10, alighting: 0, scheduledSec: 100, arrivalSec: 135, onboard: 0 });
  assert.equal(late.waiting, 7);
  assert.equal(late.lost, 3);
  assert.equal(late.onTime, false);
  assert.equal(late.bonus, 0);
});

test('降車人数は乗車中の人数を超えない・定員を超えて乗れない', () => {
  const r = resolveStop({ initialWaiting: 10, alighting: 20, scheduledSec: 0, arrivalSec: 0, onboard: 4 });
  assert.equal(r.off, 4);
  const full = resolveStop({ initialWaiting: 10, alighting: 0, scheduledSec: 0, arrivalSec: 0, onboard: RULES.capacity - 3 });
  assert.equal(full.board, 3);
  assert.equal(full.leftBehind, 7);
});

test('罰金は物体単位で一度だけ計上される', () => {
  const l = new PenaltyLedger();
  assert.equal(l.charge('cone-1', 'cone', PENALTY.cone.amount, 'コーン'), true);
  assert.equal(l.charge('cone-1', 'cone', PENALTY.cone.amount, 'コーン'), false, '同じ物体の連続接触は重複しない');
  assert.equal(l.charge('cone-1', 'cone', PENALTY.cone.amount, 'コーン'), false);
  assert.equal(l.charge('rail-7', 'guardrail', PENALTY.guardrail.amount, 'ガードレール'), true);
  assert.equal(l.charge('car3#1', 'car', PENALTY.car.amount, '他車'), true);
  assert.equal(l.charge('car3#1', 'car', PENALTY.car.amount, '他車'), false);
  assert.equal(l.charge('car3#2', 'car', PENALTY.car.amount, '他車'), true, '再出現した車は別物体');
  assert.equal(l.total(), 200 + 2000 + 3000 + 3000);
  assert.equal(l.count('cone'), 1);
  assert.equal(l.count('car'), 2);
});

test('罰金額は企画書の初期案どおり', () => {
  assert.equal(PENALTY.cone.amount, 200);
  assert.equal(PENALTY.sign.amount, 1000);
  assert.equal(PENALTY.guardrail.amount, 2000);
  assert.equal(PENALTY.car.amount, 3000);
});

test('総合スコア = 運賃 + 定時ボーナス + 全停留所制覇 − 器物破損 − その他（企画書の例）', () => {
  const s = computeScore({ fare: 42000, onTimeBonus: 8000, allStops: true, damage: 12000, other: 3000 });
  assert.equal(s.allStopsBonus, 5000);
  assert.equal(s.total, 40000);
  const s2 = computeScore({ fare: 1000, onTimeBonus: 0, allStops: false, damage: 0, other: 0 });
  assert.equal(s2.allStopsBonus, 0);
  assert.equal(s2.total, 1000);
});

test('明細の合計と総合点が整合する', () => {
  for (let i = 0; i < 50; i++) {
    const fare = Math.floor(Math.random() * 160) * 250;
    const onTimeBonus = Math.floor(Math.random() * 15) * 500;
    const damage = Math.floor(Math.random() * 30) * 200;
    const other = Math.floor(Math.random() * 5) * 500;
    const allStops = Math.random() < 0.5;
    const s = computeScore({ fare, onTimeBonus, allStops, damage, other });
    assert.equal(s.fare + s.onTimeBonus + s.allStopsBonus - s.damage - s.other, s.total);
  }
});

test('ランクは S/A/B/C/D の順に判定', () => {
  assert.deepEqual(RANKS.map((r) => r.rank), ['S', 'A', 'B', 'C', 'D']);
  assert.equal(rankFor(999999).rank, 'S');
  assert.equal(rankFor(RANKS[1].min).rank, 'A');
  assert.equal(rankFor(RANKS[1].min - 1).rank, 'B');
  assert.equal(rankFor(-5000).rank, 'D');
});

test('時刻表は単調増加で5秒単位', () => {
  const t = buildSchedule([100, 300, 250, 400]);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
  for (const x of t) assert.equal(x % 5, 0);
});

test('表示用フォーマット', () => {
  assert.equal(formatClock(8 * 3600 + 65), '8:01:05');
  assert.equal(formatYen(12500), '¥12,500');
  assert.equal(formatYen(-200), '−¥200');
});
