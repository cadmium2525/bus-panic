// 実績（やりこみ要素）。端末の localStorage に保存する
const KEY = 'genkai-bus:achievements:v1';

export const ACHIEVEMENTS = [
  { id: 'first', icon: '🚌', name: '初運行', desc: '終点の限界駅にたどり着く' },
  { id: 'allstops', icon: '🗺️', name: '全停留所制覇', desc: '15 か所すべてで乗降して終点へ' },
  { id: 'ontime', icon: '⏰', name: '定時運行の鬼', desc: '全停留所に定時で到着する' },
  { id: 'clean', icon: '🕊️', name: '無事故無違反', desc: '罰金・ペナルティ 0 円で終点へ' },
  { id: 'rankA', icon: '🥈', name: '敏腕ドライバー', desc: 'ランク A 以上を取る' },
  { id: 'rankS', icon: '👑', name: '伝説の運転手', desc: 'ランク S を取る' },
  { id: 'fare', icon: '💴', name: '運賃王', desc: '1 回の運行で運賃 ¥35,000 以上' },
  { id: 'justintime', icon: '🎯', name: 'ギリギリセーフ', desc: '定刻ちょうど（1 秒以内）に到着する' },
  { id: 'full', icon: '🧑‍🤝‍🧑', name: '満員御礼', desc: '乗客を 45 人以上乗せて走る' },
  { id: 'speed', icon: '💨', name: '限界突破', desc: '時速 72km に到達する' },
  { id: 'alleys', icon: '🐈', name: '路地裏マスター', desc: '1 回の運行で 6 本の路地をすべて通る' },
  { id: 'dobon', icon: '🌊', name: 'ドボン', desc: '何かを川に落とす' },
  { id: 'rails', icon: '🚧', name: 'ガードレール・ブレイカー', desc: '1 回の運行でガードレールを 10 本壊す' },
  { id: 'cars', icon: '💥', name: '渋滞の元凶', desc: '1 回の運行で他の車に 5 回ぶつかる' },
  { id: 'destroyer', icon: '😈', name: '破壊神', desc: '1 回の運行で罰金 ¥30,000 以上' },
  { id: 'drift', icon: '🌀', name: 'バスでドリフト', desc: 'サイドブレーキで 3 秒以上横滑りする' },
  { id: 'combo10', icon: '🔥', name: '定時コンボ 10', desc: '10 停留所つづけて定時に到着する' },
  { id: 'pitamaster', icon: '📏', name: 'ピタ止め職人', desc: '1 回の運行で「ピタッ！」停車を 6 回きめる' },
  { id: 'rival', icon: '🏁', name: 'ライバル撃破', desc: 'ギリギリ交通より先に停留所へ着く' },
  { id: 'tipking', icon: '💰', name: 'チップ長者', desc: '1 回の運行で急ぎのお客さんを 3 人間に合わせる' },
  { id: 'daily', icon: '📅', name: '日替わり完走', desc: '日替わりチャレンジで終点にたどり着く' },
  { id: 'rampage', icon: '🦖', name: '怪獣バス', desc: '暴走モードで 100,000 点以上' },
];

function read() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export function loadAchievements() {
  return read();
}

/** 新しく解除したら true */
export function unlockAchievement(id) {
  const all = read();
  if (all[id]) return false;
  all[id] = new Date().toISOString();
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch (_) {
    /* 保存できなくてもゲームは続ける */
  }
  return true;
}

export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** 運行終了時の判定（結果からわかるもの） */
export function achievementsForResult(r) {
  const out = [];
  const clear = r.reason === 'clear';
  if (r.mode === 'rampage') return r.total >= 100000 ? ['rampage'] : [];
  if (clear) out.push('first');
  if (clear && r.allStopsBonus > 0) out.push('allstops');
  if (clear && r.stops.every((s) => s.status === 'done' && s.onTime)) out.push('ontime');
  if (clear && r.damage + r.other === 0) out.push('clean');
  if (r.rank === 'S' || r.rank === 'A') out.push('rankA');
  if (r.rank === 'S') out.push('rankS');
  if (r.fare >= 35000) out.push('fare');
  if (r.counts.guardrail >= 10) out.push('rails');
  if (r.counts.car >= 5) out.push('cars');
  if (r.damage >= 30000) out.push('destroyer');
  return out;
}
