#!/usr/bin/env node
/*
 * BGM・効果音を「かなでる」（https://github.com/cadmium2525/mp4mp3 の daw/）のエンジンで書き出す。
 *
 *   git clone https://github.com/cadmium2525/mp4mp3 ../mp4mp3
 *   npm run audio                    # = node audio-src/build.mjs
 *   KANADERU=/path/to/mp4mp3/daw npm run audio -- --only title,coin
 *
 * - 曲・効果音の JSON は audio-src/json/ にも保存する（かなでるアプリに貼り付けて編集できる）
 * - ループ曲は余韻を頭に折り返して継ぎ目なくつながるようにする
 * - 低音のチェック：帯域バランスとスマホスピーカー想定の損失を表示し、低域が出すぎていれば警告
 * - 出力：public/audio/*.mp3（ループ音は *.wav）と src/audio/manifest.js
 * 必要なもの：Node.js 18 以上、ffmpeg
 */
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as SONGS from './songs.mjs';
import { SFX, LOOPS } from './sfx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dawDir = path.resolve(process.env.KANADERU || path.join(root, '..', 'mp4mp3', 'daw'));
if (!existsSync(path.join(dawDir, 'js/engine/mix.js'))) {
  console.error(`かなでる のエンジンが見つかりません: ${dawDir}\n  git clone https://github.com/cadmium2525/mp4mp3 ../mp4mp3  または  KANADERU=<mp4mp3/daw のパス> を指定してください`);
  process.exit(1);
}
const imp = (p) => import(pathToFileURL(path.join(dawDir, p)).href);
const { renderSong } = await imp('js/engine/mix.js');
const { renderAnySfx } = await imp('js/engine/sfx.js');
const { analyzeAudio, loudness, truePeak } = await imp('js/engine/analyze.js');
const { encodeWav } = await imp('js/engine/wav.js');
const { validateSong } = await imp('js/engine/validate.js');
const { limit } = await imp('js/engine/fx.js');

const args = process.argv.slice(2);
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;
const want = (k) => !only || only.has(k);

const OUT = path.join(root, 'public', 'audio');
const JSON_DIR = path.join(here, 'json');
mkdirSync(OUT, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
const manifestPath = path.join(root, 'src', 'audio', 'manifest.js');
mkdirSync(path.dirname(manifestPath), { recursive: true });

const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
const fromDb = (d) => Math.pow(10, d / 20);
const kb = (f) => `${Math.round(readFileSync(f).length / 1024)}KB`;

function ffmpeg(wav, out, extra) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, ...extra, out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg での変換に失敗しました: ' + out);
}
function writeAudio(L, R, file, { bitrate = 128, wavMono = false } = {}) {
  const tmp = path.join(OUT, `.${path.basename(file)}.tmp.wav`);
  writeFileSync(tmp, encodeWav(L, R, SR, 24));
  if (file.endsWith('.wav')) ffmpeg(tmp, file, ['-ac', wavMono ? '1' : '2', '-ar', '24000', '-c:a', 'pcm_s16le']);
  else ffmpeg(tmp, file, ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-ar', '44100']);
  unlinkSync(tmp);
}

/** ループ曲：ループの長さ以降（余韻）を頭に足し込む */
function foldLoop(L, R, loopN) {
  const oL = new Float32Array(loopN), oR = new Float32Array(loopN);
  for (let i = 0; i < L.length; i++) {
    const j = i % loopN;
    oL[j] += L[i];
    oR[j] += R[i];
  }
  return [oL, oR];
}
/** 短いループ音：最後の xf サンプルを頭とクロスフェード */
function crossLoop(L, R, loopN, xf) {
  const oL = new Float32Array(loopN), oR = new Float32Array(loopN);
  for (let i = 0; i < loopN; i++) {
    if (i < xf && i + loopN < L.length) {
      const a = Math.sin((i / xf) * Math.PI * 0.5), b = Math.cos((i / xf) * Math.PI * 0.5);
      oL[i] = L[i] * a + L[i + loopN] * b;
      oR[i] = R[i] * a + R[i + loopN] * b;
    } else {
      oL[i] = L[i];
      oR[i] = R[i];
    }
  }
  return [oL, oR];
}
function gain(L, R, g) {
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
}

/** 低音のチェック（帯域は dB、phoneLoss はスマホのスピーカーで何 dB 小さく聞こえるか） */
const checks = [];
function check(name, L, R, kind) {
  const a = analyzeAudio(L, R, SR, {});
  const b = a.bands;
  const ref = Math.max(b.lowmid, b.mid);
  const warn = [];
  // ほぼ無音の帯域どうしの比較は無視する
  if (b.bass > -45 && b.bass > ref + 2) warn.push(`低域が中域より ${(b.bass - ref).toFixed(1)}dB 大きい`);
  if (b.sub > -45 && b.sub > b.bass - 10) warn.push(`超低域が多い（${b.sub}dB）`);
  if (a.phoneLoss > 8) warn.push(`スマホで ${a.phoneLoss}dB 小さく聞こえる`);
  checks.push({ name, kind, lufs: a.lufs, peak: a.truePeakDb, sub: b.sub, bass: b.bass, lowmid: b.lowmid, mid: b.mid, phone: a.phoneLoss, warn });
}

const manifest = { bgm: {}, jingle: {}, sfx: {}, loops: {} };
// 既存の manifest を引き継ぐ（--only で一部だけ作り直すとき）
if (only && existsSync(manifestPath)) {
  const prev = readFileSync(manifestPath, 'utf8').match(/export const AUDIO = (\{[\s\S]*\});/);
  if (prev) Object.assign(manifest, JSON.parse(prev[1]));
}

function render(song) {
  const chk = validateSong(song);
  for (const e of chk.errors) console.error(`✗ ${song.name}: ${e}`);
  for (const w of chk.warnings) if (!/loop/.test(w)) console.error(`△ ${song.name}: ${w}`);
  if (chk.errors.length) process.exit(1);
  const out = renderSong(song);
  return [out.L, out.R];
}
const loopSamples = (song) => Math.round(((song.bars * 4 * 60) / song.bpm) * SR);

// ---------------- BGM ----------------
const BGM = [
  ['title', SONGS.title, 112],
  ['result', SONGS.result, 96],
];
for (const [key, song, kbps] of BGM) {
  if (!want(key)) continue;
  writeFileSync(path.join(JSON_DIR, `bgm_${key}.json`), JSON.stringify(song, null, 1));
  const t0 = Date.now();
  let [L, R] = render(song);
  const n = loopSamples(song);
  [L, R] = foldLoop(L, R, n);
  // 折り返しで増えた分を目標ラウドネスに戻し、ピークを抑える
  gain(L, R, fromDb(song.master.loudness - loudness(L, R, SR)));
  limit(L, R, SR, -1.3, 0.06, 0.005);
  const file = path.join(OUT, `bgm_${key}.mp3`);
  writeAudio(L, R, file, { bitrate: kbps });
  check(`bgm_${key}`, L, R, 'bgm');
  manifest.bgm[key] = { file: `audio/bgm_${key}.mp3`, loop: n / SR };
  console.log(`BGM ${key}: ${(n / SR).toFixed(2)}s ${kb(file)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 走行中の BGM：通常の層と遅延時の層。足したときに -15 LUFS・ピーク -1dB 付近になる共通の倍率をかける
if (want('drive')) {
  const t0 = Date.now();
  writeFileSync(path.join(JSON_DIR, 'bgm_drive_base.json'), JSON.stringify(SONGS.driveBase, null, 1));
  writeFileSync(path.join(JSON_DIR, 'bgm_drive_rush.json'), JSON.stringify(SONGS.driveRush, null, 1));
  const n = loopSamples(SONGS.driveBase);
  const [bL, bR] = foldLoop(...render(SONGS.driveBase), n);
  const [rL, rR] = foldLoop(...render(SONGS.driveRush), n);
  const sL = new Float32Array(n), sR = new Float32Array(n);
  for (let i = 0; i < n; i++) { sL[i] = bL[i] + rL[i]; sR[i] = bR[i] + rR[i]; }
  let g = fromDb(-15 - loudness(sL, sR, SR));
  const tp = truePeak(sL, sR) * g;
  if (tp > fromDb(-1)) g *= fromDb(-1) / tp;
  for (const [L, R] of [[bL, bR], [rL, rR], [sL, sR]]) gain(L, R, g);
  writeAudio(bL, bR, path.join(OUT, 'bgm_drive.mp3'), { bitrate: 112 });
  writeAudio(rL, rR, path.join(OUT, 'bgm_rush.mp3'), { bitrate: 96 });
  check('bgm_drive（通常）', bL, bR, 'bgm');
  check('bgm_drive+rush（遅延時）', sL, sR, 'bgm');
  manifest.bgm.drive = { file: 'audio/bgm_drive.mp3', loop: n / SR };
  manifest.bgm.rush = { file: 'audio/bgm_rush.mp3', loop: n / SR };
  console.log(`BGM drive/rush: ${(n / SR).toFixed(2)}s ${kb(path.join(OUT, 'bgm_drive.mp3'))} + ${kb(path.join(OUT, 'bgm_rush.mp3'))} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------------- ジングル ----------------
for (const [key, song] of [['clear', SONGS.jingleClear], ['timeout', SONGS.jingleTimeout]]) {
  if (!want(key)) continue;
  writeFileSync(path.join(JSON_DIR, `jingle_${key}.json`), JSON.stringify(song, null, 1));
  const [L, R] = render(song);
  const file = path.join(OUT, `jingle_${key}.mp3`);
  writeAudio(L, R, file, { bitrate: 112 });
  check(`jingle_${key}`, L, R, 'jingle');
  manifest.jingle[key] = { file: `audio/jingle_${key}.mp3` };
  console.log(`ジングル ${key}: ${(L.length / SR).toFixed(2)}s ${kb(file)}`);
}

// ---------------- 効果音 ----------------
for (const [key, def] of Object.entries(SFX)) {
  if (!want(key)) continue;
  writeFileSync(path.join(JSON_DIR, `sfx_${key}.json`), JSON.stringify(def, null, 1));
  const [L, R] = renderAnySfx(def, SR);
  const file = path.join(OUT, `sfx_${key}.mp3`);
  writeAudio(L, R, file, { bitrate: 96 });
  check(`sfx_${key}`, L, R, 'sfx');
  manifest.sfx[key] = `audio/sfx_${key}.mp3`;
}
console.log(`効果音 ${Object.keys(SFX).filter(want).length} 個`);

// ---------------- ループ音 ----------------
for (const [key, spec] of Object.entries(LOOPS)) {
  if (!want(key)) continue;
  writeFileSync(path.join(JSON_DIR, `loop_${key}.json`), JSON.stringify(spec.def, null, 1));
  let [L, R] = renderAnySfx(spec.def, SR);
  const n = Math.round(spec.loopSec * SR);
  [L, R] = crossLoop(L, R, n, Math.round(0.25 * SR));
  const file = path.join(OUT, `loop_${key}.wav`);
  writeAudio(L, R, file, { wavMono: true });
  check(`loop_${key}`, L, R, 'loop');
  manifest.loops[key] = { file: `audio/loop_${key}.wav`, loop: spec.loopSec };
  console.log(`ループ ${key}: ${kb(file)}`);
}

writeFileSync(
  manifestPath,
  `// 自動生成（audio-src/build.mjs）。音源は「かなでる」で作成。\nexport const AUDIO = ${JSON.stringify(manifest, null, 2)};\n`,
);

// ---------------- 低音チェックの結果 ----------------
console.log('\n名前                          LUFS   TP  超低域  低域 中低域  中域  スマホ損失  判定');
let bad = 0;
for (const c of checks) {
  const ok = c.warn.length === 0;
  if (!ok) bad++;
  console.log(
    `${c.name.padEnd(28)} ${String(c.lufs).padStart(6)} ${String(c.peak).padStart(5)} ${String(c.sub).padStart(6)} ${String(c.bass).padStart(6)} ${String(c.lowmid).padStart(6)} ${String(c.mid).padStart(6)} ${String(c.phone).padStart(8)}   ${ok ? 'OK' : '⚠ ' + c.warn.join(' / ')}`,
  );
}
console.log(bad ? `\n⚠ 低音の注意: ${bad} 件` : '\n✓ すべて低音のバランス OK');
