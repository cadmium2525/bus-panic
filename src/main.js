// エントリーポイント
import { Game } from './game/game.js';
import { Hud } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Screens } from './ui/screens.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadSettings } from './core/storage.js';
import { createStops } from './game/stops.js';
import { installVirtualClock } from './core/capture.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (_) {
    return false;
  }
}

function preventBrowserGestures() {
  // ダブルタップ拡大・ピンチ・スクロールを抑止（設定画面などのスクロールは許可）
  const scrollable = (el) => el && el.closest && el.closest('.scroll');
  document.addEventListener('touchmove', (e) => {
    if (!scrollable(e.target)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (!scrollable(e.target)) e.preventDefault();
  });
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300 && !e.target.closest('button, select, input, summary')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
}

function boot() {
  const loading = document.getElementById('loading');
  if (!webglAvailable()) {
    loading.classList.add('done');
    document.getElementById('screen-title').classList.add('hidden');
    document.getElementById('nowebgl').classList.remove('hidden');
    return;
  }
  preventBrowserGestures();
  const params = new URLSearchParams(location.search);
  // PV 撮影モード：時計をコマ送りに合わせる
  const advanceClock = params.has('capture') ? installVirtualClock() : null;
  const settings = loadSettings();
  if (params.get('quality')) settings.quality = params.get('quality');
  const audio = new Audio();
  audio.setVolume(settings.volume);
  audio.setBgmVolume(settings.bgmVolume);
  audio.setSfxVolume(settings.sfxVolume);
  audio.announce = settings.announce;
  // 音源の取得は早めに始める（再生は最初の操作のあと）
  audio.prefetch(['bgm:title', 'sfx:ui_click', 'sfx:ui_ok', 'sfx:ui_back', 'sfx:count', 'sfx:go']);
  const input = new Input();
  const hud = new Hud();
  const ui = new Screens({ settings, audio });
  input.bindTouchLayer(document.getElementById('touch'));
  const minimap = new Minimap(document.getElementById('minimap'), createStops());

  let game;
  try {
    game = new Game({
      canvas: document.getElementById('game'),
      hud,
      minimap,
      input,
      audio,
      settings,
      ui,
      debug: {
        autopilot: params.has('autopilot') ? params.get('autopilot') || 'main' : null,
        timescale: parseFloat(params.get('timescale')) || 0,
        fixedFrame: parseFloat(params.get('fixedframe')) || 0,
        startStop: parseInt(params.get('startstop'), 10) || 0,
        capture: params.has('capture'),
        advanceClock,
      },
    });
  } catch (err) {
    console.error(err);
    loading.classList.add('done');
    document.getElementById('screen-title').classList.add('hidden');
    document.getElementById('nowebgl').classList.remove('hidden');
    return;
  }
  ui.attach(game);
  window.__game = game; // 動作確認用
  if (params.has('debug')) import('./ui/share.js').then((m) => (window.__resultImage = m.resultImage));

  // タブ切替・画面オフで自動ポーズ
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });
  window.addEventListener('pagehide', () => game.pause());
  window.addEventListener('blur', () => {
    if (game.state === 'playing') game.pause();
  });

  requestAnimationFrame(() => {
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 500);
  });
  // 最初の操作で音を有効にし、タイトル曲を流す（ブラウザの自動再生制限のため）
  const firstTouch = () => {
    audio.unlock();
    if (game.state === 'title') audio.playBgm('title', { fade: 1.5 });
    window.removeEventListener('pointerdown', firstTouch, true);
    window.removeEventListener('keydown', firstTouch, true);
  };
  window.addEventListener('pointerdown', firstTouch, true);
  window.addEventListener('keydown', firstTouch, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else if (game.state !== 'paused') audio.resume();
  });

  if (params.has('autostart')) game.startRun();
}

boot();
