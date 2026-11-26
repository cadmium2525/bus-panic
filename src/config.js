// ゲーム全体の調整値（企画書の初期案をベースに、バランステストで調整する前提）

export const RULES = {
  farePerPassenger: 250, // 1人乗車につき250円（仮値）
  lateStepSec: 10, // 予定時刻を超えると10秒ごとに待機客が1人減る
  onTimeBonus: 500, // 定時到着ボーナス（1停留所あたり）
  comboStep: 250, // 定時コンボ 1 回ごとの上乗せ
  comboMaxBonus: 2000, // 定時ボーナスの上限（コンボ 7 回目以降）
  pita: { perfect: 500, great: 250, good: 100 }, // ピタ止めボーナス
  hurryTip: 2000, // 急ぎの客を間に合わせたときのチップ
  rivalWin: 1000, // ライバルより先に停留所に着いたボーナス
  crossingPenalty: 2000, // 遮断機が下りている踏切に入った（踏切無視）
  crossingSlackSec: 8, // 踏切を渡る区間の時刻表の余裕（電車待ち）
  onTimeGraceSec: 0, // 遅延がこの秒数以下なら「定時」
  allStopsBonus: 5000, // 全停留所制覇ボーナス
  resetPenalty: 1000, // R: 路面復帰ペナルティ
  impactPenalty: 500, // 激しい衝撃で乗客転倒（急停止・衝撃）
  impactSpeedKmh: 28, // この速度以上の減速を伴う衝突で乗客転倒
  suddenBrakePenalty: 300, // 急ブレーキ（満足度減点の代わりに「その他ペナルティ」）
  suddenBrakeKmh: 45, // この速度以上で
  suddenBrakeDecel: 10.5, // この減速度（m/s²）を超えると急ブレーキ
  stopSpeedKmh: 5, // この速度以下で停留所の停車判定
  dwellBaseSec: 1.2, // 乗降処理の基本時間
  dwellPerPersonSec: 0.12, // 1人あたりの乗降時間
  capacity: 60, // 定員
  timeLimitMarginSec: 75, // 終点の定刻 + この秒数 = 制限時間
  startClockSec: 8 * 3600, // 8:00:00 発
  scheduleSpeed: 10.2, // 時刻表作成用の想定平均速度 (m/s)。上手な運転＋近道で定時に間に合う程度
  scheduleDwellSec: 4, // 時刻表作成用の停車時間
  firstStopSlackSec: 6,
};

// 器物破損の罰金（物体単位で一度だけ計上）
export const PENALTY = {
  cone: { label: 'コーン・植木鉢', amount: 200 },
  sign: { label: '道路標識・看板', amount: 1000 },
  guardrail: { label: 'ガードレール', amount: 2000 },
  car: { label: '他車への衝突', amount: 3000 },
};

// 評価ランク（仮）
export const RANKS = [
  { rank: 'S', min: 62000, comment: '伝説の運転手。乗客は二度と忘れない。' },
  { rank: 'A', min: 47000, comment: '敏腕ドライバー。営業所長も鼻が高い。' },
  { rank: 'B', min: 33000, comment: 'まずまずの運行。始末書は1枚で済んだ。' },
  { rank: 'C', min: 20000, comment: '赤字ギリギリ。乗客の顔が引きつっている。' },
  { rank: 'D', min: -Infinity, comment: '運行停止処分。もう一度教習所へ。' },
];

// 暴走モード（破壊点）のランク
export const RAMPAGE = {
  seconds: 120,
  comboWindow: 2.5, // この秒数以内に次を壊すとコンボ継続
  ranks: [
    { rank: 'S', min: 150000, comment: '街の再開発を一人でやり遂げた。' },
    { rank: 'A', min: 100000, comment: '保険会社が泣いている。' },
    { rank: 'B', min: 60000, comment: 'なかなかの暴れっぷり。' },
    { rank: 'C', min: 30000, comment: 'まだ理性が残っている。' },
    { rank: 'D', min: -Infinity, comment: 'それは安全運転です。' },
  ],
};

export const BUS = {
  length: 10.5,
  width: 2.5,
  height: 3.1,
  wheelBase: 5.6,
  maxSpeed: 20.5, // m/s ≒ 74km/h
  maxReverse: 6,
  accel: 6.2,
  brake: 13,
  reverseAccel: 4,
  drag: 0.05,
  rolling: 0.6,
  maxSteer: 0.62, // rad
  grip: 9,
  handbrakeGrip: 1.6,
  collisionRadius: 1.3,
};

export const QUALITY = {
  low: { label: '低', dprCap: 1, shadows: false, fogFar: 170, cars: 8, fpsCap: 30, decorDensity: 0.5 },
  mid: { label: '中', dprCap: 1.5, shadows: false, fogFar: 260, cars: 14, fpsCap: 60, decorDensity: 0.8 },
  high: { label: '高', dprCap: 2, shadows: true, fogFar: 380, cars: 20, fpsCap: 0, decorDensity: 1 },
};

export const PHYSICS_DT = 1 / 120;
