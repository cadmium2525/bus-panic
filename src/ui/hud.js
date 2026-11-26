// HTML/CSS オーバーレイの HUD
import { formatClock, formatYen } from '../game/rules.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'),
      stopNo: $('hud-stop-no'),
      stopName: $('hud-stop-name'),
      stopKana: $('hud-stop-kana'),
      sched: $('hud-sched'),
      status: $('hud-status'),
      waiting: $('hud-waiting'),
      waitIcons: $('hud-wait-icons'),
      leaveWarn: $('hud-leave'),
      dist: $('hud-dist'),
      arrow: $('hud-arrow'),
      clock: $('hud-clock'),
      remain: $('hud-remain'),
      fare: $('hud-fare'),
      fine: $('hud-fine'),
      total: $('hud-total'),
      speed: $('hud-speed'),
      speedBar: $('hud-speed-bar'),
      onboard: $('hud-onboard'),
      toasts: $('toasts'),
      floats: $('floats'),
      big: $('bigmsg'),
      bigMain: $('bigmsg-main'),
      bigSub: $('bigmsg-sub'),
      dwell: $('dwell'),
      dwellBar: $('dwell-bar'),
      dwellLabel: $('dwell-label'),
    };
    this._bigTimer = 0;
    this._last = {};
    this.floatPool = [];
    this.el.missions = $('hud-missions');
    this.el.mode = $('hud-mode');
    this.el.next = $('hud-next');
    this.el.rp = { panel: $('hud-rampage'), points: $('hud-rp-points'), chain: $('hud-rp-chain'), count: $('hud-rp-count'), meter: $('hud-rp-meter') };
    this.el.moneyLabel = document.querySelector('#hud .money div:first-child span');
    this.el.pg = { root: $('pita-guide'), label: $('pg-label'), bus: $('pg-bus') };
    this.el.bubbles = $('bubbles');
    this.el.hint = $('hint');
    this.el.hintText = $('hint-text');
    this._initSpeedLines();
  }

  /** 乗客のひとこと（吹き出し） */
  bubble(x, y, text) {
    y = this._belowBig(y, 40);
    const d = document.createElement('div');
    d.className = 'bubble';
    d.textContent = text;
    d.style.left = `${Math.max(70, Math.min(window.innerWidth - 70, x))}px`;
    d.style.top = `${Math.max(90, y)}px`;
    this.el.bubbles.appendChild(d);
    while (this.el.bubbles.children.length > 3) this.el.bubbles.firstChild.remove();
    setTimeout(() => d.remove(), 1900);
  }

  /** 初心者向けのヒント */
  hint(text) {
    const e = this.el;
    e.hintText.textContent = text;
    e.hint.classList.remove('hidden');
    e.hint.classList.remove('show');
    void e.hint.offsetWidth;
    e.hint.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => e.hint.classList.add('hidden'), 6500);
  }

  // ---- スピード線（画面の端に流れる線） ----
  _initSpeedLines() {
    const c = (this.speedCanvas = $('speedlines'));
    this.speedCtx = c.getContext('2d');
    this.speedLevel = 0;
    this.lines = Array.from({ length: 46 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.2, w: 1 + Math.random() * 2 }));
  }
  speedLines(kmh) {
    const c = this.speedCanvas;
    const target = Math.max(0, Math.min(1, (kmh - 52) / 20));
    this.speedLevel += (target - this.speedLevel) * 0.1;
    const lv = this.speedLevel;
    if (lv < 0.02) {
      if (this._speedOn) {
        this.speedCtx.clearRect(0, 0, c.width, c.height);
        this._speedOn = false;
      }
      return;
    }
    this._speedOn = true;
    const W = Math.round(window.innerWidth / 2), H = Math.round(window.innerHeight / 2);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const g = this.speedCtx;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.45, R = Math.hypot(W, H) / 2;
    g.strokeStyle = `rgba(255,255,255,${0.35 * lv})`;
    for (const ln of this.lines) {
      ln.r += 0.06 + lv * 0.05;
      if (ln.r > 1) {
        ln.r = 0.55 + Math.random() * 0.1;
        ln.a = Math.random() * Math.PI * 2;
      }
      const r0 = R * ln.r, r1 = R * (ln.r + ln.l * lv);
      g.lineWidth = ln.w;
      g.beginPath();
      g.moveTo(cx + Math.cos(ln.a) * r0, cy + Math.sin(ln.a) * r0);
      g.lineTo(cx + Math.cos(ln.a) * r1, cy + Math.sin(ln.a) * r1);
      g.stroke();
    }
  }

  show(on) {
    this.el.root.classList.toggle('hidden', !on);
    document.body.classList.toggle('in-game', on);
  }

  /** 遊んでいるモードの表示（日替わりの条件・暴走モードの得点パネル） */
  setMode(mode, daily = null) {
    const e = this.el;
    this.mode = mode;
    this._last = {};
    e.root.classList.toggle('mode-rampage', mode === 'rampage');
    e.rp.panel.classList.toggle('hidden', mode !== 'rampage');
    let chip = '';
    if (mode === 'daily' && daily) chip = `📅 ${daily.picks.map((p) => `${p.icon}${p.name}`).join('・')}`;
    if (mode === 'rampage') chip = '🦖 暴走モード';
    if (mode === 'intro') chip = '🔰 入門コース';
    e.mode.textContent = chip;
    e.mode.className = `mode-chip ${mode}` + (chip ? '' : ' hidden');
    e.root.classList.toggle('has-mode', !!chip);
    e.moneyLabel.textContent = mode === 'rampage' ? '破壊点' : '収入';
    e.missions.textContent = '';
  }

  /** 進行中の目標（コンボ・急ぎの客・ライバル）。list = [{ cls, text }] */
  missions(list) {
    const key = list.map((m) => m.cls + m.text).join('|');
    if (this._last.missions === key) return;
    this._last.missions = key;
    const e = this.el.missions;
    e.textContent = '';
    for (const m of list) {
      const d = document.createElement('div');
      d.className = 'mission ' + m.cls;
      d.textContent = m.text;
      e.appendChild(d);
    }
  }

  /** ピタ止めのガイド。ahead: 目標までの残り（負 = 手前、正 = 行き過ぎ）、null で非表示 */
  pitaGuide(ahead, farFromCurb = false) {
    const g = this.el.pg;
    if (ahead == null) {
      if (!this._last.pgHidden) {
        g.root.classList.add('hidden');
        this.el.root.classList.remove('guide-on');
        this._last.pgHidden = true;
      }
      return;
    }
    if (this._last.pgHidden !== false) {
      this.el.root.classList.add('guide-on');
      g.root.classList.remove('hidden');
      this._last.pgCls = null;
    }
    this._last.pgHidden = false;
    const near = Math.abs(ahead) <= 0.6;
    const over = ahead > 0.6;
    let text = near ? 'ここで止まる！' : over ? `${ahead.toFixed(1)}m 行き過ぎ` : `ピタ止めまで ${(-ahead).toFixed(1)}m`;
    if (farFromCurb) text += ' ←寄せて';
    this._set('pgLabel', g.label, text);
    const cls = 'pita-guide' + (near ? ' near' : over ? ' over' : '');
    // className を書き換えると hidden も外れる
    if (this._last.pgCls !== cls) {
      this._last.pgCls = cls;
      g.root.className = cls;
    }
    const x = Math.max(0, Math.min(100, 80 + ahead * 4));
    g.bus.style.left = `${x.toFixed(1)}%`;
  }

  /** 暴走モードの得点パネル */
  rampage(s) {
    const e = this.el;
    this._set('rpPoints', e.rp.points, s.points.toLocaleString());
    this._set('rpChain', e.rp.chain, s.chain > 0 ? `${s.chain} コンボ ×${s.mult}` : 'コンボ —');
    if (this._last.rpHot !== s.mult > 1) {
      this._last.rpHot = s.mult > 1;
      e.rp.chain.classList.toggle('hot', s.mult > 1);
    }
    this._set('rpCount', e.rp.count, `破壊 ${s.destroyed}`);
    e.rp.meter.style.transform = `scaleX(${Math.max(0, Math.min(1, s.window)).toFixed(3)})`;
    this._set('clock', e.clock, s.clockText);
    const rem = Math.max(0, Math.ceil(s.remain));
    this._set('remain', e.remain, `残り ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`);
    e.remain.classList.toggle('danger', rem <= 15);
    this._set('fare', e.fare, s.points.toLocaleString());
    this._set('total', e.total, s.points.toLocaleString());
    const kmh = Math.round(s.speedKmh);
    this._set('speed', e.speed, String(kmh));
    e.speedBar.style.transform = `scaleX(${Math.min(1, kmh / 75).toFixed(3)})`;
    this._set('onboard', e.onboard, '乗客なし（回送）');
  }

  _set(key, el, text) {
    if (this._last[key] === text) return;
    this._last[key] = text;
    el.textContent = text;
  }

  update(s) {
    const e = this.el;
    this._set('no', e.stopNo, s.terminalOnly ? '終点' : `${s.nextIndex + 1}/${s.total}`);
    this._set('name', e.stopName, s.nextName);
    this._set('kana', e.stopKana, s.nextKana);
    this._set('sched', e.sched, `定刻 ${formatClock(s.nextSched)}`);
    const diff = Math.round(s.timeToSched);
    let st, cls;
    if (s.arrivedDelay != null) {
      // 到着済み（乗降中）：到着時点の結果で固定
      const d = Math.round(s.arrivedDelay);
      st = s.arrivedOnTime ? '到着 定時' : `到着 +${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
      cls = s.arrivedOnTime ? 'ok' : 'late';
    } else if (diff < 0 && -diff <= (s.grace || 0)) {
      // 定刻は過ぎたが、まだ定時扱い（猶予）
      st = `猶予 あと${s.grace + diff}秒`;
      cls = 'warn';
    } else if (diff >= 0) {
      st = `あと ${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`;
      cls = diff <= 10 ? 'warn' : 'ok';
    } else {
      const d = -diff;
      st = `遅延 +${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
      cls = 'late';
    }
    this._set('status', e.status, st);
    if (this._last.statusCls !== cls) {
      e.status.className = 'status ' + cls;
      this._last.statusCls = cls;
    }
    this._set('wait', e.waiting, s.terminal ? '降車のみ' : `待ち客 ${s.waiting}人`);
    const icons = s.terminal ? '' : '●'.repeat(Math.min(20, s.waiting)) + '○'.repeat(Math.min(20, Math.max(0, s.initialWaiting - s.waiting)));
    this._set('icons', e.waitIcons, icons);
    if (s.leaveIn != null && !s.terminal && s.waiting > 0) {
      this._set('leave', e.leaveWarn, `${Math.ceil(s.leaveIn)}秒後にまた1人帰る…`);
      e.leaveWarn.classList.remove('hidden');
    } else e.leaveWarn.classList.add('hidden');
    this._set('dist', e.dist, s.dist < 1000 ? `${Math.round(s.dist)}m` : `${(s.dist / 1000).toFixed(1)}km`);
    e.arrow.style.transform = `rotate(${s.arrowDeg.toFixed(1)}deg)`;
    this._set('clock', e.clock, formatClock(s.clock));
    const rem = Math.max(0, Math.ceil(s.remain));
    this._set('remain', e.remain, `残り ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`);
    e.remain.classList.toggle('danger', rem <= 30);
    this._set('fare', e.fare, formatYen(s.fare + s.bonus + (s.extra || 0)));
    this._set('fine', e.fine, s.fine > 0 ? formatYen(-s.fine) : '¥0');
    this._set('total', e.total, formatYen(s.fare + s.bonus + (s.extra || 0) - s.fine));
    const kmh = Math.round(s.speedKmh);
    this._set('speed', e.speed, String(kmh));
    e.speedBar.style.transform = `scaleX(${Math.min(1, kmh / 75).toFixed(3)})`;
    this._set('onboard', e.onboard, `乗車 ${s.onboard}/${s.capacity}`);
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 1800);
    setTimeout(() => d.remove(), 2300);
  }

  /** 画面上の位置にふわっと浮かぶテキスト */
  floatText(x, y, text, kind = '') {
    // 浮き文字は上へ 50px ほど昇るので、そのぶん下げる
    y = this._belowBig(y, 85);
    let d = this.floatPool.pop();
    if (!d) {
      d = document.createElement('div');
      d.addEventListener('animationend', () => {
        d.remove();
        this.floatPool.push(d);
      });
    }
    d.className = 'float ' + kind;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el.floats.appendChild(d);
  }

  /** 大きな見出し（定時到着・遅延など）が出ている間は、その帯（画面の上から 22〜52%）にかからないよう y を下げる */
  _belowBig(y, gap) {
    if (!this.el.big.classList.contains('show')) return y;
    const H = this.el.root.clientHeight || window.innerHeight;
    const top = H * 0.22, bottom = H * 0.52;
    return y > top && y < bottom + gap ? bottom + gap : y;
  }

  big(main, sub = '', dur = 1.6, kind = '') {
    const e = this.el;
    e.bigMain.textContent = main;
    e.bigSub.textContent = sub;
    e.big.className = 'bigmsg show ' + kind;
    // アニメーションを再始動
    void e.big.offsetWidth;
    e.big.classList.add('pop');
    clearTimeout(this._bigTimer);
    this._bigTimer = setTimeout(() => e.big.classList.remove('show'), dur * 1000);
  }

  hideBig() {
    clearTimeout(this._bigTimer);
    this.el.big.classList.remove('show');
  }

  dwell(p, label = '乗降中…') {
    const e = this.el;
    if (p == null) {
      e.dwell.classList.add('hidden');
      return;
    }
    e.dwell.classList.remove('hidden');
    e.dwellBar.style.transform = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(3)})`;
    this._set('dwellLabel', e.dwellLabel, label);
  }
}
