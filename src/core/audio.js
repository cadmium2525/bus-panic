// 音の再生（BGM・効果音は「かなでる」で作った音源ファイル）と、音声合成の車内アナウンス
//
// ミックス:  効果音 ─┐
//            エンジン ┤→ マスター → 低域カット(35Hz) → コンプ/リミッター → 出力
//            BGM ─(ローシェルフ -2dB)┘
import { AUDIO } from '../audio/manifest.js';

const decode = (ctx, buf) =>
  new Promise((res, rej) => {
    // 古い Safari はコールバック形式のみ
    const p = ctx.decodeAudioData(buf, res, rej);
    if (p && p.then) p.then(res, rej);
  });

/** MP3 のデコーダが頭に入れる無音を検出して読み飛ばす位置（秒） */
function leadOffset(buffer) {
  const n = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.3));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) if (Math.abs(d[i]) > 0.004) return { i, sr: buffer.sampleRate };
  }
  return { i: 0, sr: buffer.sampleRate };
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.bgmVolume = 0.6;
    this.sfxVolume = 0.9;
    this.announce = true;
    this.buffers = new Map(); // name → { buffer, offset }
    this.raw = new Map(); // name → Promise<ArrayBuffer>
    this.playing = new Map(); // name → 同時再生数
    this.bgm = null;
    this.loops = {};
    this.ready = false;
    this._ducked = 1;
  }

  /** 音源ファイルの取得を先に始めておく（デコードは unlock 後） */
  prefetch(names) {
    for (const name of names) {
      if (this.raw.has(name)) continue;
      const url = this._url(name);
      if (!url) continue;
      this.raw.set(name, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url)))).catch(() => null));
    }
  }

  _url(name) {
    const [kind, key] = name.split(':');
    if (kind === 'bgm') return AUDIO.bgm[key]?.file;
    if (kind === 'jingle') return AUDIO.jingle[key]?.file;
    if (kind === 'loop') return AUDIO.loops[key]?.file;
    return AUDIO.sfx[key];
  }

  /** 読み込む順番：タイトル曲 → 効果音 → ループ音 → 走行中の曲 → その他 */
  static allNames() {
    const names = [
      'bgm:title',
      ...Object.keys(AUDIO.sfx).map((k) => 'sfx:' + k),
      ...Object.keys(AUDIO.loops).map((k) => 'loop:' + k),
      'bgm:drive',
      'bgm:rush',
      ...Object.keys(AUDIO.jingle).map((k) => 'jingle:' + k),
      ...Object.keys(AUDIO.bgm).map((k) => 'bgm:' + k),
    ];
    return [...new Set(names)];
  }

  /** 初回のユーザー操作で呼ぶ */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 35;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      this.master.connect(hp).connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 120;
      shelf.gain.value = -2;
      this.bgmBus = ctx.createGain();
      this.bgmBus.gain.value = this.bgmVolume;
      this.bgmBus.connect(shelf).connect(this.master);
      this.prefetch(Audio.allNames());
      this._loadAll();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try {
      if (window.speechSynthesis && !this._ttsPrimed) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
        this._ttsPrimed = true;
      }
    } catch (_) {
      /* noop */
    }
  }

  async _loadAll() {
    // 効果音 → ループ → ジングル → BGM の順に使えるようにする
    for (const name of Audio.allNames()) {
      if (this.buffers.has(name)) continue;
      try {
        const ab = await this.raw.get(name);
        if (!ab) continue;
        const buffer = await decode(this.ctx, ab.slice(0));
        const isWav = /\.wav$/.test(this._url(name));
        const off = isWav ? { i: 0, sr: buffer.sampleRate } : leadOffset(buffer);
        this.buffers.set(name, { buffer, offset: off.i / off.sr });
        const w = this._waiting && this._waiting.get(name);
        if (w) {
          this._waiting.delete(name);
          w();
        }
      } catch (_) {
        /* 読めない音は鳴らさない */
      }
    }
    this.ready = true;
  }

  _whenLoaded(name, fn) {
    if (this.buffers.has(name)) return fn();
    if (!this._waiting) this._waiting = new Map();
    this._waiting.set(name, fn);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setBgmVolume(v) {
    this.bgmVolume = v;
    if (this.bgmBus) this.bgmBus.gain.setTargetAtTime(v * this._ducked, this.ctx.currentTime, 0.05);
  }
  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get ok() {
    return !!this.ctx && this.volume > 0;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  /** ポーズ中など：BGM を小さく、エンジン音を止める */
  duck(on) {
    this._ducked = on ? 0.35 : 1;
    if (this.bgmBus) this.bgmBus.gain.setTargetAtTime(this.bgmVolume * this._ducked, this.ctx.currentTime, 0.15);
    if (on) {
      for (const k of ['engine', 'skid', 'crossing', 'train']) this.setLoopGain(k, 0);
    }
  }

  /**
   * 効果音を鳴らす。opts: { volume, rate, pan, delay, max }
   * max: 同じ音の同時再生数の上限（連打で音が割れないように）
   */
  play(key, opts = {}) {
    if (!this.ok) return;
    const name = 'sfx:' + key;
    const b = this.buffers.get(name);
    if (!b) return;
    const max = opts.max ?? 4;
    const cur = this.playing.get(name) || 0;
    if (cur >= max) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b.buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let node = src.connect(g);
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node = node.connect(p);
    }
    node.connect(this.sfxBus);
    this.playing.set(name, cur + 1);
    src.onended = () => this.playing.set(name, Math.max(0, (this.playing.get(name) || 1) - 1));
    src.start(ctx.currentTime + (opts.delay || 0), b.offset);
  }

  // ---------------- BGM ----------------
  /** BGM を切り替える（同じ曲なら何もしない）。key: title / drive / result */
  playBgm(key, { fade = 0.8 } = {}) {
    if (!this.ctx) return;
    if (this.bgm && this.bgm.key === key) return;
    this.stopBgm(fade);
    const want = { key };
    this.bgm = want;
    const layers = key === 'drive' ? ['drive', 'rush'] : [key];
    const go = () => {
      if (this.bgm !== want) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + 0.05;
      const base = this.buffers.get('bgm:' + layers[0]);
      want.nodes = layers.map((k, i) => {
        const b = this.buffers.get('bgm:' + k);
        const src = ctx.createBufferSource();
        src.buffer = b.buffer;
        src.loop = true;
        // 層どうしの頭をそろえるため、基準の層の頭出し位置を使う
        const off = base.offset;
        src.loopStart = off;
        src.loopEnd = Math.min(b.buffer.duration, off + AUDIO.bgm[k].loop);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(i === 0 ? 1 : 0, t + fade);
        src.connect(g).connect(this.bgmBus);
        src.start(t, off);
        return { src, g };
      });
      want.rush = 0;
    };
    // すべての層が読めてから同時に始める
    let left = layers.length;
    for (const k of layers) this._whenLoaded('bgm:' + k, () => --left === 0 && go());
  }

  stopBgm(fade = 0.6) {
    const cur = this.bgm;
    this.bgm = null;
    if (!cur || !cur.nodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const { src, g } of cur.nodes) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      src.stop(t + fade + 0.05);
    }
  }

  /** 遅延時の層（0〜1） */
  setRush(x) {
    const b = this.bgm;
    if (!b || b.key !== 'drive' || !b.nodes || !b.nodes[1]) return;
    if (Math.abs((b.rush ?? 0) - x) < 0.01) return;
    b.rush = x;
    b.nodes[1].g.gain.setTargetAtTime(x, this.ctx.currentTime, 0.6);
  }

  /** ジングル（BGM バスで 1 回だけ） */
  jingle(key, { volume = 1 } = {}) {
    if (!this.ok) return;
    const b = this.buffers.get('jingle:' + key);
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b.buffer;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.bgmBus);
    src.start(this.ctx.currentTime, b.offset);
    return b.buffer.duration - b.offset;
  }

  // ---------------- ループ音（エンジン・タイヤ） ----------------
  startLoop(key) {
    if (!this.ctx || this.loops[key]) return;
    const b = this.buffers.get('loop:' + key);
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b.buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = AUDIO.loops[key].loop;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.sfxBus);
    src.start();
    this.loops[key] = { src, g };
  }
  stopLoop(key) {
    const l = this.loops[key];
    if (!l) return;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(0, t, 0.05);
    l.src.stop(t + 0.3);
    delete this.loops[key];
  }
  setLoopGain(key, v, rate) {
    const l = this.loops[key];
    if (!l) return;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(v, t, 0.06);
    if (rate != null) l.src.playbackRate.setTargetAtTime(rate, t, 0.08);
  }

  startEngine() {
    this.startLoop('engine');
    this.startLoop('skid');
    this.startLoop('crossing');
    this.startLoop('train');
  }
  /** 踏切の警報音と電車の音（距離 m で小さくなる。電車は近づくと音程が少し上がる） */
  updateRail(warnDist, trainDist, approach = 0) {
    if (!this.loops.crossing) return;
    const fall = (d, near, far) => (d <= near ? 1 : d >= far ? 0 : Math.pow(1 - (d - near) / (far - near), 1.6));
    this.setLoopGain('crossing', 0.42 * fall(warnDist, 12, 110));
    this.setLoopGain('train', 0.55 * fall(trainDist, 10, 140), 1 + Math.max(-0.06, Math.min(0.06, approach * 0.004)));
  }
  updateEngine(speed, throttle, skid = 0) {
    if (!this.loops.engine) this.startEngine();
    const rpm = Math.min(1, speed / 20);
    this.setLoopGain('engine', 0.16 + rpm * 0.1 + (throttle ? 0.07 : 0), 0.78 + rpm * 1.05 + (throttle ? 0.1 : 0));
    this.setLoopGain('skid', Math.min(0.5, skid * 0.5), 0.9 + Math.min(0.3, speed / 60));
  }
  stopEngine() {
    for (const k of ['engine', 'skid', 'crossing', 'train']) this.stopLoop(k);
  }

  // ---------------- 車内アナウンス（音声合成・任意） ----------------
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
