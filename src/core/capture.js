// PV 撮影用：ページ内の時計（setTimeout・requestAnimationFrame・performance.now・CSS アニメ）を
// ゲームのコマ送りに合わせる。?capture のときだけ読み込む。
export function installVirtualClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map(); // id → { due, fn, args }
  let rafs = [];
  const realNow = performance.now.bind(performance);
  const base = realNow();

  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = seq++;
    timers.set(id, { due: now + Math.max(0, ms), fn, args });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = seq++;
    rafs.push({ id, fn });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafs = rafs.filter((r) => r.id !== id);
  };
  performance.now = () => base + now;

  /** 時計を ms 進める（期限の来たタイマー・rAF を実行し、CSS アニメを同じだけ進める） */
  return function advance(ms) {
    now += ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.due <= now && (!next || t.due < next[1].due)) next = [id, t];
      if (!next) break;
      timers.delete(next[0]);
      try {
        next[1].fn(...next[1].args);
      } catch (e) {
        console.error(e);
      }
    }
    const cur = rafs;
    rafs = [];
    for (const r of cur) {
      try {
        r.fn(base + now);
      } catch (e) {
        console.error(e);
      }
    }
    if (document.getAnimations) {
      for (const a of document.getAnimations()) {
        if (a._vt == null) {
          a._vt = 0;
          a.pause();
        }
        a._vt += ms;
        a.currentTime = a._vt;
      }
    }
  };
}
