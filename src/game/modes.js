// 遊び方のモード（通常運行・日替わりチャレンジ・暴走モード）と、運行ごとの条件（ハプニングの数など）

/** 決まった種から同じ乱数列を作る（日替わりは全員同じ条件になる） */
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 通常運行の条件 */
export function defaultMods() {
  return {
    comboMult: 1, // 定時ボーナスの倍率
    pitaMult: 1, // ピタ止めボーナスの倍率
    fineMult: 1, // 罰金の倍率
    waitMult: 1, // 待ち客の人数の倍率
    tipMult: 1, // チップの倍率
    hurry: 3, // 急ぎの客の人数
    closures: 1, // 工事の通行止めの数
    rivals: 2, // ライバルバスが現れる回数
    trainPeriod: 34, // 電車の間隔（秒）
    brakeMult: 1,
    speedMult: 1,
    accelMult: 1,
  };
}

/** 日替わりの条件の候補 */
export const DAILY_MODS = [
  { id: 'rush', icon: '🧑‍🤝‍🧑', name: '通勤ラッシュ', desc: '待ち客が 1.5 倍', apply: (m) => (m.waitMult = 1.5) },
  { id: 'fine2', icon: '💸', name: '罰金2倍デー', desc: 'ぶつけたときの罰金が 2 倍', apply: (m) => (m.fineMult = 2) },
  { id: 'combo2', icon: '⏰', name: '定時ボーナス2倍', desc: '定時コンボのボーナスが 2 倍', apply: (m) => (m.comboMult = 2) },
  { id: 'hurry', icon: '🏃', name: '急ぎの客だらけ', desc: '急ぎの客が 6 人、チップ 1.5 倍', apply: (m) => { m.hurry = 6; m.tipMult = 1.5; } },
  { id: 'works', icon: '🚧', name: '工事だらけ', desc: '通行止めが 4 か所', apply: (m) => (m.closures = 4) },
  { id: 'rival', icon: '🚌', name: 'ライバル猛攻', desc: 'ライバルバスが 4 回現れる', apply: (m) => (m.rivals = 4) },
  { id: 'brake', icon: '🛑', name: 'ブレーキ不調', desc: 'ブレーキの効きが 7 割', apply: (m) => (m.brakeMult = 0.7) },
  { id: 'turbo', icon: '🚀', name: 'ターボ搭載', desc: '最高速と加速が 1.25 倍', apply: (m) => { m.speedMult = 1.25; m.accelMult = 1.25; } },
  { id: 'trains', icon: '🚃', name: '踏切地獄', desc: '電車が 2 倍の頻度で来る', apply: (m) => (m.trainPeriod = 17) },
  { id: 'pita3', icon: '🎯', name: 'ピタ止め祭り', desc: 'ピタ止めボーナスが 3 倍', apply: (m) => (m.pitaMult = 3) },
];

const pad = (n) => String(n).padStart(2, '0');
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 今日のチャレンジ（日付から 2 つの条件を選ぶ） */
export function dailyChallenge(d = new Date()) {
  const key = dateKey(d);
  let seed = 2166136261;
  for (const ch of key) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = seededRandom(seed);
  const pool = DAILY_MODS.slice();
  const picks = [];
  while (picks.length < 2) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const mods = defaultMods();
  for (const p of picks) p.apply(mods);
  return { key, seed, picks, mods };
}

export const MODES = {
  normal: { id: 'normal', label: '通常運行' },
  daily: { id: 'daily', label: '日替わりチャレンジ' },
  rampage: { id: 'rampage', label: '暴走モード' },
};
