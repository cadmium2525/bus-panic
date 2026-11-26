// 音源ファイルと、コードから呼んでいる効果音名の整合性・実績判定のテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO } from '../src/audio/manifest.js';
import { achievementsForResult, ACHIEVEMENTS } from '../src/game/achievements.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('マニフェストの音源ファイルがすべて存在する', () => {
  const files = [
    ...Object.values(AUDIO.bgm).map((b) => b.file),
    ...Object.values(AUDIO.jingle).map((b) => b.file),
    ...Object.values(AUDIO.loops).map((b) => b.file),
    ...Object.values(AUDIO.sfx),
  ];
  assert.ok(files.length > 30);
  for (const f of files) assert.ok(existsSync(path.join(root, 'public', f)), f);
});

test('コードで鳴らしている効果音・BGM・ジングルはマニフェストにある', () => {
  const src = sources(path.join(root, 'src')).map((p) => readFileSync(p, 'utf8')).join('\n');
  const played = [...src.matchAll(/\.play\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(played.length > 20);
  for (const k of new Set(played)) assert.ok(AUDIO.sfx[k], `効果音 ${k}`);
  for (const [, k] of src.matchAll(/playBgm\('([a-z]+)'/g)) assert.ok(AUDIO.bgm[k], `BGM ${k}`);
  for (const [, k] of src.matchAll(/jingle\('([a-z]+)'/g)) assert.ok(AUDIO.jingle[k], `ジングル ${k}`);
});

test('ループ曲はループ長が正で、走行中の 2 層は同じ長さ', () => {
  for (const b of Object.values(AUDIO.bgm)) assert.ok(b.loop > 5);
  assert.equal(AUDIO.bgm.drive.loop, AUDIO.bgm.rush.loop);
});

test('音源の合計サイズは 4MB 以下（初回の通信量を抑える）', () => {
  const dir = path.join(root, 'public', 'audio');
  const total = readdirSync(dir).reduce((s, f) => s + statSync(path.join(dir, f)).size, 0);
  assert.ok(total < 4 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)}MB`);
});

test('実績: 結果から解除される実績を判定できる', () => {
  const stops = Array.from({ length: 15 }, () => ({ status: 'done', delay: -3 }));
  const r = { reason: 'clear', allStopsBonus: 5000, stops, damage: 0, other: 0, rank: 'S', fare: 38000, counts: { guardrail: 0, car: 0 } };
  const ids = achievementsForResult(r);
  for (const id of ['first', 'allstops', 'ontime', 'clean', 'rankA', 'rankS', 'fare']) assert.ok(ids.includes(id), id);
  const bad = { reason: 'timeout', allStopsBonus: 0, stops, damage: 31000, other: 0, rank: 'D', fare: 100, counts: { guardrail: 12, car: 6 } };
  const ids2 = achievementsForResult(bad);
  assert.deepEqual(ids2.sort(), ['cars', 'destroyer', 'rails']);
  // すべての ID が定義済み
  const all = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const id of [...ids, ...ids2]) assert.ok(all.has(id));
});
