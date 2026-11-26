// 「かなでる」（https://github.com/cadmium2525/mp4mp3 の daw/）の曲 JSON を組み立てる。
// 低音を出しすぎない方針：ベースは倍音の多い音色、各トラックと全体に低域カット・ローシェルフをかける。
// 時間の単位は拍（4 分音符 = 1）。

const N = (t, n, d, v = 0.75) => [t, n, d, v];

/** 全体の仕上げ（低域を整理してから軽く圧縮） */
const MASTER_FX = [
  { type: 'eq', bands: [{ type: 'hp', freq: 42, slope: 24 }, { type: 'lowshelf', freq: 140, gain: -3 }, { type: 'peak', freq: 2800, gain: 1, q: 0.8 }] },
  { type: 'comp', threshold: -18, ratio: 2, attack: 0.02, release: 0.2, knee: 8, makeup: 0 },
];
/** ベース用：ブーミーな帯域を抑え、スマホでも聞こえる倍音を少し足す */
const BASS_FX = [
  { type: 'eq', bands: [{ type: 'hp', freq: 50, slope: 24 }, { type: 'peak', freq: 95, gain: -3, q: 1 }, { type: 'peak', freq: 900, gain: 2.5, q: 1 }] },
  { type: 'dist', drive: 4, kind: 'tape', mix: 0.25 },
];
const KICK_TUNE = { kick: { tone: 0.35, length: 0.8 } };
const HP = (f) => ({ type: 'eq', bands: [{ type: 'hp', freq: f }] });

/* =========================================================================
 * タイトル「限界バス運行！のテーマ」 F メジャー・136 BPM・16 小節ループ
 * ========================================================================= */
const titleChords = [
  [0, 'Fmaj7'], [4, 'Em7'], [6, 'A7'], [8, 'Dm7'], [12, 'Cm7'], [14, 'F7'],
  [16, 'Bbmaj7'], [20, 'Am7'], [22, 'D7'], [24, 'Gm7'], [28, 'C7sus4'], [30, 'C7'],
  [32, 'Bbmaj7'], [36, 'C/Bb'], [40, 'Am7'], [44, 'Dm7'], [48, 'Gm7'], [52, 'C/E'], [56, 'F/A'], [58, 'Bb'], [60, 'C7'],
];
export const THEME_MELODY = [
  // A
  N(0, 'C5', 0.5), N(0.5, 'A4', 0.5), N(1, 'C5', 0.5), N(1.5, 'F5', 1, 0.85), N(2.5, 'E5', 0.5), N(3, 'F5', 0.5), N(3.5, 'G5', 0.5),
  N(4, 'A5', 1, 0.85), N(5, 'G5', 0.5), N(5.5, 'E5', 1), N(6.5, 'C#5', 0.5), N(7, 'E5', 1),
  N(8, 'D5', 0.5), N(8.5, 'F5', 0.5), N(9, 'A5', 0.5), N(9.5, 'C6', 1, 0.9), N(10.5, 'A5', 0.5), N(11, 'F5', 1),
  N(12, 'Eb5', 0.5), N(12.5, 'D5', 0.5), N(13, 'C5', 0.5), N(13.5, 'Bb4', 0.5), N(14, 'A4', 1), N(15, 'C5', 1),
  N(16, 'D5', 1.5, 0.85), N(17.5, 'F5', 0.5), N(18, 'A5', 1), N(19, 'G5', 0.5), N(19.5, 'F5', 0.5),
  N(20, 'E5', 1), N(21, 'C5', 0.5), N(21.5, 'A4', 1), N(22.5, 'F#5', 0.5), N(23, 'A5', 1),
  N(24, 'G5', 0.5), N(24.5, 'A5', 0.5), N(25, 'Bb5', 1, 0.85), N(26, 'A5', 0.5), N(26.5, 'G5', 0.5), N(27, 'F5', 1),
  N(28, 'G5', 1.5), N(29.5, 'F5', 0.5), N(30, 'E5', 1), N(31, 'C5', 0.5), N(31.5, 'E5', 0.5),
  // B（サビ）
  N(32, 'F5', 0.5), N(32.5, 'A5', 0.5), N(33, 'C6', 1.5, 0.9), N(34.5, 'Bb5', 0.5), N(35, 'A5', 1),
  N(36, 'G5', 0.5), N(36.5, 'E5', 0.5), N(37, 'C5', 1), N(38, 'E5', 0.5), N(38.5, 'G5', 0.5), N(39, 'Bb5', 1),
  N(40, 'A5', 1.5, 0.85), N(41.5, 'G5', 0.5), N(42, 'E5', 1), N(43, 'C5', 1),
  N(44, 'D5', 0.5), N(44.5, 'E5', 0.5), N(45, 'F5', 0.5), N(45.5, 'A5', 0.5), N(46, 'D6', 1.5, 0.9), N(47.5, 'C6', 0.5),
  N(48, 'Bb5', 1), N(49, 'A5', 0.5), N(49.5, 'G5', 1), N(50.5, 'F5', 0.5), N(51, 'D5', 1),
  N(52, 'E5', 0.5), N(52.5, 'G5', 0.5), N(53, 'C6', 1, 0.85), N(54, 'Bb5', 0.5), N(54.5, 'G5', 0.5), N(55, 'E5', 1),
  N(56, 'F5', 1), N(57, 'A5', 0.5), N(57.5, 'C6', 0.5), N(58, 'D6', 1, 0.9), N(59, 'C6', 1),
  N(60, 'Bb5', 0.5), N(60.5, 'A5', 0.5), N(61, 'G5', 0.5), N(61.5, 'E5', 0.5), N(62, 'C5', 0.5), N(62.5, 'D5', 0.5), N(63, 'E5', 0.5), N(63.5, 'G5', 0.5),
];

export const title = {
  name: 'Genkai Bus Theme',
  bpm: 136,
  sig: [4, 4],
  bars: 16,
  key: 'F major',
  tail: 3,
  loop: true,
  chords: titleChords,
  sends: { reverb: { size: 1.1, decay: 1.8, damp: 6500 }, delay: { time: '1/8d', feedback: 0.28 } },
  master: { loudness: -16, ceiling: -1, fx: MASTER_FX },
  tracks: [
    { id: 'lead', name: 'ブラス（主旋律）', inst: 'brass', volume: 0, pan: 0.05, humanize: { time: 0.004, vel: 0.05 }, sends: { reverb: 0.16, delay: 0.06 }, fx: [HP(180)], clips: [{ at: 0, notes: THEME_MELODY }] },
    { id: 'glock', name: 'グロッケン（重ね）', inst: 'glock', volume: -9, pan: -0.2, transpose: 12, sends: { reverb: 0.25 }, clips: [{ at: 0, notes: THEME_MELODY.filter((n) => n[0] >= 32) }] },
    { id: 'clav', name: 'クラビネット', inst: 'clavinet', volume: -4, pan: -0.3, sends: { reverb: 0.1 }, fx: [HP(150)], clips: [{ at: 0, len: 64, gen: { type: 'chords', style: 'funk', register: 62, vel: 0.6, seed: 3 } }] },
    { id: 'organ', name: 'オルガン', inst: 'organ', volume: -11, pan: 0.3, fx: [HP(200)], clips: [{ at: 0, len: 64, gen: { type: 'chords', style: 'pad', register: 64, maxNotes: 3, vel: 0.45, seed: 2 } }] },
    { id: 'bass', name: 'ベース', inst: 'ebass', volume: -4, fx: BASS_FX, humanize: { time: 0.004, vel: 0.05 }, clips: [{ at: 0, len: 64, gen: { type: 'bass', style: 'funk', seed: 5 } }] },
    { id: 'drums', name: 'ドラム', kit: 'acoustic', type: 'drums', volume: -1, tune: KICK_TUNE, sends: { reverb: 0.06 }, humanize: { time: 0.003 }, clips: [{ at: 0, len: 64, gen: { type: 'drums', style: 'funk', intensity: 0.75, fill: 8, seed: 4 } }] },
    { id: 'perc', name: 'パーカッション', kit: 'acoustic', type: 'drums', volume: -9, pan: 0.25, clips: [{ at: 0, len: 4, repeat: 16, grid: { tamb: '....x.......x...', shaker: 'x.o.x.o.x.o.x.ox' } }] },
    { id: 'hit', name: 'オーケストラヒット', inst: 'orchhit', volume: -6, fx: [HP(160)], sends: { reverb: 0.2 }, clips: [{ at: 0, notes: [N(0, ['F4', 'A4', 'C5'], 0.5, 0.8), N(32, ['Bb4', 'D5', 'F5'], 0.5, 0.75)] }] },
  ],
};

/* =========================================================================
 * 走行中「定刻運行」 D メジャー・124 BPM・32 小節ループ
 * base（通常）と rush（遅延時に重ねる層）を同じ尺・同じ和音で作る
 * ========================================================================= */
const bar = (b) => (b - 1) * 4;
const driveChordsByBar = [
  'D', 'Bm7', 'G', 'A', 'D', 'Bm7', 'Em7', 'A7', 'Gmaj7', 'F#m7', 'Em7', 'A', 'Gmaj7', ['F#m7', 'B7'], 'Em7', ['A7sus4', 'A7'],
  'Gmaj7', 'A', 'F#m7', 'Bm7', 'Gmaj7', 'A', 'D', 'D7', 'Gmaj7', 'A/G', 'F#m7', 'Bm7', 'Em7', 'A', 'D', 'A7',
];
const driveChords = [];
driveChordsByBar.forEach((c, i) => {
  if (Array.isArray(c)) {
    driveChords.push([bar(i + 1), c[0]], [bar(i + 1) + 2, c[1]]);
  } else driveChords.push([bar(i + 1), c]);
});

export const DRIVE_MELODY = [
  // B セクション（17〜32 小節）の口笛メロディ
  N(64, 'B4', 1), N(65, 'D5', 0.5), N(65.5, 'F#5', 1.5, 0.85), N(67, 'E5', 0.5), N(67.5, 'D5', 0.5),
  N(68, 'C#5', 1), N(69, 'E5', 0.5), N(69.5, 'A5', 1.5, 0.85), N(71, 'G5', 0.5), N(71.5, 'F#5', 0.5),
  N(72, 'F#5', 1.5), N(73.5, 'E5', 0.5), N(74, 'C#5', 1), N(75, 'A4', 1),
  N(76, 'B4', 1), N(77, 'D5', 1), N(78, 'F#5', 1), N(79, 'E5', 1),
  N(80, 'B4', 1), N(81, 'D5', 0.5), N(81.5, 'G5', 1.5, 0.85), N(83, 'F#5', 0.5), N(83.5, 'E5', 0.5),
  N(84, 'E5', 1), N(85, 'F#5', 0.5), N(85.5, 'A5', 1), N(86.5, 'G5', 0.5), N(87, 'E5', 1),
  N(88, 'F#5', 2, 0.85), N(90, 'A5', 1), N(91, 'F#5', 1),
  N(92, 'D5', 1), N(93, 'F#5', 0.5), N(93.5, 'A5', 0.5), N(94, 'C6', 1.5, 0.9), N(95.5, 'B5', 0.5),
  N(96, 'B5', 1.5, 0.9), N(97.5, 'A5', 0.5), N(98, 'G5', 1), N(99, 'F#5', 1),
  N(100, 'E5', 1), N(101, 'G5', 0.5), N(101.5, 'A5', 1.5), N(103, 'C#6', 1, 0.85),
  N(104, 'C#6', 1), N(105, 'A5', 0.5), N(105.5, 'F#5', 1.5), N(107, 'E5', 1),
  N(108, 'D5', 1), N(109, 'F#5', 1), N(110, 'B5', 1.5, 0.85), N(111.5, 'A5', 0.5),
  N(112, 'G5', 1), N(113, 'F#5', 0.5), N(113.5, 'E5', 1.5), N(115, 'B4', 1),
  N(116, 'C#5', 1), N(117, 'E5', 0.5), N(117.5, 'A5', 1.5, 0.85), N(119, 'G5', 1),
  N(120, 'F#5', 3, 0.85), N(123, 'A4', 1),
  N(124, 'E5', 1), N(125, 'C#5', 1), N(126, 'A4', 1), N(127, 'G5', 1),
];
// A セクションの軽い合いの手（ビブラフォン）
const DRIVE_A_MOTIF = [];
for (const base of [0, 32]) {
  DRIVE_A_MOTIF.push(
    N(base + 2.5, 'F#5', 0.5, 0.6), N(base + 3, 'A5', 0.5, 0.65), N(base + 3.5, 'D6', 0.5, 0.7),
    N(base + 10.5, 'D5', 0.5, 0.6), N(base + 11, 'F#5', 0.5, 0.65), N(base + 11.5, 'A5', 0.5, 0.7),
    N(base + 18.5, 'B5', 0.5, 0.6), N(base + 19, 'D6', 0.5, 0.65), N(base + 19.5, 'G6', 1, 0.7),
    N(base + 26.5, 'E5', 0.5, 0.6), N(base + 27, 'G5', 0.5, 0.65), N(base + 27.5, 'C#6', 0.5, 0.7),
  );
}

const driveCommon = {
  bpm: 124,
  sig: [4, 4],
  bars: 32,
  key: 'D major',
  tail: 3,
  loop: true,
  chords: driveChords,
  sends: { reverb: { size: 1.0, decay: 1.6, damp: 6500 }, delay: { time: '1/8d', feedback: 0.25 } },
};

// 遅延時の層と足し合わせるので、両方とも同じ仕上げ（ラウドネス合わせは build 側で共通の倍率）
const LAYER_MASTER = { loudness: null, volume: -8, ceiling: 0, fx: [MASTER_FX[0]] };

export const driveBase = {
  ...driveCommon,
  name: 'Teikoku Unko (base)',
  master: LAYER_MASTER,
  tracks: [
    { id: 'keys', name: 'エレピ', inst: 'epiano', volume: -4, pan: -0.15, sends: { reverb: 0.14 }, fx: [HP(160)], humanize: { time: 0.006, vel: 0.05 }, clips: [{ at: 0, len: 128, gen: { type: 'chords', style: 'piano8', register: 62, vel: 0.5, seed: 11 } }] },
    { id: 'gtr', name: 'カッティング', inst: 'guitar', volume: -10, pan: 0.35, fx: [HP(250)], clips: [{ at: 0, len: 128, gen: { type: 'chords', style: 'offbeat', register: 64, maxNotes: 3, vel: 0.55, seed: 12 } }] },
    { id: 'vib', name: 'ビブラフォン', inst: 'vibraphone', volume: -6, pan: 0.2, sends: { reverb: 0.22, delay: 0.12 }, clips: [{ at: 0, notes: DRIVE_A_MOTIF }] },
    { id: 'whistle', name: '口笛', inst: 'whistle', volume: -3, pan: -0.05, sends: { reverb: 0.2, delay: 0.08 }, humanize: { time: 0.004 }, clips: [{ at: 0, notes: DRIVE_MELODY }] },
    { id: 'bass', name: 'ベース', inst: 'pluckbass', volume: -5, fx: BASS_FX, clips: [{ at: 0, len: 128, gen: { type: 'bass', style: 'root8', seed: 13 } }] },
    { id: 'drums', name: 'ドラム', kit: 'acoustic', type: 'drums', volume: -2, tune: KICK_TUNE, sends: { reverb: 0.05 }, humanize: { time: 0.003 }, clips: [{ at: 0, len: 128, gen: { type: 'drums', style: 'pop', intensity: 0.55, fill: 8, seed: 14 } }] },
  ],
};

const rushHats = [];
for (let b = 1; b <= 32; b++) {
  rushHats.push({
    at: bar(b),
    len: 4,
    grid: {
      hat: 'xgxgxgxgxgxgxgxg',
      tamb: '....x.......x...',
      crash: (b - 1) % 4 === 0 ? 'X...............' : '................',
      tom1: b % 4 === 0 ? '........x.x.....' : '................',
      tom2: b % 4 === 0 ? '............x.x.' : '................',
      clap: b % 2 === 0 ? '....x.......x.x.' : '....x.......x...',
    },
  });
}

export const driveRush = {
  ...driveCommon,
  name: 'Teikoku Unko (rush layer)',
  master: LAYER_MASTER,
  tracks: [
    { id: 'spic', name: '刻む弦', inst: 'spiccato', volume: -5, pan: -0.25, fx: [HP(180)], sends: { reverb: 0.12 }, clips: [{ at: 0, len: 128, gen: { type: 'chords', style: 'piano8', register: 60, maxNotes: 3, vel: 0.7, seed: 21 } }] },
    { id: 'arp', name: 'シンセアルペジオ', inst: 'pluck', volume: -9, pan: 0.3, sends: { delay: 0.15 }, fx: [HP(300)], clips: [{ at: 0, len: 128, gen: { type: 'arp', pattern: 'updown', rate: '1/16', octaves: 2, register: 72, seed: 22 } }] },
    { id: 'stab', name: 'ブラスのスタブ', inst: 'synthbrass', volume: -7, fx: [HP(200)], sends: { reverb: 0.12 }, clips: [{ at: 0, len: 64, gen: { type: 'chords', style: 'stab', register: 64, vel: 0.65, seed: 23 } }] },
    { id: 'brass', name: 'ブラス（旋律の重ね）', inst: 'brass', volume: -6, transpose: -12, fx: [HP(200)], sends: { reverb: 0.12 }, clips: [{ at: 0, notes: DRIVE_MELODY }] },
    { id: 'perc', name: '追加のパーカッション', kit: 'rock', type: 'drums', volume: -6, sends: { reverb: 0.05 }, clips: rushHats },
  ],
};

/* =========================================================================
 * リザルト「おつかれさま」 F メジャー・84 BPM・8 小節ループ（テーマの和音をゆったり）
 * ========================================================================= */
export const result = {
  name: 'Otsukaresama',
  bpm: 84,
  sig: [4, 4],
  bars: 8,
  key: 'F major',
  tail: 3,
  loop: true,
  chords: titleChords.filter(([t]) => t < 32),
  sends: { reverb: { size: 1.3, decay: 2.2, damp: 5500 } },
  master: { loudness: -18, ceiling: -1, fx: MASTER_FX },
  tracks: [
    { id: 'keys', name: 'エレピ', inst: 'epiano', volume: -3, sends: { reverb: 0.25 }, fx: [HP(140), { type: 'lofi', wow: 0.4, noise: 0.15, crackle: 0.2, tone: 6500, mix: 0.6 }], clips: [{ at: 0, len: 32, gen: { type: 'chords', style: 'lazy', tensions: true, register: 60, swing: 0.15, vel: 0.55, seed: 31 } }] },
    { id: 'vib', name: 'ビブラフォン（テーマ）', inst: 'vibraphone', volume: -5, sends: { reverb: 0.3, delay: 0.1 }, clips: [{ at: 0, notes: THEME_MELODY.filter((n) => n[0] < 32).map(([t, n, d, v]) => [t, n, d, v * 0.8]) }] },
    { id: 'bass', name: 'ベース', inst: 'ebass', volume: -7, fx: BASS_FX, clips: [{ at: 0, len: 32, gen: { type: 'bass', style: 'root', seed: 32 } }] },
    { id: 'drums', name: 'ドラム', kit: 'lofi', type: 'drums', volume: -6, tune: KICK_TUNE, clips: [{ at: 0, len: 32, gen: { type: 'drums', style: 'lofi', intensity: 0.45, seed: 33 } }] },
  ],
};

/* =========================================================================
 * ジングル
 * ========================================================================= */
export const jingleClear = {
  name: 'Clear Fanfare',
  bpm: 132,
  sig: [4, 4],
  bars: 3,
  key: 'F major',
  tail: 2.5,
  sends: { reverb: { size: 1.4, decay: 2.2 } },
  master: { loudness: -15, ceiling: -1, fx: MASTER_FX },
  tracks: [
    { id: 'brass', name: 'ブラス', inst: 'brass', volume: 0, fx: [HP(160)], sends: { reverb: 0.2 }, clips: [{ at: 0, notes: [
      N(0, 'C5', 0.33, 0.8), N(0.33, 'C5', 0.33, 0.75), N(0.67, 'C5', 0.33, 0.8), N(1, 'F5', 1, 0.9),
      N(2, 'C5', 0.5, 0.75), N(2.5, 'F5', 0.5, 0.8), N(3, 'A5', 1, 0.85), N(4, 'G5', 0.5, 0.8), N(4.5, 'A5', 0.5, 0.8), N(5, 'Bb5', 1, 0.85),
      N(6, 'A5', 0.5, 0.8), N(6.5, 'Bb5', 0.5, 0.82), N(7, 'B5', 0.5, 0.85), N(7.5, 'C6', 4, 1),
    ] }] },
    { id: 'pad', name: 'ブラス和音', inst: 'synthbrass', volume: -6, fx: [HP(200)], sends: { reverb: 0.25 }, clips: [{ at: 0, notes: [
      N(0, ['A4', 'C5', 'F5'], 1.9, 0.6), N(2, ['A4', 'C5', 'F5'], 2, 0.6), N(4, ['Bb4', 'D5', 'G5'], 2, 0.6), N(6, ['C5', 'E5', 'G5'], 1.4, 0.65), N(7.5, ['C5', 'F5', 'A5'], 4, 0.75),
    ] }] },
    { id: 'bass', name: 'ベース', inst: 'ebass', volume: -6, fx: BASS_FX, clips: [{ at: 0, notes: [N(0, 'F2', 2), N(2, 'F2', 2), N(4, 'G2', 2), N(6, 'C3', 1.4), N(7.5, 'F2', 4)] }] },
    { id: 'drums', name: 'ドラム', kit: 'acoustic', type: 'drums', volume: -2, tune: KICK_TUNE, clips: [{ at: 0, len: 12, grid: { kick: 'x...x...x...x...|x...x...x...x...|x...............', snare: 'xxx.x...x.x.x...|x...x...x...xxxx|x...............', crash: 'X...............|................|X...............' } }] },
    { id: 'glock', name: 'グロッケン', inst: 'glock', volume: -8, clips: [{ at: 0, notes: [N(7.5, 'F6', 1, 0.7), N(8, 'A6', 1, 0.6), N(8.5, 'C7', 2, 0.6)] }] },
  ],
};

export const jingleTimeout = {
  name: 'Timeout',
  bpm: 96,
  sig: [4, 4],
  bars: 2,
  key: 'F major',
  tail: 2,
  sends: { reverb: { size: 1, decay: 1.6 } },
  master: { loudness: -16, ceiling: -1, fx: MASTER_FX },
  tracks: [
    { id: 'tb', name: 'トロンボーン', inst: { preset: 'trombone', vibrato: { rate: 5.5, depth: 0.25 } }, volume: 0, fx: [HP(120), { type: 'eq', bands: [{ type: 'peak', freq: 1200, gain: 3, q: 1 }] }], sends: { reverb: 0.2 }, clips: [{ at: 0, notes: [N(0, 'C4', 0.9, 0.8), N(1, 'B3', 0.9, 0.75), N(2, 'Bb3', 0.9, 0.75), N(3, 'A3', 3.5, 0.8)] }] },
    { id: 'drums', name: 'ドラム', kit: 'acoustic', type: 'drums', volume: -6, clips: [{ at: 0, len: 8, grid: { tom2: '................|x...............', crash: '................|o...............' } }] },
  ],
};
