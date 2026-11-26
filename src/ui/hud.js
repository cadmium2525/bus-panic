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
  }

  show(on) {
    this.el.root.classList.toggle('hidden', !on);
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
    if (diff >= 0) {
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
    this._set('fare', e.fare, formatYen(s.fare + s.bonus));
    this._set('fine', e.fine, s.fine > 0 ? formatYen(-s.fine) : '¥0');
    this._set('total', e.total, formatYen(s.fare + s.bonus - s.fine));
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
