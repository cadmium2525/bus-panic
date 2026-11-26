// シェア用のリザルト画像（1200×630）を作って、共有シートまたはダウンロードで渡す
import { formatYen } from '../game/rules.js';

const JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

export function resultImage(r) {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // 背景
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f2a1d');
  bg.addColorStop(1, '#101722');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 道路とバス停のイラスト風の帯
  g.fillStyle = '#2b2f36';
  g.fillRect(0, H - 120, W, 120);
  g.fillStyle = '#f0c330';
  for (let x = 20; x < W; x += 90) g.fillRect(x, H - 64, 50, 8);
  drawBus(g, 860, H - 205, 1.25);

  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffd23f';
  g.font = `900 30px ${JP}`;
  g.fillText('ブラウザ3Dバカゲー', 60, 78);
  g.fillStyle = '#ffffff';
  g.font = `900 72px ${JP}`;
  g.fillText('限界バス運行！', 60, 156);
  g.font = `700 26px ${JP}`;
  g.fillStyle = 'rgba(255,255,255,0.8)';
  let sub = r.reason === 'clear' ? (r.allStopsBonus ? '全停留所制覇！ 終点到着' : '終点到着') : '時間切れ… 途中終了';
  if (r.mode === 'rampage') sub = '🦖 暴走モード';
  else if (r.daily) sub = `📅 日替わり ${r.daily.key.slice(5).replace('-', '/')}（${r.daily.picks.map((p) => p.name).join('＋')}）｜${sub}`;
  g.fillText(sub, 62, 200);

  // ランク
  const rx = 70, ry = 240;
  const rg = g.createRadialGradient(rx + 60, ry + 50, 10, rx + 85, ry + 85, 110);
  rg.addColorStop(0, r.rank === 'C' || r.rank === 'D' ? '#d6dde6' : '#fff3b0');
  rg.addColorStop(1, r.rank === 'C' || r.rank === 'D' ? '#7c8794' : '#f2a900');
  g.fillStyle = rg;
  roundRect(g, rx, ry, 170, 170, 30);
  g.fill();
  g.fillStyle = '#3b2600';
  g.font = `900 130px ${JP}`;
  g.textAlign = 'center';
  g.fillText(r.rank, rx + 85, ry + 132);
  g.textAlign = 'left';

  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `700 26px ${JP}`;
  g.fillText(r.mode === 'rampage' ? '破壊点' : '総合スコア', 280, 280);
  g.fillStyle = '#ffd23f';
  g.font = `900 84px ${JP}`;
  g.fillText(`${r.total.toLocaleString('ja-JP')}点`, 276, 362);
  g.fillStyle = '#ffffff';
  g.font = `700 24px ${JP}`;
  const onTime = r.stops.filter((s) => s.delay != null && s.delay <= 0).length;
  const hits = r.counts.cone + r.counts.sign + r.counts.guardrail + r.counts.car;
  const lines = r.mode === 'rampage'
    ? [`壊した数 ${r.rampage.destroyed}個　最大 ${r.rampage.maxChain} コンボ`, `最高速度 ${r.maxSpeedKmh}km/h`]
    : [
        `運賃 ${formatYen(r.fare)}　定時 ${onTime}/${r.stops.length}　最大 ${r.maxCombo} コンボ`,
        `ピタッ！ ${r.pita.perfect}回　罰金 ${formatYen(-(r.damage + r.other))}　ぶつけた物 ${hits}個`,
      ];
  lines.forEach((t, i) => g.fillText(t, 280, 404 + i * 34));
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `500 18px ${JP}`;
  g.fillText('#限界バス運行', 62, H - 140);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawBus(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-10, 96, 280, 10);
  g.fillStyle = '#f7f5ee';
  roundRect(g, 0, 0, 260, 100, 14);
  g.fill();
  g.fillStyle = '#22313c';
  for (let k = 0; k < 5; k++) g.fillRect(14 + k * 44, 14, 36, 34);
  g.fillRect(232, 14, 20, 60);
  g.fillStyle = '#1f8a4c';
  g.fillRect(0, 62, 260, 10);
  g.fillStyle = '#f2b705';
  g.fillRect(0, 74, 260, 4);
  g.fillStyle = '#111';
  g.fillRect(60, 2, 120, 9);
  g.fillStyle = '#ff9a1f';
  g.font = `700 8px ${JP}`;
  g.fillText('限界駅 行', 100, 10);
  g.fillStyle = '#161616';
  for (const wx of [55, 205]) {
    g.beginPath();
    g.arc(wx, 100, 18, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#9aa3a8';
  for (const wx of [55, 205]) {
    g.beginPath();
    g.arc(wx, 100, 8, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 共有シート（対応端末）またはダウンロード */
export async function shareResult(r) {
  const canvas = resultImage(r);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'error';
  const file = new File([blob], 'genkai-bus-result.png', { type: 'image/png' });
  const mode = r.mode === 'rampage' ? '暴走モード ' : r.daily ? `日替わり${r.daily.key.slice(5).replace('-', '/')} ` : '';
  const text = `限界バス運行！ ${mode}ランク${r.rank}・${r.total.toLocaleString('ja-JP')}点 #限界バス運行`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancel';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'genkai-bus-result.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
