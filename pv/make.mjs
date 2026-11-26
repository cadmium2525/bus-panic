// PV（X 用・16:9・約30秒）の「つなぐ」プロジェクト JSON を作る
//   node pv/make.mjs   → pv/build/pv.json（素材は pv/build/media）
// 曲はゲームのテーマ曲を PV 用に編曲（かなでるの曲 JSON をそのまま audios に入れる）。
// カットは曲の小節の頭にそろえ、効果音は撮影時に鳴った時刻（media/<shot>.json）に合わせる。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { title as themeSong } from '../audio-src/songs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(here, 'build', 'media');
const AUDIO = path.join(here, '..', 'public', 'audio');
const log = (shot) => JSON.parse(readFileSync(path.join(MEDIA, `${shot}.json`), 'utf8'));
const first = (shot, key) => (log(shot).find((e) => e.key === key) || {}).t;

const BPM = themeSong.bpm;
const BAR = (60 / BPM) * 4;

// ---- カット割り（曲の小節にそろえる）----
const crashHit = first('crash', 'car') ?? 1.2; // 車にぶつかる瞬間 = 曲の頭
const PRE = Math.max(0.9, crashHit - 0.15); // 衝突までの助走（映像の in を調整）
const m0 = PRE; // 曲の始まる時刻（動画の中の秒）
const cutAt = (bars) => m0 + bars * BAR;

const scenes = [];
const scene = (shot, inSec, start, end, extra = {}) => scenes.push({ shot, in: Math.max(0, inSec), start, end, ...extra });
scene('crash', crashHit - PRE, 0, cutAt(1));
const stopIn = (first('stop', 'ontime') ?? 3) - 0.9;
scene('stop', stopIn, cutAt(1), cutAt(3));
scene('leave', 0.1, cutAt(3), cutAt(5));
scene('alley', 0.2, cutAt(5), cutAt(7));
const railIn = (first('river', 'guardrail') ?? 1) - 0.6;
scene('river', railIn, cutAt(7), cutAt(9));
scene('drift', 0.15, cutAt(9), cutAt(11));
scene('result', 0.35, cutAt(11), cutAt(13));
scene('ending', 0.2, cutAt(13), cutAt(16) + 2.4);
const END = cutAt(16) + 2.4;

// ---- 素材 ----
const media = {};
for (const s of scenes) media[s.shot] = { name: `${s.shot}.mp4` };
const SFX_KEYS = ['car', 'glass', 'cone', 'pot', 'sign', 'board', 'nobori', 'guardrail', 'splash', 'coin', 'ontime', 'door', 'leave', 'wall', 'fall', 'drumroll', 'rank', 'late'];
for (const k of SFX_KEYS) {
  const src = path.join(AUDIO, `sfx_${k}.mp3`);
  if (existsSync(src)) {
    copyFileSync(src, path.join(MEDIA, `sfx_${k}.mp3`));
    media['sfx_' + k] = { name: `sfx_${k}.mp3` };
  }
}

const ZOOM = {};
// 撮影した長さ（capture.cjs の sec）。足りないカットはゆっくり再生して尺を合わせる
const SHOT_LEN = { crash: 3.6, stop: 8.5, leave: 4, alley: 4.2, river: 3.8, drift: 3.8, result: 5.6, ending: 6 };
const clips = scenes.map((s, i) => {
  const dur = s.end - s.start;
  const speed = Math.min(1, (SHOT_LEN[s.shot] - s.in - 0.05) / dur);
  return {
  media: s.shot,
  in: +s.in.toFixed(3),
  out: +(s.in + dur * speed).toFixed(3),
  ...(speed < 1 ? { speed: +speed.toFixed(4) } : {}),
  volume: 0,
  ...(ZOOM[s.shot] || {}),
  transition: { type: 'none' },
  };
});

// ---- 効果音（撮影時のタイミング）----
const VOL = { car: 0.9, glass: 0.5, coin: 0.32, ontime: 0.6, door: 0.35, leave: 0.55, wall: 0.45, fall: 0.5, drumroll: 0.6, rank: 0.8 };
const audios = [];
const seen = new Map();
for (const s of scenes) {
  for (const e of log(s.shot)) {
    if (!media['sfx_' + e.key]) continue;
    if (e.t < s.in || e.t > s.in + (s.end - s.start) - 0.15) continue;
    const at = +(s.start + (e.t - s.in)).toFixed(3);
    // 同じ音が近い時刻に重なりすぎないように間引く
    const last = seen.get(e.key);
    if (last != null && at - last < 0.12) continue;
    seen.set(e.key, at);
    audios.push({ media: 'sfx_' + e.key, start: at, volume: +((VOL[e.key] ?? 0.55) * Math.min(1, e.volume ?? 1)).toFixed(2), fadeOut: 0 });
  }
}

// 結果発表はドラムロールから
audios.push({ media: 'sfx_drumroll', start: +(sc_start('result') + 0.05).toFixed(3), volume: 0.6, fadeOut: 0 });
function sc_start(shot) {
  return scenes.find((s) => s.shot === shot).start;
}

// ---- 曲（テーマを PV 用に：16 小節＋締めの和音）----
const song = JSON.parse(JSON.stringify(themeSong));
song.name = 'Genkai Bus PV';
delete song.loop;
song.bars = 17;
song.tail = 2.5;
song.master = { ...song.master, loudness: -15 };
song.tracks.find((t) => t.id === 'hit').clips[0].notes.push([64, ['F4', 'A4', 'C5', 'F5'], 2, 0.9]);
song.tracks.find((t) => t.id === 'lead').clips[0].notes = song.tracks.find((t) => t.id === 'lead').clips[0].notes.filter((n) => n[0] < 62).concat([[62, 'C5', 0.5, 0.8], [62.5, 'E5', 0.5, 0.8], [63, 'G5', 1, 0.85], [64, 'F5', 2, 0.95]]);
song.chords = song.chords.concat([[64, 'F']]);
song.tracks.push({ id: 'end', name: '締め', kit: 'acoustic', type: 'drums', volume: -2, clips: [{ at: 64, len: 4, grid: { crash: 'X...............', kick: 'X...............', tom1: '................' } }] });
for (const t of song.tracks) for (const c of t.clips || []) if (c.gen && c.at + c.len >= 64) c.len = 64 - c.at;

audios.unshift(
  { song, start: +m0.toFixed(3), volume: 0.62, fadeIn: 0, fadeOut: 2 },
  { sfx: { preset: 'riser', length: m0 + 0.1, tone: 0.3, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 180 }] }] }, start: 0, volume: 0.35, fadeOut: 0.05 },
  { sfx: { preset: 'impact', punch: 0.8, fx: [{ type: 'eq', bands: [{ type: 'hp', freq: 140, slope: 24 }, { type: 'lowshelf', freq: 220, gain: -4 }] }] }, start: +m0.toFixed(3), volume: 0.5 },
);
// 場面転換のウーシュ（カットの少し前から）
for (const s of scenes.slice(1, -1)) audios.push({ sfx: { preset: 'swipe', tone: 0.4 }, start: +(s.start - 0.12).toFixed(3), volume: 0.28 });

// ---- 文字 ----
const T = (o) => o;
const texts = [];
const shapes = [];
const effects = [];
const tx = (text, start, end, o = {}) => texts.push(T({ text, start: +start.toFixed(3), end: +end.toFixed(3), ...o }));
const sc = scenes.reduce((m, s) => ((m[s.shot] = s), m), {});

// 1. つかみ
tx('安全運転で…', 0.05, m0, { style: 'telop', y: 0.78, size: 0.07, anim: 'fade' });
tx('いけるわけない！！', m0, sc.crash.end, { style: 'pop3d', y: 0.5, size: 0.13, anim: 'pop', rotation: -4, keys: [{ t: 0, scale: 1.6 }, { t: 0.18, scale: 1, ease: 'back' }, { t: 1.5, scale: 1.06 }] });
shapes.push({ kind: 'burst', start: m0, end: sc.crash.end, x: 0.5, y: 0.5, w: 0.95, h: 0.6, fill: '#ff3d2e', opacity: 0.9, anim: 'pop', loop: 'pulse' });
effects.push({ type: 'flash', start: m0 - 0.02, end: m0 + 0.35, intensity: 0.9 });
effects.push({ type: 'shake', start: m0, end: m0 + 0.6, intensity: 0.8 });

// 2. 停留所
tx('時刻表どおりに', sc.stop.start + 0.05, sc.stop.start + BAR, { style: 'label', x: 0.5, y: 0.16, size: 0.06, anim: 'slide' });
tx('客を乗せて 1人 ¥250', sc.stop.start + BAR * 0.5, sc.stop.end, { style: 'yellow', y: 0.83, size: 0.08, anim: 'pop' });

// 3. 遅延で客が帰る
tx('遅れると…', sc.leave.start + 0.05, sc.leave.start + BAR, { style: 'telop', y: 0.2, size: 0.075, anim: 'fade' });
tx('客が帰る。', sc.leave.start + BAR * 0.9, sc.leave.end, { style: 'pop', y: 0.5, size: 0.16, anim: 'pop', keys: [{ t: 0, scale: 0.4 }, { t: 0.25, scale: 1, ease: 'back' }] });

// 4. 路地の近道
tx('近道すれば間に合う！', sc.alley.start + 0.05, sc.alley.start + BAR, { style: 'label', y: 0.16, size: 0.06, anim: 'slide' });
tx('でも ぶつけたら罰金', sc.alley.start + BAR, sc.alley.end, { style: 'telop', y: 0.82, size: 0.085, color: '#ff6b5e', anim: 'pop' });

// 5. ガードレール → 川
tx('ガードレール −¥2,000', sc.river.start + 0.25, sc.river.start + BAR * 1.2, { style: 'double', y: 0.2, size: 0.08, color: '#ffffff', anim: 'pop' });
tx('ドボン', sc.river.start + BAR * 1.05, sc.river.end, { style: 'pop3d', y: 0.55, size: 0.17, anim: 'pop', rotation: 6, keys: [{ t: 0, y: 0.3, scale: 0.5 }, { t: 0.3, y: 0.55, scale: 1, ease: 'back' }] });
effects.push({ type: 'shake', start: sc.river.start + 0.5, end: sc.river.start + 1.1, intensity: 0.5 });

// 6. ドリフト
tx('バスで ドリフト', sc.drift.start + 0.05, sc.drift.start + BAR * 1.2, { style: 'neon', y: 0.2, size: 0.09, anim: 'pop' });
tx('乗客の悲鳴つき', sc.drift.start + BAR, sc.drift.end, { style: 'telop', y: 0.83, size: 0.075, anim: 'slide' });

// 7. 結果
tx('急げば儲かる、', sc.result.start + 0.1, sc.result.end, { style: 'telop', x: 0.5, y: 0.07, size: 0.065, anim: 'slide' });
tx('暴れれば赤字。', sc.result.start + BAR * 0.6, sc.result.end, { style: 'yellow', x: 0.5, y: 0.93, size: 0.07, anim: 'pop' });

// 8. エンディング
const e0 = sc.ending.start;
shapes.push({ kind: 'rect', start: e0, end: END, x: 0.5, y: 0.5, w: 2, h: 2, fill: '#0b1a12', opacity: 0.42, anim: 'fade' });
tx('ブラウザ3Dバカゲー', e0 + 0.15, END, { style: 'label', y: 0.2, size: 0.055, anim: 'fade' });
tx('限界バス運行！', e0 + 0.3, END, { style: 'gold', y: 0.4, size: 0.17, anim: 'pop', keys: [{ t: 0, scale: 1.8, opacity: 0 }, { t: 0.35, scale: 1, opacity: 1, ease: 'back' }] });
tx('〜遅延上等、罰金覚悟の路線バス〜', e0 + 0.8, END, { style: 'telop', y: 0.58, size: 0.055, anim: 'fade' });
tx('スマホでもPCでも 無料で今すぐ遊べる', e0 + 1.4, END, { style: 'yellow', y: 0.72, size: 0.065, anim: 'pop' });
tx('cadmium2525.github.io/bus-panic', e0 + 1.9, END, { style: 'telop', y: 0.86, size: 0.05, font: 'mono', anim: 'typewriter', typeSpeed: 26 });
effects.push({ type: 'sparkle', start: e0 + 0.3, end: END, intensity: 0.45 });
effects.push({ type: 'flash', start: e0 - 0.05, end: e0 + 0.3, intensity: 0.6 });

// 全体の仕上げ
effects.push({ type: 'vignette', start: 0, end: END, intensity: 0.35 });
effects.push({ type: 'grade', start: 0, end: END, intensity: 0.4, params: { preset: 'vivid' } });

const project = {
  version: 1,
  name: '限界バス運行！ PV',
  width: 1920,
  height: 1080,
  fps: 30,
  background: '#000000',
  fadeOut: 0.8,
  media,
  clips,
  texts,
  shapes,
  effects,
  audios,
};
writeFileSync(path.join(here, 'build', 'pv.json'), JSON.stringify(project, null, 1));
console.log(`曲の頭 ${m0.toFixed(2)}s / 1小節 ${BAR.toFixed(3)}s / 長さ ${END.toFixed(2)}s / 効果音 ${audios.length - 3} 個`);
for (const s of scenes) console.log(`  ${s.shot.padEnd(7)} ${s.start.toFixed(2)}〜${s.end.toFixed(2)}  (素材 ${s.in.toFixed(2)}〜)`);
