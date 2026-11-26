// 効果音の定義（「かなでる」の効果音 JSON：プリセット、または層を直接書いたもの）
// 低音が大きくなりすぎないよう、重い音には低域カット（hp）を足している。

const HP = (freq, slope = 24) => ({ type: 'eq', bands: [{ type: 'hp', freq, slope }] });
const SHELF = (gain, freq = 160) => ({ type: 'eq', bands: [{ type: 'lowshelf', freq, gain }] });

export const SFX = {
  // ---- UI ----
  ui_click: { preset: 'cursor' },
  ui_ok: { preset: 'kettei' },
  ui_back: { preset: 'cancel' },
  ui_pause: { preset: 'pop', pitch: 2 },
  count: { preset: 'onebeep', fx: [HP(200)] }, // 3・2・1・ピー（1 秒間隔）
  go: { preset: 'jan', fx: [HP(150), SHELF(-4)] },

  // ---- 停留所・運賃 ----
  coin: { preset: 'coin', pitch: 2 },
  next_stop: { preset: 'chime', space: 0.3 }, // 次、とまります（降車ボタン）
  ontime: { preset: 'pinpon' },
  late: { preset: 'doyon', pitch: 7, fx: [HP(320), { type: 'eq', bands: [{ type: 'peak', freq: 1200, gain: 4, q: 0.8 }] }] },
  leave: { preset: 'hyuu', length: 0.6, pitch: 5 }, // 待ちきれずに帰る
  door: {
    // ドアのエア（プシュー）と閉まる音
    layers: [
      { src: 'noise', width: 0.4, len: 0.75, filter: { type: 'bp', freq: [[0, 4200], [0.75, 1800, 'exp']], q: 1.3 }, amp: [[0, 0], [0.02, 1], [0.25, 0.75], [0.75, 0, 'out']], gain: -2 },
      { src: 'noise', width: 0.2, len: 0.2, filter: { type: 'hp', freq: 6000 }, amp: [[0, 0], [0.005, 0.6], [0.2, 0]], gain: -10 },
      { at: 0.62, src: 'sine', freq: [[0, 240], [0.06, 150, 'exp']], amp: { a: 0.001, d: 0.09 }, drive: 6, gain: -8 },
      { at: 0.62, src: 'noise', filter: { type: 'bp', freq: 1400, q: 1.5 }, amp: { a: 0.0008, d: 0.05 }, gain: -10 },
    ],
    fx: [HP(180), { type: 'reverb', size: 0.5, decay: 0.6, mix: 0.12 }],
  },

  // ---- 衝突・罰金 ----
  cone: { preset: 'poyon', pitch: -2 },
  pot: {
    // 植木鉢（陶器が割れる）
    layers: [
      { src: 'modal', freq: 1250, modes: [[1, 0.12, 1], [2.3, 0.08, 0.6], [3.9, 0.05, 0.4], [6.1, 0.03, 0.25]], amp: { a: 0.0005, h: 0.1, d: 0.12 }, gain: -2 },
      { src: 'noise', filter: { type: 'bp', freq: 3200, q: 0.9 }, amp: { a: 0.0004, d: 0.12 }, gain: -6 },
      { at: 0.03, src: 'crackle', density: 90, filter: { type: 'hp', freq: 2500 }, len: 0.35, amp: [[0, 1], [0.35, 0]], gain: -12 },
      { src: 'sine', freq: [[0, 220], [0.05, 130, 'exp']], amp: { a: 0.001, d: 0.07 }, gain: -10 },
    ],
    fx: [HP(150), { type: 'reverb', size: 0.6, decay: 0.7, mix: 0.12 }],
  },
  sign: {
    // 標識の鉄柱（カーン）
    layers: [
      { src: 'modal', freq: 780, modes: [[1, 0.9, 1], [2.41, 0.6, 0.55], [4.13, 0.35, 0.35], [6.7, 0.2, 0.2]], amp: { a: 0.0005, h: 0.6, d: 0.4 }, gain: -2 },
      { src: 'noise', filter: { type: 'bp', freq: 2600, q: 1.2 }, amp: { a: 0.0003, d: 0.04 }, gain: -4 },
      { src: 'metal', freq: 420, filter: { type: 'hp', freq: 3000 }, amp: { d: 0.25 }, gain: -14 },
    ],
    fx: [HP(220), { type: 'reverb', size: 0.8, decay: 1, mix: 0.12 }],
  },
  board: {
    // 立て看板（木の板がばたばた倒れる）
    layers: [0, 0.11, 0.19].flatMap((t, k) => [
      { at: t, src: 'modal', freq: 330 + k * 40, modes: [[1, 0.08, 1], [2.6, 0.05, 0.5], [4.4, 0.03, 0.3]], amp: { a: 0.0005, h: 0.06, d: 0.06 }, gain: -2 - k * 3 },
      { at: t, src: 'noise', filter: { type: 'bp', freq: 1300, q: 1.2 }, amp: { a: 0.0004, d: 0.035 }, gain: -6 - k * 3 },
    ]),
    fx: [HP(160), { type: 'reverb', size: 0.5, decay: 0.6, mix: 0.1 }],
  },
  nobori: { preset: 'swish', length: 1.4 },
  guardrail: {
    // ガードレール（ぐしゃっと曲がる金属）
    layers: [
      { src: 'noise', filter: { type: 'bp', freq: [[0, 5000], [0.3, 1200, 'exp']], q: 0.8 }, amp: { a: 0.0005, h: 0.02, d: 0.35 }, drive: 8, gain: -2 },
      { src: 'modal', freq: 410, modes: [[1, 0.7, 1], [2.13, 0.5, 0.7], [3.4, 0.35, 0.5], [5.6, 0.2, 0.3]], amp: { a: 0.0008, h: 0.3, d: 0.5 }, gain: -3 },
      { at: 0.06, src: 'modal', freq: 655, modes: [[1, 0.45, 1], [2.7, 0.3, 0.5]], amp: { a: 0.001, h: 0.2, d: 0.3 }, gain: -8 },
      { src: 'metal', freq: 310, filter: { type: 'hp', freq: 2500 }, amp: { d: 0.6 }, gain: -10 },
      { at: 0.08, src: 'crackle', density: 60, filter: { type: 'bp', freq: 3500, q: 1 }, len: 0.4, amp: [[0, 1], [0.4, 0]], gain: -12 },
      { src: 'sine', freq: [[0, 170], [0.08, 90, 'exp']], amp: { a: 0.001, d: 0.12 }, gain: -12 },
    ],
    fx: [HP(170), { type: 'reverb', size: 1, decay: 1.2, mix: 0.15 }],
  },
  car: { preset: 'dokaan', fx: [HP(140), SHELF(-6, 220)], loudCap: -12 },
  glass: { preset: 'glass', pitch: 2 },
  wall: { preset: 'punch', fx: [HP(130), SHELF(-4, 200)] },
  splash: {
    layers: [
      { src: 'noise', width: 0.8, filter: { type: 'lp', freq: [[0, 7000], [0.5, 900, 'exp']] }, amp: { a: 0.002, h: 0.05, d: 0.6 }, gain: -2 },
      { src: 'noise', width: 0.6, filter: { type: 'bp', freq: 1800, q: 1.5 }, amp: { a: 0.001, d: 0.25 }, gain: -6 },
      ...[0.12, 0.2, 0.31, 0.38, 0.5, 0.62].map((t, k) => ({ at: t, src: 'sine', freq: [[0, 900 + k * 230], [0.04, 1700 + k * 260, 'exp']], amp: { a: 0.002, d: 0.04 }, gain: -14 - k })),
    ],
    fx: [HP(200), { type: 'reverb', size: 0.9, decay: 1, mix: 0.15 }],
  },
  fall: { preset: 'zuko', fx: [HP(160)] }, // 乗客転倒
  reset: { preset: 'warp', length: 0.7 },
  horn: {
    // バスのクラクション（2 音の和音）
    layers: [349.2, 440].map((f, k) => ({ src: 'saw', voices: 2, detune: 6, freq: f, filter: { type: 'lp', freq: 2400, q: 0.8 }, amp: [[0, 0], [0.02, 1], [0.48, 0.9], [0.56, 0]], drive: 4, gain: -4 - k })),
    fx: [HP(200), { type: 'reverb', size: 0.7, decay: 0.8, mix: 0.12 }],
  },
  honk: {
    // 乗用車のクラクション（プップー）
    layers: [[0, 0.11], [0.17, 0.3]].flatMap(([t, d]) => [440, 554.4].map((f) => ({ at: t, src: 'square', freq: f, filter: { type: 'lp', freq: 3000 }, amp: [[0, 0], [0.008, 1], [d - 0.02, 0.85], [d, 0]], gain: -8 }))),
    fx: [HP(250), { type: 'reverb', size: 0.6, decay: 0.6, mix: 0.15 }],
  },

  // ---- 時間・演出 ----
  tick: {
    layers: [
      { src: 'noise', filter: { type: 'bp', freq: 3400, q: 5 }, amp: { a: 0.0002, d: 0.012 } },
      { src: 'sine', freq: 1900, amp: { a: 0.0002, d: 0.01 }, gain: -8 },
    ],
    fx: [{ type: 'reverb', size: 0.4, decay: 0.4, mix: 0.1 }],
  },
  alarm: { preset: 'alarm', length: 0.7 },
  drumroll: { preset: 'drumroll', length: 1.3, fx: [HP(150)] },
  rank: { preset: 'jajan', fx: [HP(150), SHELF(-3)] },
  rank_s: { preset: 'levelup' },
  applause: { preset: 'applause', length: 1.6 },
  record: { preset: 'tettere' },
  achievement: { preset: 'hirameki' },
  shutter: { preset: 'shutter' },

  // ---- ピタ止め・コンボ・ハプニング ----
  pita: {
    // ピタッ！（短いクリック＋明るいベル）
    layers: [
      { src: 'noise', filter: { type: 'bp', freq: 4200, q: 3 }, amp: { a: 0.0003, d: 0.02 }, gain: -6 },
      { at: 0.03, src: 'modal', freq: 1568, modes: [[1, 0.5, 1], [2.76, 0.2, 0.3], [5.4, 0.1, 0.12]], amp: { a: 0.001, h: 0.35, d: 0.3 }, gain: -3 },
      { at: 0.1, src: 'modal', freq: 2093, modes: [[1, 0.7, 1], [2.76, 0.25, 0.3], [5.4, 0.12, 0.12]], amp: { a: 0.001, h: 0.5, d: 0.4 }, gain: -2 },
    ],
    fx: [HP(400), { type: 'delay', time: 0.08, feedback: 0.25, mix: 0.12 }, { type: 'reverb', size: 0.6, decay: 0.9, mix: 0.15 }],
  },
  combo: { preset: 'pirorin', fx: [HP(250)] }, // 定時コンボ・ライバルに勝った
  tip: { preset: 'chiin', fx: [HP(220)] }, // チップ（レジのチーン）
  rival: { preset: 'deden', fx: [HP(200), SHELF(-5, 250)] }, // ライバル出現
};

/** 踏切の警報音 1 打（カーン） */
const bellHit = (at, freq, gain) => [
  { at, src: 'modal', freq, modes: [[1, 0.32, 1], [2.32, 0.2, 0.55], [3.9, 0.12, 0.35], [5.85, 0.07, 0.2]], amp: { a: 0.0006, h: 0.2, d: 0.25 }, gain },
  { at, src: 'noise', filter: { type: 'bp', freq: freq * 3.2, q: 2 }, amp: { a: 0.0003, d: 0.015 }, gain: gain - 10 },
];

/** 繰り返し再生するループ音（WAV で書き出し、継ぎ目はクロスフェードで処理） */
export const LOOPS = {
  crossing: {
    // カン、カン、カン…（1 秒に 2 打。少し音程の違う 2 つの鐘を交互に）
    loopSec: 1.0,
    def: {
      length: 1.4,
      normalize: -4,
      layers: [...bellHit(0, 880, -2), ...bellHit(0.5, 830, -3)],
      fx: [HP(450), { type: 'reverb', size: 0.5, decay: 0.5, mix: 0.1 }],
      fadeOut: 0,
    },
  },
  train: {
    // 電車の通過音（ゴーッという走行音と、タタン・タタンというレールの継ぎ目）
    loopSec: 1.6,
    def: {
      length: 2.0,
      normalize: -5,
      layers: [
        { src: 'noise', width: 0.6, len: 2.0, filter: { type: 'bp', freq: 520, q: 0.7 }, amp: [[0, 1], [2.0, 1]], gain: -6 },
        { src: 'noise', width: 0.5, len: 2.0, filter: { type: 'bp', freq: 1700, q: 1 }, amp: [[0, 1], [2.0, 1]], gain: -16 },
        ...[0, 0.13, 0.8, 0.93].flatMap((t, k) => [
          { at: t, src: 'noise', filter: { type: 'bp', freq: 1100, q: 1.6 }, amp: { a: 0.0005, d: 0.05 }, gain: -3 - (k % 2) * 2 },
          { at: t, src: 'sine', freq: [[0, 260], [0.04, 180, 'exp']], amp: { a: 0.001, d: 0.05 }, gain: -12 },
        ]),
        { src: 'sine', freq: 2400, len: 2.0, vibrato: { rate: 3, depth: 0.4 }, amp: [[0, 1], [2.0, 1]], gain: -32 },
      ],
      fx: [HP(160), SHELF(-6, 220), { type: 'eq', bands: [{ type: 'peak', freq: 900, gain: 3, q: 0.8 }] }],
      fadeOut: 0,
    },
  },
  engine: {
    loopSec: 2.0, // 55Hz × 2 秒 = 110 周期でちょうど一周
    def: {
      length: 2.4,
      normalize: -3,
      layers: [
        { src: 'saw', voices: 2, detune: 4, freq: 55, len: 2.4, filter: { type: 'lp', freq: 1100, q: 1.2 }, amp: [[0, 1], [2.4, 1]], drive: 5 },
        { src: 'square', freq: 110, len: 2.4, filter: { type: 'lp', freq: 700 }, amp: [[0, 1], [2.4, 1]], gain: -9 },
        { src: 'noise', len: 2.4, filter: { type: 'bp', freq: 900, q: 0.8 }, amp: [[0, 1], [2.4, 1]], gain: -20 },
      ],
      fx: [HP(130), { type: 'eq', bands: [{ type: 'peak', freq: 520, gain: 5, q: 0.9 }, { type: 'peak', freq: 1100, gain: 3, q: 1 }] }, { type: 'tremolo', rate: 27.5, depth: 0.35 }],
      fadeOut: 0,
    },
  },
  skid: {
    loopSec: 1.0,
    def: {
      length: 1.3,
      normalize: -4,
      layers: [
        { src: 'sine', freq: 1350, len: 1.3, vibrato: { rate: 11, depth: 0.5 }, amp: [[0, 1], [1.3, 1]], gain: -6 },
        { src: 'noise', len: 1.3, filter: { type: 'bp', freq: 2600, q: 2.5 }, amp: [[0, 1], [1.3, 1]], gain: -4 },
        { src: 'noise', len: 1.3, filter: { type: 'bp', freq: 900, q: 1.2 }, amp: [[0, 1], [1.3, 1]], gain: -14 },
      ],
      fx: [HP(400)],
      fadeOut: 0,
    },
  },
};
