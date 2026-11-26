// ゲームルールの純粋関数群（描画に依存しないのでテスト可能）
import { RULES, RANKS } from '../config.js';

/** 遅延による残客数: max(0, 初期待機人数 − floor(遅延秒数 / 10)) */
export function remainingPassengers(initialWaiting, delaySec, stepSec = RULES.lateStepSec) {
  if (!(delaySec > 0)) return initialWaiting;
  return Math.max(0, initialWaiting - Math.floor(delaySec / stepSec));
}

/** 乗降処理にかかる時間 */
export function dwellTime(boarding, alighting) {
  return RULES.dwellBaseSec + (boarding + alighting) * RULES.dwellPerPersonSec;
}

/** 停留所に到着した時点の乗降結果を確定する */
export function resolveStop({ initialWaiting, alighting, scheduledSec, arrivalSec, onboard, capacity = RULES.capacity, taken = 0 }) {
  const delay = arrivalSec - scheduledSec;
  const remain = remainingPassengers(initialWaiting, delay);
  const waiting = Math.max(0, remain - taken); // taken: ライバルに横取りされた人数
  const off = Math.min(alighting, onboard);
  const room = capacity - (onboard - off);
  const board = Math.max(0, Math.min(waiting, room));
  const left = waiting - board; // 満員で乗れなかった客
  const onTime = delay <= RULES.onTimeGraceSec;
  return {
    delay,
    waiting,
    lost: initialWaiting - remain,
    stolen: remain - waiting,
    board,
    off,
    leftBehind: left,
    fare: board * RULES.farePerPassenger,
    onTime,
    bonus: onTime ? RULES.onTimeBonus : 0,
  };
}

/**
 * 総合スコア = 運賃収入 ＋ 定時到着ボーナス（コンボ込み）＋ 運転技術ボーナス（ピタ止め・ライバルに勝つ）
 *            ＋ チップ ＋ 全停留所制覇ボーナス − 器物破損罰金 − その他ペナルティ
 */
export function computeScore({ fare, onTimeBonus, skillBonus = 0, tips = 0, allStops, damage, other }) {
  const allStopsBonus = allStops ? RULES.allStopsBonus : 0;
  return {
    fare,
    onTimeBonus,
    skillBonus,
    tips,
    allStopsBonus,
    damage,
    other,
    total: fare + onTimeBonus + skillBonus + tips + allStopsBonus - damage - other,
  };
}

export function rankFor(total, ranks = RANKS) {
  for (const r of ranks) if (total >= r.min) return r;
  return ranks[ranks.length - 1];
}

/** 定時コンボ n 回目（1 始まり）の定時ボーナス */
export function comboBonus(n, mult = 1) {
  if (n <= 0) return 0;
  return Math.min(RULES.comboMaxBonus, RULES.onTimeBonus + RULES.comboStep * (n - 1)) * mult;
}

/**
 * ピタ止めの判定。along: 停止位置（標柱）からの前後のずれ(m)、gap: 縁石とのすき間(m)
 * 戻り値 { grade: 'perfect' | 'great' | 'good' | 'miss', bonus, label }
 */
export function pitaGrade(along, gap, mult = 1) {
  const a = Math.abs(along), g = Math.max(0, gap);
  if (a <= 0.6 && g <= 0.9) return { grade: 'perfect', bonus: RULES.pita.perfect * mult, label: 'ピタッ！' };
  if (a <= 1.5 && g <= 1.6) return { grade: 'great', bonus: RULES.pita.great * mult, label: 'ナイス停車' };
  if (a <= 3 && g <= 2.6) return { grade: 'good', bonus: RULES.pita.good * mult, label: 'まあまあ' };
  return { grade: 'miss', bonus: 0, label: '停止位置ずれ' };
}

/** 暴走モードのコンボ倍率（連続して壊した数） */
export function rampageMultiplier(chain) {
  if (chain >= 12) return 3;
  if (chain >= 7) return 2;
  if (chain >= 3) return 1.5;
  return 1;
}

/** 物体単位で一度だけ罰金を計上する台帳 */
export class PenaltyLedger {
  constructor() {
    this.hit = new Set();
    this.items = []; // {kind, amount, label, t}
  }
  /** @returns {boolean} 新規に計上したら true */
  charge(objectId, kind, amount, label, t = 0) {
    if (this.hit.has(objectId)) return false;
    this.hit.add(objectId);
    this.items.push({ kind, amount, label, t });
    return true;
  }
  /** 物体に紐付かないペナルティ（復帰・転倒など）。同じ id は計上しない */
  chargeEvent(kind, amount, label, t = 0) {
    this.items.push({ kind, amount, label, t });
  }
  total(filter) {
    let s = 0;
    for (const it of this.items) if (!filter || filter(it)) s += it.amount;
    return s;
  }
  count(kind) {
    let n = 0;
    for (const it of this.items) if (it.kind === kind) n++;
    return n;
  }
}

/** 時刻表を生成: 各区間の距離(m)から定刻(秒)を求める */
export function buildSchedule(legDistances, { speed = RULES.scheduleSpeed, dwell = RULES.scheduleDwellSec, first = RULES.firstStopSlackSec } = {}) {
  const times = [];
  let t = 0;
  legDistances.forEach((d, i) => {
    t += d / speed + (i === 0 ? first : dwell);
    // 時刻表っぽく5秒単位に丸める
    times.push(Math.round(t / 5) * 5);
  });
  return times;
}

export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatYen(n) {
  const sign = n < 0 ? '−' : '';
  return `${sign}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
}
