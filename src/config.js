// ゲーム全体の調整値（企画書の初期案をベースに、バランステストで調整する前提）

export const RULES = {
  farePerPassenger: 250, // 1人乗車につき250円（仮値）
  lateStepSec: 10, // 予定時刻を超えると10秒ごとに待機客が1人減る
  onTimeBonus: 500, // 定時到着ボーナス（1停留所あたり）
  comboStep: 250, // 定時コンボ 1 回ごとの上乗せ
  comboMaxBonus: 2000, // 定時ボーナスの上限（コンボ 7 回目以降）
  pita: { perfect: 500, great: 250, good: 100 }, // ピタ止めボーナス
  hurryTip: 2000, // 急ぎの客を間に合わせたときのチップ
  maki: { freeSec: 2, perSec: 150, max: 3000 }, // 巻きボーナス：区間を時刻表の想定より速く走ると 1 秒 ¥150（最初の 2 秒はなし、1 区間 ¥3,000 まで）
  rivalWin: 1000, // ライバルより先に停留所に着いたボーナス
  crossingPenalty: 2000, // 遮断機が下りている踏切に入った（踏切無視）
  crossingSlackSec: 5, // 踏切 1 か所ごとの時刻表の余裕（電車待ち。残りは区間ごとの余裕として全体に配っている）
  trainCrashPenalty: 10000, // 電車との接触事故（その他ペナルティ）
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
  missHoldSec: 1.1, // 停止位置が大きくずれているときは、この秒数止まったままで到着（その前に動けば止め直せる）
  goodHoldSec: 0.7, // 「まあまあ」（1.5〜3m のずれ）のときの待ち時間
  dwellBaseSec: 1.2, // 乗降処理の基本時間
  dwellPerPersonSec: 0.12, // 1人あたりの乗降時間
  capacity: 60, // 定員
  timeLimitMarginSec: 75, // 終点の定刻 + この秒数 = 制限時間
  startClockSec: 8 * 3600, // 8:00:00 発
  // 時刻表：大通りを丁寧に走る人（自動運転より 6% ほど遅い）がだいたい定時になるように。余裕が序盤だけ・終盤だけに偏らない
  scheduleSpeed: 12.7, // 想定速度 (m/s)
  scheduleLegSec: 4.6, // 区間ごとの発進・減速のぶん（踏切待ちの余裕の一部を含む）
  scheduleTurnSec: 1.3, // 曲がり角 1 つあたりのロス
  scheduleDwellSec: 4, // 停車時間の既定値（停留所ごとの乗降人数から計算できないとき）
  scheduleDwellExtraSec: 0.5, // 乗降時間に足す余裕
  terminalExtraSec: 3, // 終点のロータリーに入る分
  firstStopSlackSec: 8, // 出発時の余裕（以降の時刻もこのぶん後ろにずれる。慣れるまでの猶予）
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
  { rank: 'S', min: 80000, comment: '伝説の運転手。乗客は二度と忘れない。' },
  { rank: 'A', min: 64000, comment: '敏腕ドライバー。営業所長も鼻が高い。' },
  { rank: 'B', min: 48000, comment: 'まずまずの運行。始末書は1枚で済んだ。' },
  { rank: 'C', min: 32000, comment: '赤字ギリギリ。乗客の顔が引きつっている。' },
  { rank: 'D', min: -Infinity, comment: '運行停止処分。もう一度教習所へ。' },
];

// 暴走モード（破壊点）のランク
// 入門コース：営業所前 → 銀座商店街 → 市役所前 → 限界小学校前 → 限界駅（約 2 分）
export const INTRO = {
  course: [0, 1, 2, 3, 14],
  timeLimitMarginSec: 50,
  ranks: [
    { rank: 'S', min: 21000, comment: '即戦力。明日から本線をお願いします。' },
    { rank: 'A', min: 16000, comment: '筋がいい。研修はもう十分。' },
    { rank: 'B', min: 11000, comment: '合格。でも営業所長は少し心配そう。' },
    { rank: 'C', min: 6000, comment: '補習あり。ブレーキは早めに。' },
    { rank: 'D', min: -Infinity, comment: '研修やり直し。まずは安全運転から。' },
  ],
};

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
  maxReverse: 4.2,
  accel: 6.2,
  brake: 13,
  reverseAccel: 2.4,
  drag: 0.04,
  rolling: 0.45,
  maxSteer: 0.62, // rad
  grip: 9,
  handbrakeGrip: 1.6,
  collisionRadius: 1.3,
};

// 車の台数は画質によらずほぼ同じ（暴走モードの得点や事故の起きやすさが端末で変わらないように）
export const QUALITY = {
  low: { label: '低', dprCap: 1.25, shadows: false, fogFar: 170, cars: 14, fpsCap: 30, decorDensity: 0.5 },
  mid: { label: '中', dprCap: 1.5, shadows: false, fogFar: 260, cars: 14, fpsCap: 60, decorDensity: 0.8 },
  high: { label: '高', dprCap: 2, shadows: true, fogFar: 380, cars: 18, fpsCap: 0, decorDensity: 1 },
};

export const PHYSICS_DT = 1 / 120;
