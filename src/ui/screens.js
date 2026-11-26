// タイトル・遊び方・設定・ポーズ・リザルト画面の制御
import { formatClock, formatYen } from '../game/rules.js';
import { PENALTY } from '../config.js';
import { loadBest, submitBest, saveSettings } from '../core/storage.js';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements.js';
import { shareResult } from './share.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['title', 'howto', 'settings', 'pause', 'result', 'achievements'];

export class Screens {
  constructor({ settings, audio }) {
    this.settings = settings;
    this.audio = audio;
    this.current = 'title';
    this.backTo = 'title';
    this.game = null;
    this.handlers = {};
    this._bind();
    this._applyTouchMode();
    this._applyMinimap();
    this.refreshBest();
  }

  attach(game) {
    this.game = game;
  }

  showScreen(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    this.current = name;
  }

  _click(id, fn, sound = 'ui_click') {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      // Space（サイドブレーキ）でボタンが再度押されないようにフォーカスを外す
      el.blur();
      this.audio.unlock();
      if (sound) this.audio.play(sound, { volume: 0.7 });
      fn();
    });
  }

  _bind() {
    this._click('btn-start', () => this.game.startRun(), 'ui_ok');
    this._click('btn-achievements', () => {
      this.backTo = 'title';
      this._fillAchievements();
      this.showScreen('achievements');
    });
    this._click('btn-hints-reset', () => {
      this.game.hints.reset();
      $('btn-hints-reset').textContent = 'ヒントを最初から表示します';
    });
    this._click('btn-share', async () => {
      if (!this.lastResult) return;
      const r = await shareResult(this.lastResult);
      if (r === 'downloaded') $('btn-share').textContent = '画像を保存しました';
      this.audio.play('shutter', { volume: 0.6 });
    });
    this._click('btn-howto', () => {
      this.backTo = 'title';
      this.showScreen('howto');
    });
    this._click('btn-settings', () => {
      this.backTo = 'title';
      this._fillSettings();
      this.showScreen('settings');
    });
    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        this.audio.play('ui_back', { volume: 0.6 });
        this.showScreen(this.backTo);
      });
    }
    this._click('btn-pause', () => this.game.pause());
    this._click('btn-reset', () => this.game.resetBus());
    this._click('btn-resume', () => this.game.resume(), 'ui_ok');
    this._click('btn-retry-pause', () => this.game.startRun(), 'ui_ok');
    this._click('btn-title-pause', () => this.game.toTitle());
    this._click('btn-pause-settings', () => {
      this.backTo = 'pause';
      this._fillSettings();
      this.showScreen('settings');
    });
    this._click('btn-retry', () => this.game.startRun(), 'ui_ok');
    this._click('btn-title', () => this.game.toTitle());
    this._click('btn-minimap', () => this.toggleMinimap());
    this._click('btn-fullscreen', () => this._fullscreen());

    // 設定の変更
    const s = this.settings;
    $('set-volume').addEventListener('input', (e) => {
      s.volume = parseFloat(e.target.value);
      this.audio.setVolume(s.volume);
      saveSettings(s);
    });
    $('set-bgm').addEventListener('input', (e) => {
      s.bgmVolume = parseFloat(e.target.value);
      this.audio.setBgmVolume(s.bgmVolume);
      saveSettings(s);
    });
    $('set-sfx').addEventListener('input', (e) => {
      s.sfxVolume = parseFloat(e.target.value);
      this.audio.setSfxVolume(s.sfxVolume);
      saveSettings(s);
    });
    $('set-sfx').addEventListener('change', () => this.audio.play('coin', { volume: 0.6 }));
    $('set-ghost').addEventListener('change', (e) => {
      s.ghost = e.target.checked;
      saveSettings(s);
    });
    $('set-hints').addEventListener('change', (e) => {
      s.hints = e.target.checked;
      saveSettings(s);
    });
    $('set-quality').addEventListener('change', (e) => {
      s.quality = e.target.value;
      saveSettings(s);
      this.game && this.game.applyQuality(s.quality);
    });
    $('set-announce').addEventListener('change', (e) => {
      s.announce = e.target.checked;
      this.audio.announce = s.announce;
      saveSettings(s);
    });
    $('set-touch').addEventListener('change', (e) => {
      s.touch = e.target.value;
      saveSettings(s);
      this._applyTouchMode();
    });
    $('set-minimap').addEventListener('change', (e) => {
      s.minimap = e.target.checked;
      saveSettings(s);
      this._applyMinimap();
    });
    const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    if (!fsSupported) $('btn-fullscreen').classList.add('hidden');
  }

  _fillSettings() {
    const s = this.settings;
    $('set-volume').value = s.volume;
    $('set-bgm').value = s.bgmVolume;
    $('set-sfx').value = s.sfxVolume;
    $('set-ghost').checked = s.ghost !== false;
    $('set-hints').checked = s.hints !== false;
    $('set-quality').value = s.quality;
    $('set-announce').checked = !!s.announce;
    $('set-touch').value = s.touch;
    $('set-minimap').checked = !!s.minimap;
  }

  _fullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    Promise.resolve(req.call(el))
      .then(() => {
        // 対応端末のみ横向きに固定（失敗しても無視）
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      })
      .catch(() => {});
  }

  _applyTouchMode() {
    const mode = this.settings.touch;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const on = mode === 'on' || (mode === 'auto' && (coarse || 'ontouchstart' in window));
    $('touch').classList.toggle('off', !on);
    document.body.classList.toggle('no-touch', !on);
  }

  _applyMinimap() {
    $('minimap-wrap').classList.toggle('collapsed', !this.settings.minimap);
  }

  toggleMinimap() {
    this.settings.minimap = !this.settings.minimap;
    saveSettings(this.settings);
    this._applyMinimap();
  }

  minimapVisible() {
    return !!this.settings.minimap;
  }

  refreshBest() {
    const b = loadBest();
    $('title-best').textContent = b ? `自己ベスト ${b.total.toLocaleString('ja-JP')}点（ランク${b.rank}）` : '';
    const got = Object.keys(loadAchievements()).length;
    $('ach-count').textContent = `${got}/${ACHIEVEMENTS.length}`;
  }

  _fillAchievements() {
    const got = loadAchievements();
    $('ach-summary').textContent = `${Object.keys(got).length} / ${ACHIEVEMENTS.length}`;
    $('ach-list').innerHTML = ACHIEVEMENTS.map((a) => {
      const ok = !!got[a.id];
      return `<li class="${ok ? '' : 'locked'}"><span class="ic">${ok ? a.icon : '🔒'}</span><span><b>${a.name}</b><small>${a.desc}</small></span></li>`;
    }).join('');
  }

  showResult(r) {
    this.lastResult = r;
    $('btn-share').textContent = '結果を画像でシェア';
    const isNew = submitBest({ total: r.total, rank: r.rank, stopsServed: r.stopsServed, damage: r.damage });
    const best = loadBest();
    const rankEl = $('res-rank');
    rankEl.textContent = r.rank;
    rankEl.className = 'rank hide r-' + r.rank;
    // ドラムロール → スコアのカウントアップ → ランク発表
    const a = this.audio;
    a.play('drumroll', { volume: 0.8 });
    const totalEl = $('res-total');
    const t0 = performance.now(), dur = 1300;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      totalEl.textContent = Math.round(r.total * (1 - Math.pow(1 - k, 3))).toLocaleString('ja-JP');
      if (k < 1 && this.current === 'result') requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    clearTimeout(this._revealT);
    this._revealT = setTimeout(() => {
      if (this.current !== 'result') return;
      rankEl.className = 'rank reveal r-' + r.rank;
      if (r.rank === 'S') {
        a.play('rank_s');
        a.play('applause', { volume: 0.7, delay: 0.3 });
      } else if (r.rank === 'A') {
        a.play('rank');
        a.play('applause', { volume: 0.5, delay: 0.3 });
      } else a.play('rank', { volume: r.rank === 'D' ? 0.6 : 0.85 });
      if (isNew) a.play('record', { delay: 0.9 });
      setTimeout(() => this.current === 'result' && a.playBgm('result', { fade: 1.5 }), 1600);
    }, dur + 150);
    const unl = $('res-unlocked');
    if (r.unlocked && r.unlocked.length) {
      unl.innerHTML = '🏆 実績解除：' + r.unlocked.map((x) => `${x.icon} ${x.name}`).join('　');
      unl.classList.remove('hidden');
    } else unl.classList.add('hidden');
    $('res-title').textContent = r.reason === 'clear' ? (r.allStopsBonus ? '全停留所制覇！ 終点到着' : '終点到着（一部通過）') : '時間切れ… 途中終了';
    $('res-comment').textContent = r.comment;
    totalEl.textContent = '0';
    const bestEl = $('res-best');
    bestEl.textContent = isNew ? '★ 自己ベスト更新！' : best ? `自己ベスト ${best.total.toLocaleString('ja-JP')}点` : '';
    bestEl.classList.toggle('new', isNew);

    const row = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${v}</td></tr>`;
    $('res-breakdown').innerHTML =
      '<caption>スコア内訳</caption>' +
      row('運賃収入', '+' + formatYen(r.fare), 'plus') +
      row('定時到着ボーナス', '+' + formatYen(r.onTimeBonus), 'plus') +
      row('全停留所制覇ボーナス', r.allStopsBonus ? '+' + formatYen(r.allStopsBonus) : '¥0', 'plus') +
      row('器物破損罰金', formatYen(-r.damage), 'minus') +
      row('その他ペナルティ', formatYen(-r.other), 'minus') +
      row('合計', `${r.total.toLocaleString('ja-JP')}点`, 'total');

    const c = r.counts, d = r.damageByKind;
    const drow = (label, n, amount) => `<tr><td>${label}</td><td>${n}個</td><td class="minus">${formatYen(-amount)}</td></tr>`;
    $('res-damage').innerHTML =
      '<caption>破損・事故</caption>' +
      drow(PENALTY.cone.label, c.cone, d.cone) +
      drow(PENALTY.sign.label, c.sign, d.sign) +
      drow(PENALTY.guardrail.label, c.guardrail, d.guardrail) +
      drow(PENALTY.car.label, c.car, d.car) +
      `<tr><td>激突で乗客転倒</td><td>${c.impact}回</td><td class="minus">${formatYen(-c.impact * 500)}</td></tr>` +
      `<tr><td>路面へ復帰</td><td>${c.reset}回</td><td class="minus">${formatYen(-c.reset * 1000)}</td></tr>` +
      `<tr><td>急ブレーキ</td><td>${c.brake || 0}回</td><td class="minus">${formatYen(-(c.brake || 0) * 300)}</td></tr>`;

    let html = '<tr><th>#</th><th>停留所</th><th>定刻</th><th>到着</th><th>遅延</th><th>乗車</th></tr>';
    r.stops.forEach((s, i) => {
      const skipped = s.status !== 'done';
      const delay = s.delay == null ? '—' : s.delay <= 0 ? `定時(${Math.round(s.delay)}秒)` : `+${Math.round(s.delay)}秒`;
      const cls = s.delay == null ? '' : s.delay <= 0 ? 'ok' : 'late';
      const board = s.terminal ? '降車' : skipped ? (s.status === 'skipped' ? '通過' : '未到着') : `${s.board}人${s.lost ? `（${s.lost}人帰宅）` : ''}`;
      html += `<tr class="${skipped ? 'skipped' : ''}"><td>${i + 1}</td><td>${s.name}</td><td>${formatClock(s.scheduled)}</td><td>${s.arrival != null ? formatClock(s.arrival) : '—'}</td><td class="${cls}">${delay}</td><td>${board}</td></tr>`;
    });
    $('res-stops').innerHTML = html;
    this.refreshBest();
    this.showScreen('result');
  }
}
