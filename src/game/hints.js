// 初めて遊ぶ人向けのヒント（一度見たものは表示しない）
const KEY = 'genkai-bus:hints:v1';

export const HINTS = {
  start: 'アクセル（W / ↑ / 右下のボタン）で発車！ 最初の停留所はすぐそこです',
  stopZone: '光っている枠の中で止まろう（5km/h 以下）。乗降が終わるまで発車できません',
  late: '定刻を過ぎると 10 秒ごとに待ち客が 1 人帰ります。地図の黄色い点線が大通りのおすすめルート',
  penalty: 'ぶつけると罰金！ 路地は近道ですが障害物だらけ。急ブレーキも乗客に怒られます',
  stuck: '動けなくなったら R キー（右上の ↺）で路面に戻れます（¥1,000）',
  brake: 'ブレーキは長く踏むほど強くなります。早めに軽く踏むと急ブレーキになりません',
};

function read() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export class Hints {
  constructor() {
    this.seen = read();
  }
  /** まだ見ていなければ文言を返して既読にする */
  take(id) {
    if (this.seen[id] || !HINTS[id]) return null;
    this.seen[id] = 1;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.seen));
    } catch (_) {
      /* noop */
    }
    return HINTS[id];
  }
  reset() {
    this.seen = {};
    try {
      window.localStorage.removeItem(KEY);
    } catch (_) {
      /* noop */
    }
  }
}
