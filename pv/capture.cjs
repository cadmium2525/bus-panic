// PV 用のゲーム映像を撮影する（ゲームを 1 コマずつ進めて画面を保存 → ffmpeg で MP4 に）
//   npx vite preview --port 4173 &   （先に npm run build）
//   node pv/capture.cjs [shot名 ...]
// 出力: pv/build/media/<shot>.mp4 と <shot>.json（その映像の中で鳴った効果音の時刻）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FPS = 30;
const OUT = path.join(__dirname, 'build', 'media');
const TMP = path.join(__dirname, 'build', 'frames');
fs.mkdirSync(OUT, { recursive: true });

// HUD の見せ方: full（そのまま）/ clean（パネルを隠し、罰金表示や吹き出しは残す）/ none（すべて隠す）
const SHOTS = {
  // 他車に追突して吹っ飛ばす（つかみ）
  crash: {
    sec: 3.6, hud: 'clean',
    setup: `
      // 川沿いの道（東向き車線）に止まっている車を置き、後ろからバスで突っ込む
      const T = g.traffic;
      const na = T.nodes.find((n) => n.r === 27 && n.c === 3), nb = T.nodes.find((n) => n.r === 27 && n.c === 20);
      const car = T.cars.find((c) => c.type === 'sedan') || T.cars[0];
      const line = T._lineFor(na, nb);
      Object.assign(car, { from: na, to: nb, pieces: [line], piece: 0, dist: 70, cruise: 0, speed: 0, state: 'drive', solid: true });
      T._place(car); car.px = car.x; car.pz = car.z; car.ph = car.h;
      for (const o of T.cars) if (o !== car && Math.abs(o.z - car.z) < 30 && Math.abs(o.x - car.x) < 80) T.spawn(o, { x: car.x, z: car.z, r: 90 });
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      g.bus.reset(car.x - fx * 24, car.z - fz * 24, car.h);
      g.bus.vx = fx * 18; g.bus.vz = fz * 18;
      g.camOverride = { yaw: -78, dist: 13, height: 3.6, lookAhead: 8, fov: 50, spin: 6 };
      run.onboard = 24; g.bus.setOnboard(24, 60);
      keys.add('KeyW');
    `,
  },
  // 停留所にピタッと止めて定時コンボ → 乗車（銀座商店街。標準の自動運転で正確に止める）
  stop: {
    sec: 8.5, hud: 'full', auto: 'on',
    setup: `
      run.stops[0].status = 'done'; run.next = 1; g._setMarker(g.stops[1]);
      const s = g.stops[1];
      run.t = s.scheduled - 9; run.onboard = 6; g.bus.setOnboard(6, 60);
      run.combo = 4; run.maxCombo = 4;
      g.bus.reset(s.target.x - s.travel.x * 46, s.target.z - s.travel.z * 46, Math.atan2(s.travel.x, s.travel.z));
      g.bus.vx = s.travel.x * 11; g.bus.vz = s.travel.z * 11;
    `,
  },
  // 遅れると待ち客が帰っていく（市民病院前）
  leave: {
    sec: 4.0, hud: 'full',
    setup: `
      const K = 8, s = g.stops[K];
      for (let k = 0; k < K; k++) run.stops[k].status = 'done';
      run.next = K; g._setMarker(s);
      run.t = s.scheduled + 3; run.onboard = 30; g.bus.setOnboard(30, 60);
      g.bus.reset(s.target.x - s.travel.x * 40, s.target.z - s.travel.z * 40, Math.atan2(s.travel.x, s.travel.z));
      g.bus.vx = s.travel.x * 5; g.bus.vz = s.travel.z * 5;
      // 停留所の待ち客を斜め前から写す固定カメラ（少しずつ横に動く）
      const p = s.pole, cd = s.curbDir, tv = s.travel;
      g.camOverride = {
        pos: [p.x - cd.x * 9.5 - tv.x * 9, 2.4, p.z - cd.z * 9.5 - tv.z * 9],
        look: [p.x - tv.x + cd.x * 0.5, 1.1, p.z - tv.z + cd.z * 0.5],
        drift: [tv.x * 0.9, tv.z * 0.9], fov: 50,
      };
    `,
    frame: `
      if (f === 18) run.t += 30;
      if (f === 54) run.t += 20;
      if (f === 84) run.t += 10;
    `,
  },
  // 商店街の路地を蛇行して看板・植木鉢をなぎ倒す
  alley: {
    sec: 4.2, hud: 'full',
    setup: `
      g.bus.reset(12.5 * 8, 4.2 * 8, 0); g.bus.vz = 13;
      g.camOverride = { pos: [100, 5, 50], look: [100, 1.4, 34], fov: 52, follow: 20 };
      run.onboard = 20; g.bus.setOnboard(20, 60);
      keys.add('KeyW');
    `,
    frame: `
      // カメラは路地の中央線上でバスの 17m 先から見返す
      g.camOverride.pos = [100, 5.2, g.bus.z + 17];
      g.camOverride.look = [100, 1.3, g.bus.z - 1];
      const ph = Math.floor((f + 6) / 16) % 2;
      keys.delete('KeyA'); keys.delete('KeyD');
      if (f > 4) keys.add(ph ? 'KeyA' : 'KeyD');
    `,
  },
  // 川沿いのガードレールをなぎ倒して川へドボン（A 通りと B 通りの間の土手）
  river: {
    sec: 3.8, hud: 'clean',
    setup: `
      g.camOverride = { yaw: -128, dist: 18, height: 4.5, lookAhead: 4, fov: 52, follow: 3 };
      g.bus.reset(70, 225.5, Math.PI / 2 - 0.42);
      g.bus.vx = Math.sin(Math.PI / 2 - 0.42) * 18; g.bus.vz = Math.cos(Math.PI / 2 - 0.42) * 18;
      run.onboard = 28; g.bus.setOnboard(28, 60);
      keys.add('KeyW');
    `,
    frame: `if (f === 40) keys.add('KeyA'); if (f === 70) keys.delete('KeyA');`,
  },
  // 遮断機を突破して電車にはね飛ばされる（B 通りの踏切）
  train: {
    sec: 5.2, hud: 'clean', hideBig: true,
    setup: `
      const R = g.railway;
      R.timer = 999;
      const t = R.trains.find((tr) => tr.dir === 1);
      // 電車の先頭が、バスが線路に着く頃に踏切へ来るように置く
      t.active = true; t.x = 167.2 - 21 * 1.9; t.mesh.visible = true; t.mesh.position.set(t.x, 0, t.z);
      R.update(0.01);
      for (const c of R.crossings) c.gate = c.warn ? 0.9 : 0;
      g.bus.reset(168.5, 386, 0); g.bus.vz = 9;
      run.onboard = 26; g.bus.setOnboard(26, 60);
      // バスの後ろ（北）から踏切を見る。はね飛ばされたバスがこちらへ飛んでくる
      g.camOverride = { pos: [175.5, 6.5, 365], look: [169, 1.6, 403], drift: [0, -0.9], fov: 50 };
    `,
  },
  // 駅前ロータリーでサイドブレーキ・ドリフト
  drift: {
    sec: 3.8, hud: 'clean',
    setup: `
      g.camOverride = { yaw: -55, dist: 17, height: 9, lookAhead: 0, lookY: 0.5, fov: 55, follow: 3.5 };
      g.bus.reset(41.5 * 8, 44.8 * 8, Math.PI / 2); g.bus.vx = 17;
      run.onboard = 32; g.bus.setOnboard(32, 60);
      keys.add('KeyW');
    `,
    frame: `
      if (f === 8) { keys.add('Space'); keys.add('KeyA'); }
      if (f === 70) { keys.delete('Space'); }
      if (f === 95) { keys.delete('KeyA'); }
    `,
  },
  // 結果発表（運行停止処分）
  result: {
    sec: 5.6, hud: 'full', skip: 2.3,
    setup: `
      g.bus.reset(46 * 8, 45.5 * 8, Math.PI / 2);
      for (const s of run.stops) s.status = 'done';
      run.fare = 18250; run.bonus = 2000; run.next = 14;
      const L = run.ledger;
      for (let k = 0; k < 9; k++) L.charge('c' + k, 'cone', 200, 'コーン');
      for (let k = 0; k < 4; k++) L.charge('s' + k, 'sign', 1000, '看板');
      for (let k = 0; k < 3; k++) L.charge('r' + k, 'guardrail', 2000, 'ガードレール');
      for (let k = 0; k < 2; k++) L.charge('v' + k, 'car', 3000, '他車');
      L.chargeEvent('brake', 300, '急ブレーキ'); L.chargeEvent('brake', 300, '急ブレーキ');
      L.chargeEvent('impact', 500, '乗客転倒');
      g._finish('clear');
    `,
  },
  // エンディングの背景：街の空撮（タイトル画面のカメラ）
  ending: {
    sec: 6.0, hud: 'none',
    setup: `
      g.state = 'title';
      g.time = 2.0;
    `,
  },
};

const HUD_CSS = {
  full: '',
  clean: '#hud .panel, #hud .hud-tc, #hud .hud-tr, #toasts, #hint, #dwell, #touch { display: none !important; }',
  none: '#hud { display: none !important; }',
};

(async () => {
  const want = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (want.length && !want.includes(name)) continue;
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    // ヒント・ゴーストは撮らない
    await ctx.addInitScript(() => {
      localStorage.setItem('genkai-bus:settings:v1', JSON.stringify({ quality: 'high', hints: false, ghost: false, minimap: true, touch: 'off' }));
      localStorage.setItem('genkai-bus:hints:v1', JSON.stringify({ start: 1, stopZone: 1, late: 1, penalty: 1, stuck: 1, brake: 1 }));
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(name, 'pageerror', e.message));
    await page.goto(`http://localhost:4173/?capture${shot.auto ? `&autopilot=${shot.auto === true ? 'fast' : shot.auto}` : ''}`);
    await page.waitForFunction(() => window.__game && window.__step);
    await page.addStyleTag({ content: HUD_CSS[shot.hud] + (shot.hideBig ? ' .bigmsg { display:none !important; }' : '') + ' .bigmsg.count, #loading { display:none !important; }' });
    // 運行開始（カウントダウンは飛ばす）
    await page.evaluate((code) => {
      const g = window.__game;
      g.startRun();
      const run = g.run;
      run.countdown = 0;
      g.state = 'playing';
      g.hud.hideBig();
      const keys = g.input.keys;
      window.__keys = keys;
      new Function('g', 'run', 'keys', code)(g, run, keys);
      g._camSnap = true;
      window.__step(2);
      g.captureLog.length = 0;
    }, shot.setup);
    // 結果画面などは最初の数秒を飛ばす
    if (shot.skip) await page.evaluate((n) => window.__step(n), Math.round(shot.skip * FPS));
    const dir = path.join(TMP, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const frames = Math.round(shot.sec * FPS);
    const startFrame = await page.evaluate(() => window.__game.captureFrame);
    for (let f = 0; f < frames; f++) {
      await page.evaluate(([code, f]) => {
        const g = window.__game;
        if (code) new Function('g', 'run', 'keys', 'f', code)(g, g.run, window.__keys, f);
        window.__step(1);
      }, [shot.frame || '', f]);
      await page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    const log = await page.evaluate((sf) => window.__game.captureLog.map((e) => ({ ...e, t: (e.frame - sf - 1) / 30 + e.delay })).filter((e) => e.t >= 0), startFrame);
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(log, null, 1));
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', path.join(OUT, `${name}.mp4`)], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    console.log(`${name}: ${frames} コマ, 効果音 ${log.length} 個, ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
    await ctx.close();
  }
  await browser.close();
})();
