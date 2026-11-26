// ハイライト動画：大事故やピタ止めなどの見せ場を、直前から数秒ぶん動画にして残す（X に貼れる素材）。
// 仕組み：ゲーム画面を小さなキャンバスに写して MediaRecorder で録画し続ける。録画は一定時間ごとに区切り直し、
// 2 本を時間をずらして回しておくことで、見せ場が起きたときにはどちらかが「数秒前から」録っている状態にしておく。

// X に貼れるのは H.264 の MP4。H.264 で録れないブラウザは WebM で録る。
// 最後の 'video/mp4'（コーデック指定なし）は Safari 用（Safari は H.264 で録る）
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

const SEGMENT_SEC = 12; // 録画を区切り直す間隔
const LEAD_MIN_SEC = 4; // 見せ場の前に最低これだけ入っていてほしい
const TAIL_SEC = 2.5; // 見せ場のあとに続けて録る秒数
const KEEP = 3; // 残すクリップの数

export function clipsSupported() {
  return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && pickMime());
}

function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch (_) {
      /* 次を試す */
    }
  }
  return null;
}

export class ClipRecorder {
  /**
   * audioStream: ゲーム音の MediaStream（なければ無音）
   * opts.width / height: 録画サイズ、opts.recorders: 同時に回す本数（スマホは 1 本）
   */
  constructor({ audioStream = null, width = 854, height = 480, recorders = 2 } = {}) {
    this.mime = pickMime();
    this.ext = this.mime && this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.audioStream = audioStream;
    this.count = recorders;
    this.slots = [];
    this.clips = [];
    this.pending = null;
    this.active = false;
    this.lastFrame = 0;
  }

  /** 録画を始める（運行の開始時） */
  start(now) {
    this.stop();
    this.clips = [];
    this.pending = null;
    const video = this.canvas.captureStream(30);
    const tracks = [...video.getVideoTracks()];
    if (this.audioStream) tracks.push(...this.audioStream.getAudioTracks());
    this.stream = new MediaStream(tracks);
    this.active = true;
    this.slots = [];
    for (let k = 0; k < this.count; k++) {
      const slot = { rec: null, startedAt: 0, chunks: [], onDone: null };
      this.slots.push(slot);
      // 2 本目は半周期ずらして始める
      if (k === 0) this._begin(slot, now);
      else slot.delayUntil = now + (SEGMENT_SEC / this.count) * k;
    }
  }

  _begin(slot, now) {
    if (!this.active) return;
    let rec;
    try {
      rec = new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 96_000 });
    } catch (_) {
      this.active = false;
      return;
    }
    slot.rec = rec;
    slot.startedAt = now;
    slot.chunks = [];
    slot.delayUntil = 0;
    rec.ondataavailable = (e) => e.data && e.data.size && slot.chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(slot.chunks, { type: this.mime.split(';')[0] });
      const done = slot.onDone;
      slot.onDone = null;
      slot.rec = null;
      if (done) done(blob);
      // 区切り直して録画を続ける
      if (this.active) this._begin(slot, this.now || now);
    };
    rec.start();
  }

  /** 毎フレーム：ゲーム画面を写す（描画の直後に呼ぶこと）。now は秒 */
  frame(src, now) {
    if (!this.active) return;
    this.now = now;
    if (now - this.lastFrame >= 1 / 30 - 0.004) {
      this.lastFrame = now;
      const W = this.canvas.width, H = this.canvas.height;
      const k = Math.max(W / src.width, H / src.height);
      const w = W / k, h = H / k;
      try {
        this.ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, W, H);
      } catch (_) {
        /* 描画できないフレームは飛ばす */
      }
    }
    for (const slot of this.slots) {
      if (!slot.rec && slot.delayUntil && now >= slot.delayUntil) this._begin(slot, now);
      // 見せ場の予約がない録画は、一定時間で区切り直す
      if (slot.rec && !slot.onDone && now - slot.startedAt > SEGMENT_SEC && slot.rec.state === 'recording') slot.rec.stop();
    }
    if (this.pending && now >= this.pending.until) this._cut(now);
  }

  /**
   * 見せ場が起きた。score が高いものほど優先して残す。
   * 少しあとまで録ってから切り出す。
   */
  highlight(label, score, now) {
    if (!this.active) return;
    if (this.pending) {
      // 近い時間の見せ場はひとつにまとめる（高いほうの名前で）
      if (score > this.pending.score) Object.assign(this.pending, { label, score });
      this.pending.until = Math.max(this.pending.until, now + TAIL_SEC);
      return;
    }
    // 残す枠がいっぱいで、今回のほうが低ければ録らない
    if (this.clips.length >= KEEP && score <= Math.min(...this.clips.map((c) => c.score))) return;
    this.pending = { label, score, until: now + TAIL_SEC, at: now };
  }

  _cut(now) {
    const p = this.pending;
    this.pending = null;
    // いちばん長く録っている録画を使う（見せ場の前が長く入っているもの）
    const cands = this.slots.filter((s) => s.rec && s.rec.state === 'recording' && !s.onDone);
    if (!cands.length) return;
    cands.sort((a, b) => a.startedAt - b.startedAt);
    // 前が LEAD_MIN_SEC より短くても、何もないよりは残す
    const slot = cands.find((s) => p.at - s.startedAt >= LEAD_MIN_SEC) || cands[0];
    slot.onDone = (blob) => this._add({ label: p.label, score: p.score, blob, ext: this.ext, sec: Math.round(now - slot.startedAt) });
    slot.rec.stop();
  }

  _add(clip) {
    if (!clip.blob || clip.blob.size < 2000) return;
    this.clips.push(clip);
    this.clips.sort((a, b) => b.score - a.score);
    while (this.clips.length > KEEP) this.clips.pop();
    this.onChange && this.onChange(this.clips);
  }

  /** 運行の終わり：予約中の見せ場を切り出してから止める。終わったら resolve */
  finish(now) {
    return new Promise((resolve) => {
      if (!this.active) return resolve(this.clips);
      if (this.pending) this._cut(now);
      setTimeout(() => {
        this.stop();
        resolve(this.clips);
      }, 400);
    });
  }

  stop() {
    this.active = false;
    for (const slot of this.slots) {
      if (slot.rec && slot.rec.state === 'recording') {
        try {
          slot.rec.stop();
        } catch (_) {
          /* noop */
        }
      }
    }
    this.slots = [];
  }
}

/** 保存（スマホは共有シート、PC はダウンロード） */
export async function saveClip(clip, name = 'genkai-bus-highlight') {
  const file = new File([clip.blob], `${name}.${clip.ext}`, { type: clip.blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: '#限界バス運行' });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancel';
  }
  const url = URL.createObjectURL(clip.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
