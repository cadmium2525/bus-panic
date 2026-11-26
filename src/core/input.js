// キーボードとタッチ操作を同じ入力状態に統合する
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, accel: false, brake: false };
    this.pressed = new Set(); // 1フレームだけ立つ（R, Esc など）
    this._pointers = new Map(); // pointerId -> control name
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this._isGameKey(e.code)) e.preventDefault();
        return;
      }
      // 設定画面のスライダーなどを操作中はゲーム入力にしない
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this._isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  _isGameKey(code) {
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code);
  }

  /** タッチ操作レイヤーを登録。data-ctl 属性を持つ要素がボタン */
  bindTouchLayer(layer) {
    const update = () => {
      const t = { left: false, right: false, accel: false, brake: false };
      for (const name of this._pointers.values()) if (name && name in t) t[name] = true;
      this.touch = t;
      for (const el of layer.querySelectorAll('[data-ctl]')) el.classList.toggle('active', !!t[el.dataset.ctl]);
    };
    const ctlAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const b = el && el.closest ? el.closest('[data-ctl]') : null;
      return b && layer.contains(b) ? b.dataset.ctl : null;
    };
    const down = (e) => {
      const name = ctlAt(e.clientX, e.clientY);
      if (!name) return;
      e.preventDefault();
      this._pointers.set(e.pointerId, name);
      try {
        layer.setPointerCapture(e.pointerId);
      } catch (_) {
        /* noop */
      }
      update();
    };
    const move = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      e.preventDefault();
      // 指を滑らせて隣のボタンへ移れる
      const name = ctlAt(e.clientX, e.clientY);
      this._pointers.set(e.pointerId, name);
      update();
    };
    const up = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      update();
    };
    layer.addEventListener('pointerdown', down, { passive: false });
    layer.addEventListener('pointermove', move, { passive: false });
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
    layer.addEventListener('lostpointercapture', up);
    // iOS のスクロール・拡大を抑止
    layer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    layer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this._touchUpdate = update;
  }

  releaseAll() {
    this.keys.clear();
    this._pointers.clear();
    this.touch = { left: false, right: false, accel: false, brake: false };
    if (this._touchUpdate) this._touchUpdate();
  }

  /** 運転入力（-1..1 のステア、+ が右） */
  drive() {
    const k = this.keys;
    const t = this.touch;
    const left = k.has('KeyA') || k.has('ArrowLeft') || t.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || t.right;
    return {
      throttle: k.has('KeyW') || k.has('ArrowUp') || t.accel,
      brake: k.has('KeyS') || k.has('ArrowDown') || t.brake,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: k.has('Space'),
    };
  }

  consume(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this.pressed.clear();
  }
}
