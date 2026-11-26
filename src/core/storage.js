// localStorage: 自己ベストと設定のみ保存（使えない環境でも落ちないように）
const KEY_SETTINGS = 'genkai-bus:settings:v1';
const KEY_BEST = 'genkai-bus:best:v1';

export const DEFAULT_SETTINGS = {
  volume: 0.8,
  bgmVolume: 0.6,
  sfxVolume: 0.9,
  ghost: true,
  hints: true,
  quality: 'auto', // auto | low | mid | high
  announce: true,
  touch: 'auto', // auto | on | off
  minimap: true,
};

function read(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}
function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(KEY_SETTINGS) || {}) };
}
export function saveSettings(s) {
  return write(KEY_SETTINGS, s);
}

export function loadBest() {
  return read(KEY_BEST);
}

/** スコアが自己ベストなら保存して true */
export function submitBest(result) {
  const best = loadBest();
  if (best && best.total >= result.total) return false;
  write(KEY_BEST, { total: result.total, rank: result.rank, date: new Date().toISOString(), stops: result.stopsServed, damage: result.damage });
  return true;
}
