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
  onTimeGraceSec: 5, // 遅延がこの秒数以下なら「定時」
  allStopsBonus: 5000, // 全停留所制覇ボーナス
  resetPenalty: 1000, // R: 路面復帰ペナルティ
  impactPenalty: 500, // 激しい衝撃で乗客転倒（急停止・衝撃）
  impactSpeedKmh: 28, // この速度以上の減速を伴う衝突で乗客転倒
  suddenBrakePenalty: 300, // 急ブレーキ（満足度減点の代わりに「その他ペナルティ」）
  suddenBrakeKmh: 50, // この速度以上で
  suddenBrakeDecel: 11.5, // この減速度（m/s²）を超えた状態が
  suddenBrakeSec: 0.45, // この秒数続くと急ブレーキ
  suddenBrakeFreeWarnings: 2, // 最初の何回かは注意だけ（罰金なし）
  stopSpeedKmh: 1.2, // 停留所の枠内でこの速度以下（ほぼ停止）になったら到着
  dwellBaseSec: 1.2, // 乗降処理の基本時間
  dwellPerPersonSec: 0.12, // 1人あたりの乗降時間
  capacity: 60, // 定員
  timeLimitMarginSec: 75, // 終点の定刻 + この秒数 = 制限時間
  startClockSec: 8 * 3600, // 8:00:00 発
  scheduleSpeed: 12, // 時刻表作成用の想定速度 (m/s)。曲がり角・踏切待ちは別に足す。大通りを丁寧に走ってだいたい定時になる程度
  scheduleDwellSec: 4, // 時刻表作成用の停車時間
  scheduleTurnSec: 3, // 時刻表作成用：曲がり角 1 つあたりの減速・加速のロス
  firstStopSlackSec: 12, // 最初の停留所の余裕（以降の時刻もこのぶん後ろにずれる。慣れるまでの猶予）
};

// 公開先の URL（シェア文・OGP 用。ローカルで動かしているときもこの URL を使う）
export const SITE_URL = 'https://cadmium2525.github.io/bus-panic/';

// 器物破損の罰金（物体単位で一度だけ計上）
export const PENALTY = {
  cone: { label: 'コーン・植木鉢', amount: 200 },
  sign: { label: '道路標識・看板', amount: 1000 },
  guardrail: { label: 'ガードレール', amount: 2000 },
  car: { label: '他車への衝突', amount: 3000 },
};

// 評価ランク（仮）
export const RANKS = [
  { rank: 'S', min: 66000, comment: '伝説の運転手。乗客は二度と忘れない。' },
  { rank: 'A', min: 52000, comment: '敏腕ドライバー。営業所長も鼻が高い。' },
  { rank: 'B', min: 38000, comment: 'まずまずの運行。始末書は1枚で済んだ。' },
  { rank: 'C', min: 24000, comment: '赤字ギリギリ。乗客の顔が引きつっている。' },
  { rank: 'D', min: -Infinity, comment: '運行停止処分。もう一度教習所へ。' },
];

// 暴走モード（破壊点）のランク
export const RAMPAGE = {
  seconds: 120,
  comboWindow: 2.5, // この秒数以内に次を壊すとコンボ継続（違う種類なら +1、同じ種類なら据え置き）
  // 壊したときの得点（ガードレールは数が多く並んでいるので低め）
  points: { cone: 300, sign: 1200, guardrail: 400, car: 3000, crossing: 1500, train: 5000 },
  ranks: [
    { rank: 'S', min: 100000, comment: '街の再開発を一人でやり遂げた。' },
    { rank: 'A', min: 65000, comment: '保険会社が泣いている。' },
    { rank: 'B', min: 40000, comment: 'なかなかの暴れっぷり。' },
    { rank: 'C', min: 20000, comment: 'まだ理性が残っている。' },
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
