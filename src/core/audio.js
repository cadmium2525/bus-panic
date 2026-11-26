// Web Audio で合成する効果音（音源ファイル不要）と、音声合成の車内アナウンス
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.announce = true;
    this.engine = null;
    this._noiseBuf = null;
  }

  /** 初回ユーザー操作時に呼ぶ */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.0;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // iOS の音声合成は操作直後に一度鳴らすと以後使える
    try {
      if (window.speechSynthesis && !this._ttsPrimed) {
        const u = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(u);
        this._ttsPrimed = true;
      }
    } catch (_) {
      /* noop */
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() {
    return !!this.ctx && this.volume > 0;
  }

  _env(node, t, a, peak, dcy, sus = 0.0001) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dcy);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    this._env(o, t, 0.005, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.3, freq = 1000, q = 0.7, type = 'lowpass', at = 0, sweep = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    src.connect(f);
    this._env(f, t, 0.004, vol, dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---- 効果音 ----
  sfxCone() {
    this.tone(520 + Math.random() * 200, 0.12, { type: 'triangle', vol: 0.25, slide: 0.6 });
    this.noise(0.08, { vol: 0.12, freq: 2500 });
  }
  sfxSign() {
    this.tone(260, 0.25, { type: 'square', vol: 0.12, slide: 0.5 });
    this.noise(0.25, { vol: 0.25, freq: 1800, type: 'bandpass', q: 3 });
  }
  sfxGuardrail() {
    this.noise(0.5, { vol: 0.35, freq: 900, type: 'bandpass', q: 6, sweep: 0.6 });
    this.tone(180, 0.6, { type: 'sawtooth', vol: 0.1, slide: 0.7 });
    this.tone(1320, 0.4, { type: 'triangle', vol: 0.05, slide: 0.9 });
  }
  sfxCar() {
    this.noise(0.6, { vol: 0.5, freq: 700, sweep: 0.3 });
    this.tone(90, 0.5, { type: 'sine', vol: 0.5, slide: 0.5 });
    this.noise(0.4, { vol: 0.2, freq: 3000, type: 'highpass', at: 0.05 });
  }
  sfxWall(strength = 1) {
    const v = Math.min(0.5, 0.15 + strength * 0.03);
    this.noise(0.35, { vol: v, freq: 500, sweep: 0.4 });
    this.tone(70, 0.3, { type: 'sine', vol: v, slide: 0.6 });
  }
  sfxSplash() {
    this.noise(0.8, { vol: 0.3, freq: 1500, sweep: 0.3 });
  }
  sfxCoin() {
    this.tone(1318, 0.08, { type: 'square', vol: 0.06 });
    this.tone(1760, 0.18, { type: 'square', vol: 0.06, at: 0.07 });
  }
  sfxChime() {
    // ピンポーン
    this.tone(1046, 0.5, { type: 'sine', vol: 0.25 });
    this.tone(830, 0.9, { type: 'sine', vol: 0.25, at: 0.38 });
  }
  sfxDoor() {
    this.noise(0.9, { vol: 0.18, freq: 3500, type: 'highpass', sweep: 0.5 });
  }
  sfxHorn() {
    this.tone(415, 0.35, { type: 'square', vol: 0.06 });
    this.tone(523, 0.35, { type: 'square', vol: 0.05 });
  }
  sfxBusHorn() {
    this.tone(311, 0.5, { type: 'sawtooth', vol: 0.09 });
    this.tone(392, 0.5, { type: 'sawtooth', vol: 0.08 });
  }
  sfxClick() {
    this.tone(880, 0.05, { type: 'square', vol: 0.05 });
  }
  sfxCount(final = false) {
    this.tone(final ? 1320 : 660, final ? 0.5 : 0.15, { type: 'square', vol: 0.12 });
  }
  sfxPenalty() {
    this.tone(330, 0.12, { type: 'square', vol: 0.08 });
    this.tone(247, 0.25, { type: 'square', vol: 0.08, at: 0.1 });
  }
  sfxFanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, { type: 'square', vol: 0.08, at: i * 0.12 }));
  }

  // ---- エンジン音（連続） ----
  startEngine() {
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(this.master);
    o1.start();
    o2.start();
    this.engine = { o1, o2, f, g };
  }
  updateEngine(speed, throttle) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + Math.min(1, speed / 20) * 0.6 + (throttle ? 0.15 : 0);
    const base = 32 + rpm * 70;
    this.engine.o1.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engine.f.frequency.setTargetAtTime(250 + rpm * 600, t, 0.1);
    this.engine.g.gain.setTargetAtTime(0.05 + (throttle ? 0.05 : 0) + rpm * 0.04, t, 0.1);
  }
  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0, t, 0.05);
    e.o1.stop(t + 0.3);
    e.o2.stop(t + 0.3);
    this.engine = null;
  }

  // ---- 車内アナウンス（音声合成・任意） ----
  say(text) {
    if (!this.announce || this.volume <= 0) return;
    const ss = window.speechSynthesis;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.15;
      u.pitch = 1.05;
      u.volume = Math.min(1, this.volume * 1.2);
      const v = ss.getVoices().find((x) => /ja[-_]JP/i.test(x.lang));
      if (v) u.voice = v;
      ss.speak(u);
    } catch (_) {
      /* noop */
    }
  }
}
