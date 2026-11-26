// タイトル・遊び方・設定・ポーズ・リザルト画面の制御
import { formatClock, formatYen } from '../game/rules.js';
import { PENALTY, RULES } from '../config.js';
import { loadBest, submitBest, saveSettings } from '../core/storage.js';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements.js';
import { shareResult, postToX } from './share.js';
import { dailyChallenge } from '../game/modes.js';
import { saveClip } from '../core/clips.js';

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
    this._click('btn-start', () => this.game.startRun('normal'), 'ui_ok');
    this._click('btn-intro', () => this.game.startRun('intro'), 'ui_ok');
    this._click('btn-daily', () => this.game.startRun('daily'), 'ui_ok');
    this._click('btn-rampage', () => this.game.startRun('rampage'), 'ui_ok');
    this._click('btn-achievements', () => {
      this.backTo = 'title';
      this._fillAchievements();
      this.showScreen('achievements');
    });
    this._click('btn-hints-reset', () => {
      this.game.hints.reset();
      $('btn-hints-reset').textContent = 'ヒントを最初から表示します';
    });
    this._click('btn-post-x', () => this.lastResult && postToX(this.lastResult));
    this._click('btn-share', async () => {
      if (!this.lastResult) return;
      const r = await shareResult(this.lastResult, this.game && this.game.snapshot());
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
    $('set-clips').addEventListener('change', (e) => {
      s.clips = e.target.value;
      saveSettings(s);
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
    $('set-clips').value = s.clips || 'auto';
  }

  /** 結果画面のハイライト動画（運行の終わりに録画が切り出されたら呼ばれる） */
  showClips(clips) {
    const box = $('res-clips');
    const list = $('clips-list');
    for (const u of this._clipUrls || []) URL.revokeObjectURL(u);
    this._clipUrls = [];
    list.textContent = '';
    if (!clips || !clips.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    $('clips-note').textContent = clips[0].ext === 'mp4' ? '保存して X にそのまま貼れます' : '保存できます（WebM 形式。X に貼るには MP4 への変換が必要です）';
    clips.forEach((c, k) => {
      const url = URL.createObjectURL(c.blob);
      this._clipUrls.push(url);
      const fig = document.createElement('figure');
      fig.className = 'clip';
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.addEventListener('click', () => {
        v.muted = !v.muted;
        if (v.paused) v.play();
      });
      const cap = document.createElement('figcaption');
      cap.textContent = c.label;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = '保存';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.blur();
        const r = await saveClip(c, `genkai-bus-${k + 1}`);
        if (r === 'downloaded') btn.textContent = '保存しました';
      });
      fig.append(v, cap, btn);
      list.appendChild(fig);
    });
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
    const d = dailyChallenge();
    const db = loadBest('daily', d.key);
    $('daily-desc').textContent = d.picks.map((p) => `${p.icon}${p.name}`).join('＋') + (db ? `／今日のベスト ${db.total.toLocaleString('ja-JP')}` : '');
    $('btn-daily').title = d.picks.map((p) => `${p.name}：${p.desc}`).join('\n');
    const ib = loadBest('intro');
    $('intro-desc').textContent = ib ? `停留所 5 か所・約 2 分／ベスト ${ib.total.toLocaleString('ja-JP')}点（${ib.rank}）` : '停留所 5 か所・約 2 分';
    // 一度走りきったら目立たせない
    $('btn-intro').classList.toggle('done', !!loadAchievements().intro);
    $('btn-intro').firstChild.textContent = loadAchievements().intro ? '🔰 入門コース' : '🔰 はじめての方は 入門コース';
    const rb = loadBest('rampage');
    $('rampage-desc').textContent = rb ? `ベスト ${rb.total.toLocaleString('ja-JP')}点` : '2分間ひたすら壊す';
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
    this.showClips(this.game && this.game.lastClips);
    $('btn-share').textContent = '結果を画像でシェア';
    const day = r.daily ? r.daily.key : null;
    const isNew = submitBest({ total: r.total, rank: r.rank, stopsServed: r.stopsServed, damage: r.damage }, r.mode, day);
    const best = loadBest(r.mode, day);
    const rampage = r.mode === 'rampage';
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
    let title = r.reason === 'clear' ? (r.allStopsBonus ? '全停留所制覇！ 終点到着' : '終点到着（一部通過）') : '時間切れ… 途中終了';
    if (rampage) title = '暴走モード 終了';
    else if (r.mode === 'intro') title = `入門コース｜${r.reason === 'clear' ? '終点到着！' : '時間切れ…'}`;
    else if (r.daily) title = `日替わり ${r.daily.key.slice(5).replace('-', '/')}｜${title}`;
    $('res-title').textContent = title;
    $('res-total').previousElementSibling.textContent = rampage ? '破壊点' : '総合スコア';
    $('btn-retry').textContent = rampage ? 'もう一度暴れる' : r.daily ? '日替わりにもう一度挑む' : r.mode === 'intro' ? '入門コースをもう一度' : 'もう一度運行する';
    $('res-comment').textContent = r.comment;
    totalEl.textContent = '0';
    const bestEl = $('res-best');
    bestEl.textContent = isNew ? '★ 自己ベスト更新！' : best ? `自己ベスト ${best.total.toLocaleString('ja-JP')}点` : '';
    bestEl.classList.toggle('new', isNew);

    const row = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${v}</td></tr>`;
    const c = r.counts, d = r.damageByKind;
    $('res-stops').closest('details').classList.toggle('hidden', rampage);
    if (rampage) {
      const rp = r.rampage;
      $('res-breakdown').innerHTML =
        '<caption>暴走の記録</caption>' +
        row('壊した数', `${rp.destroyed}個`, 'plus') +
        row('最大コンボ', `${rp.maxChain}連続`, 'plus') +
        row('最高速度', `${r.maxSpeedKmh}km/h`, 'plus') +
        row('破壊点', `${r.total.toLocaleString('ja-JP')}点`, 'total');
      const crow = (label, n) => `<tr><td>${label}</td><td>${n}</td><td></td></tr>`;
      $('res-damage').innerHTML =
        '<caption>壊したもの</caption>' +
        crow(PENALTY.cone.label, `${c.cone}個`) +
        crow(PENALTY.sign.label, `${c.sign}個`) +
        crow(PENALTY.guardrail.label, `${c.guardrail}本`) +
        crow(PENALTY.car.label, `${c.car}台`);
      this.refreshBest();
      this.showScreen('result');
      return;
    }
    $('res-breakdown').innerHTML =
      '<caption>スコア内訳</caption>' +
      row('運賃収入', '+' + formatYen(r.fare), 'plus') +
      row(`定時ボーナス（最大 ${r.maxCombo} コンボ）`, '+' + formatYen(r.onTimeBonus), 'plus') +
      row(`運転技術（ピタッ！${r.pita.perfect}回${r.rival.wins + r.rival.losses ? `・ライバル${r.rival.wins}勝` : ''}）`, '+' + formatYen(r.skillBonus), 'plus') +
      (r.hurry.total ? row(`急ぎ客のチップ（${r.hurry.done}/${r.hurry.total}人）`, '+' + formatYen(r.tips), 'plus') : '') +
      row('全停留所制覇ボーナス', r.allStopsBonus ? '+' + formatYen(r.allStopsBonus) : '¥0', 'plus') +
      row('器物破損罰金', formatYen(-r.damage), 'minus') +
      row('その他ペナルティ', formatYen(-r.other), 'minus') +
      row('合計', `${r.total.toLocaleString('ja-JP')}点`, 'total');

    const drow = (label, n, amount) => `<tr><td>${label}</td><td>${n}個</td><td class="minus">${formatYen(-amount)}</td></tr>`;
    $('res-damage').innerHTML =
      '<caption>破損・事故</caption>' +
      drow(PENALTY.cone.label, c.cone, d.cone) +
      drow(PENALTY.sign.label, c.sign, d.sign) +
      drow(PENALTY.guardrail.label, c.guardrail, d.guardrail) +
      drow(PENALTY.car.label, c.car, d.car) +
      `<tr><td>激突で乗客転倒</td><td>${c.impact}回</td><td class="minus">${formatYen(-c.impact * 500)}</td></tr>` +
      `<tr><td>路面へ復帰</td><td>${c.reset}回</td><td class="minus">${formatYen(-c.reset * 1000)}</td></tr>` +
      `<tr><td>急ブレーキ</td><td>${c.brake || 0}回</td><td class="minus">${formatYen(-(c.brake || 0) * 300)}</td></tr>` +
      `<tr><td>踏切無視</td><td>${c.crossing || 0}回</td><td class="minus">${formatYen(-(r.crossingFine || 0))}</td></tr>` +
      (c.train ? `<tr><td>電車と接触事故</td><td>${c.train}回</td><td class="minus">${formatYen(-c.train * RULES.trainCrashPenalty)}</td></tr>` : '');

    const PITA = { perfect: 'ピタッ！', great: 'ナイス', good: 'まあまあ', miss: '—' };
    let html = '<tr><th>#</th><th>停留所</th><th>定刻</th><th>到着</th><th>遅延</th><th>停車</th><th>乗車</th></tr>';
    r.stops.forEach((s, i) => {
      const skipped = s.status !== 'done';
      const d = s.delay == null ? null : Math.round(s.delay);
      const delay = d == null ? '—' : s.onTime ? `定時(${d > 0 ? '+' : ''}${d}秒)` : `+${d}秒`;
      const cls = d == null ? '' : s.onTime ? 'ok' : 'late';
      const extra = [s.lost ? `${s.lost}人帰宅` : '', s.stolen ? `${s.stolen}人横取り` : ''].filter(Boolean).join('・');
      const board = s.terminal ? '降車' : skipped ? (s.status === 'skipped' ? '通過' : '未到着') : `${s.board}人${extra ? `（${extra}）` : ''}`;
      const pita = s.pita ? PITA[s.pita] : '—';
      html += `<tr class="${skipped ? 'skipped' : ''}"><td>${i + 1}</td><td>${s.name}</td><td>${formatClock(s.scheduled)}</td><td>${s.arrival != null ? formatClock(s.arrival) : '—'}</td><td class="${cls}">${delay}</td><td class="${s.pita === 'perfect' ? 'ok' : ''}">${pita}</td><td>${board}</td></tr>`;
    });
    $('res-stops').innerHTML = html;
    this.refreshBest();
    this.showScreen('result');
  }
}
