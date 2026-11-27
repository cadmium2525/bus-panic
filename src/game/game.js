// ゲーム本体: 描画・ループ・状態遷移・停留所処理・スコア
import * as THREE from 'three';
import { RULES, PENALTY, QUALITY, PHYSICS_DT, BUS, RAMPAGE, INTRO } from '../config.js';
import { buildCity } from '../world/city.js';
import { createSky } from '../world/sky.js';
import { MeshBuilder } from '../world/meshBuilder.js';
import { busStopPlateTexture, labelTexture } from '../world/textures.js';
import { Props } from '../entities/props.js';
import { Bus } from '../entities/bus.js';
import { Traffic } from '../entities/traffic.js';
import { Passengers } from '../entities/passengers.js';
import { createStops, inZone, START, stopError, approachPath, legPath, legSeconds, headingDir, courseSchedule } from './stops.js';
import { remainingPassengers, resolveStop, dwellTime, computeScore, rankFor, PenaltyLedger, formatClock, comboBonus, pitaGrade, rampageMultiplier, makiBonus } from './rules.js';
import { Railway } from '../entities/railway.js';
import { planClosures, planHurry, planRivals, Rival, spotBehind } from './happenings.js';
import { defaultMods, dailyChallenge, seededRandom, MODES } from './modes.js';
import { SpatialHash } from '../core/collision.js';
import { TILE, N, T, tileAt, isDrivableType, solidRectForTile, shortestPath, tileCenter, H_ROADS, V_ROADS, ALLEYS, RAIL } from '../world/map.js';
import { Autopilot } from './autopilot.js';
import { Effects } from '../entities/effects.js';
import { GhostRecorder, GhostBus, loadGhost } from './ghost.js';
import { Hints } from './hints.js';
import { unlockAchievement, achievementById, achievementsForResult } from './achievements.js';
import { loadBest } from '../core/storage.js';
import { ClipRecorder, clipsSupported } from '../core/clips.js';

// 乗客のひとこと
const VOICES = {
  turn: ['うわぁっ！', 'ひぃっ', 'つり革〜！', '曲がりすぎ！'],
  fast: ['飛ばしすぎ！', 'こわい…', '速っ！'],
  hit: ['あっ…', 'なにか轢いた？', 'ちょっと！'],
  car: ['ぎゃああ！', '事故った！？', '保険〜！'],
  rail: ['ガードレールが！', '川に落ちる〜！'],
  ontime: ['定刻だ！', 'さすが！', '間に合った〜'],
  late: ['遅いよ〜', '会社に遅れる！', 'もう歩こうかと…'],
  brake: ['おっとっと', '急ブレーキ！', 'あぶなっ'],
  splash: ['ドボンって…', '川に落ちたぞ'],
  hurry: ['会社に遅刻しそう！', '急いでください！', '会議に間に合わない！'],
  thanks: ['助かった！', 'ありがとう運転手さん！', '間に合った！'],
  pita: ['ピタッと止まった！', 'うまい！', '職人技…'],
  crossing: ['踏切〜！', '止まって！', '電車来てる！'],
};
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

const FOG_COLOR = 0xd7e7f2;

export function resolveQuality(q) {
  if (q && q !== 'auto' && QUALITY[q]) return q;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'mid';
}

export class Game {
  constructor({ canvas, hud, minimap, input, audio, settings, ui, debug = {} }) {
    this.canvas = canvas;
    this.hud = hud;
    this.input = input;
    this.audio = audio;
    this.settings = settings;
    this.ui = ui;
    this.debug = debug;
    this.state = 'title';
    this.qualityKey = resolveQuality(settings.quality);
    this.q = QUALITY[this.qualityKey];
    this.time = 0;

    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(FOG_COLOR);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 30, this.q.fogFar);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.4, this.q.fogFar + 40);

    // 光源
    this.hemi = new THREE.HemisphereLight(0xe6f0ff, 0x8f8470, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    this.sun.position.set(-60, 110, 40);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 300;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 世界
    this.stops = createStops();
    for (const st of this.stops) st.baseScheduled = st.scheduled; // 通常の時刻表（モードや通行止めで書き換えても戻せるように）
    this.city = buildCity(this.scene, { decorDensity: this.q.decorDensity, stops: this.stops });
    this.sky = createSky(this.scene);
    this.staticHash = new SpatialHash(16);
    for (const c of this.city.colliders.circles) this.staticHash.insertAABB(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);

    this._makeProps();
    this.effects = new Effects(this.scene, { lowQuality: this.qualityKey === 'low' });
    this.ghost = new GhostBus(this.scene);
    this.hints = new Hints();
    this.timeScale = 1;
    this.slowmo = 0;
    this.bus = new Bus(this.scene);
    this.traffic = new Traffic(this.scene, this.city.intersections, {
      count: this.q.cars,
      onHit: (car, t) => this._onCarHit(car, t),
      onHonk: (car) => {
        if (this.state === 'playing' && Math.hypot(car.x - this.bus.x, car.z - this.bus.z) < 40) this.audio.play('honk', { volume: 0.45 });
      },
    });
    this.passengers = new Passengers(this.scene, 300);
    this.railway = new Railway(this.scene, this.city.crossings, { period: 34 });
    this.traffic.railway = this.railway;
    this.rival = new Rival(this.scene);
    this.rival.railway = this.railway;
    this.rival.traffic = this.traffic;
    this.rival.player = this.bus;
    this.traffic.extraBuses = [this.rival];
    this._buildStopVisuals();
    this._buildMarker();
    this._buildHurryMarkers();

    this.minimap = minimap;
    const ap = debug.autopilot;
    this.autopilot = ap
      ? new Autopilot(
          ap.includes('fast')
            ? { alleys: ap.includes('alley'), cruise: 19.5, turnSpeed: 8.5, decel: 7.2 }
            : ap.includes('careful')
              ? { alleys: ap.includes('alley'), cruise: 12.5, turnSpeed: 5.5, decel: 4.5 } // 慎重な人（時速 45km）
              : { alleys: ap.includes('alley') },
        )
      : null;
    if (this.autopilot && !ap.includes('wild')) {
      this.autopilot.railway = this.railway;
      this.autopilot.traffic = this.traffic;
    }

    this.applyQuality(this.qualityKey);
    this._resetWorld();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());

    this._acc = 0;
    this._last = performance.now();
    this._lastRender = 0;
    this._loop = this._loop.bind(this);
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), shake: 0, fov: 60 };
    // 撮影モード（PV 用）：自動では進めず、外から 1 コマずつ進める
    if (debug.capture) {
      this.captureLog = [];
      const play = audio.play.bind(audio);
      audio.play = (key, opts = {}) => {
        this.captureLog.push({ key, frame: this.captureFrame || 0, volume: opts.volume ?? 1, delay: opts.delay || 0 });
        return play(key, opts);
      };
      window.__step = (n = 1, dt = 1 / 30) => {
        for (let i = 0; i < n; i++) {
          this.captureFrame = (this.captureFrame || 0) + 1;
          if (debug.advanceClock) debug.advanceClock(dt * 1000);
          this.frame(dt);
        }
        return this.captureFrame;
      };
    } else requestAnimationFrame(this._loop);
  }

  /** シェア画像の背景用の 1200×630 の canvas。運行中のいちばんの見せ場があればその画面、なければいまの画面 */
  snapshot() {
    try {
      let src = this._bestShot && this._bestShot.canvas;
      if (!src) {
        this.renderer.render(this.scene, this.camera);
        src = this.renderer.domElement;
      }
      const W = 1200, H = 630;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const k = Math.max(W / src.width, H / src.height);
      const w = W / k, h = H / k;
      c.getContext('2d').drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, W, H);
      return c;
    } catch (_) {
      return null;
    }
  }

  // ---------------- 設定 ----------------
  applyQuality(key) {
    this.qualityKey = resolveQuality(key);
    this.q = QUALITY[this.qualityKey];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dprCap));
    const shadows = this.q.shadows;
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) m.needsUpdate = true;
        }
      });
    }
    this.sun.castShadow = shadows;
    this.props.setShadows(shadows);
    this.traffic.setShadows(shadows);
    this.bus.setShadowMode(shadows);
    this.scene.fog.far = this.q.fogFar;
    this.scene.fog.near = Math.min(60, this.q.fogFar * 0.25);
    this.camera.far = this.q.fogFar + 40;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height : window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.viewW = w;
    this.viewH = h;
  }

  // ---------------- 停留所の見た目 ----------------
  _buildStopVisuals() {
    const mb = new MeshBuilder();
    const marks = new MeshBuilder();
    const plateTex = busStopPlateTexture();
    const plateGeo = new THREE.CircleGeometry(0.42, 20);
    const plateMat = new THREE.MeshLambertMaterial({ map: plateTex, emissive: 0x222222, side: THREE.DoubleSide });
    for (const s of this.stops) {
      const { x, z } = s.pole;
      mb.cylinder(x, 0.15, z, 0.06, 2.6, '#c7ccd0', 6);
      mb.box(x - 0.35, 0.15, z - 0.35, x + 0.35, 0.3, z + 0.35, '#5f6468');
      // 時刻表
      const ax = s.along.x, az = s.along.z;
      mb.box(x - 0.25 + ax * 0.1, 1.2, z - 0.25 + az * 0.1, x + 0.25 + ax * 0.1, 1.9, z + 0.25 + az * 0.1, '#f4f4f4');
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(x, 2.55, z);
      plate.rotation.y = Math.atan2(s.along.x, s.along.z);
      this.scene.add(plate);
      // 屋根付き待合所（一部）
      if (s.index % 3 === 1 || s.terminal) {
        const cx = s.curbDir.x, cz = s.curbDir.z;
        const bx = x + cx * 0.6 - ax * 3.5, bz = z + cz * 0.6 - az * 3.5;
        const len = 3.2;
        const x0 = Math.min(bx - ax * len, bx + ax * len) - Math.abs(cx) * 0.5;
        const x1 = Math.max(bx - ax * len, bx + ax * len) + Math.abs(cx) * 0.5;
        const z0 = Math.min(bz - az * len, bz + az * len) - Math.abs(cz) * 0.5;
        const z1 = Math.max(bz - az * len, bz + az * len) + Math.abs(cz) * 0.5;
        mb.box(x0, 2.4, z0, x1, 2.55, z1, '#1f8a4c');
        mb.box(x0 + Math.abs(cz) * 0.1 + Math.abs(cx) * 0.0, 0.15, z0, x0 + 0.1 + Math.abs(cx) * 0.9, 2.4, z0 + 0.1 + Math.abs(cz) * 0.9, '#9aa3a8');
        mb.box(x1 - 0.1 - Math.abs(cx) * 0.9, 0.15, z1 - 0.1 - Math.abs(cz) * 0.9, x1, 2.4, z1, '#9aa3a8');
      }
      // 路面の停留所枠（黄色）
      const zn = s.zone;
      const Y = 0.025, w = 0.22, col = '#f0c330';
      const fl = (xa, za, xb, zb) => marks.quad([xa, Y, zb], [xb, Y, zb], [xb, Y, za], [xa, Y, za], col);
      const X0 = zn.cx - zn.hx + 0.3, X1 = zn.cx + zn.hx - 0.3, Z0 = zn.cz - zn.hz + 0.3, Z1 = zn.cz + zn.hz - 0.3;
      fl(X0, Z0, X1, Z0 + w);
      fl(X0, Z1 - w, X1, Z1);
      fl(X0, Z0, X0 + w, Z1);
      fl(X1 - w, Z0, X1, Z1);
      // 「バス」の代わりに斜線
      const along = zn.hx > zn.hz;
      for (let k = -2; k <= 2; k++) {
        if (along) fl(zn.cx + k * 2.4 - 0.12, Z0 + 1.2, zn.cx + k * 2.4 + 0.12, Z1 - 1.2);
        else fl(X0 + 1.2, zn.cz + k * 2.4 - 0.12, X1 - 1.2, zn.cz + k * 2.4 + 0.12);
      }
      // ピタ止めの白枠（ここにバスをぴったり止める）
      const tg = s.target;
      const hl = BUS.length / 2 + 0.25, hw = BUS.width / 2 + 0.2, ww = 0.16, white = '#f4f4f4';
      const wl = (xa, za, xb, zb) => marks.quad([xa, Y + 0.004, zb], [xb, Y + 0.004, zb], [xb, Y + 0.004, za], [xa, Y + 0.004, za], white);
      const ax2 = Math.abs(s.along.x) > 0.5;
      const PX0 = tg.x - (ax2 ? hl : hw), PX1 = tg.x + (ax2 ? hl : hw);
      const PZ0 = tg.z - (ax2 ? hw : hl), PZ1 = tg.z + (ax2 ? hw : hl);
      // 角だけ描く（L 字 × 4）＋中央の十字
      const c = 1.6;
      for (const [cx0, cz0, sx, sz] of [[PX0, PZ0, 1, 1], [PX1, PZ0, -1, 1], [PX0, PZ1, 1, -1], [PX1, PZ1, -1, -1]]) {
        wl(Math.min(cx0, cx0 + sx * c), Math.min(cz0, cz0 + sz * ww), Math.max(cx0, cx0 + sx * c), Math.max(cz0, cz0 + sz * ww));
        wl(Math.min(cx0, cx0 + sx * ww), Math.min(cz0, cz0 + sz * c), Math.max(cx0, cx0 + sx * ww), Math.max(cz0, cz0 + sz * c));
      }
      if (ax2) wl(tg.x - 0.09, PZ0 + 0.5, tg.x + 0.09, PZ1 - 0.5);
      else wl(PX0 + 0.5, tg.z - 0.09, PX1 - 0.5, tg.z + 0.09);
    }
    const m1 = new THREE.Mesh(mb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m1.castShadow = true;
    this.scene.add(m1);
    const m2 = new THREE.Mesh(marks.build(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.scene.add(m2);
  }

  _buildMarker() {
    const g = new THREE.Group();
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.28, depthWrite: false });
    const zone = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), zoneMat);
    zone.renderOrder = 2;
    g.add(zone);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x8dffb9, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true), beamMat);
    beam.position.y = 30;
    beam.renderOrder = 3;
    g.add(beam);
    // 下向き矢印
    const arrowGeo = new THREE.ConeGeometry(1.1, 2.2, 4);
    arrowGeo.rotateX(Math.PI);
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    g.add(arrow);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    label.scale.set(9, 2.8, 1);
    label.renderOrder = 5;
    g.add(label);
    this.scene.add(g);
    this.marker = { group: g, zone, zoneMat, beam, arrow, label, stopIndex: -1 };
  }

  _setMarker(stop) {
    const m = this.marker;
    if (!stop) {
      m.group.visible = false;
      m.stopIndex = -1;
      return;
    }
    m.group.visible = true;
    if (m.stopIndex === stop.index) return;
    m.stopIndex = stop.index;
    const zn = stop.zone;
    m.zone.scale.set(zn.hx * 2 - 0.6, 0.6, zn.hz * 2 - 0.6);
    m.zone.position.set(zn.cx, 0.3, zn.cz);
    // 光の柱と矢印はピタ止めの位置（バスの中心をここに）
    const tg = stop.target || { x: zn.cx, z: zn.cz };
    m.beam.position.set(tg.x, 30, tg.z);
    m.arrow.position.set(tg.x, 6.5, tg.z);
    if (m.label.material.map) m.label.material.map.dispose();
    m.label.material.map = labelTexture([stop.terminal ? '終点' : `次は ${stop.index + 1}番`, stop.name]);
    m.label.material.needsUpdate = true;
    m.label.position.set(zn.cx, 9.5, zn.cz);
  }

  // ---------------- 状態遷移 ----------------
  _resetWorld() {
    this.bus.reset(START.x, START.z, START.heading);
    this.traffic.spawnAll({ x: START.x, z: START.z, r: 60 });
    this.passengers.populate(this.stops);
    this.rival.stop();
    this.run = null;
    this._setMarker(null);
    if (this.hurryMarks) for (const m of this.hurryMarks) m.visible = false;
  }

  // 急ぎの客がいる停留所の目印
  _buildHurryMarkers() {
    const tex = labelTexture(['急ぎの客', '早く運んで！'], { accent: '#ff8a3d', bg: 'rgba(120,30,10,0.85)' });
    this.hurryMarks = this.stops.map((s) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.set(4.4, 1.4, 1);
      sp.position.set(s.pole.x, 4.2, s.pole.z);
      sp.visible = false;
      this.scene.add(sp);
      return sp;
    });
  }

  _updateHurryMarkers() {
    const run = this.run;
    this.hurryMarks.forEach((m, i) => {
      m.visible = !!run && run.hurry.some((h) => h.from === i && h.state === 'waiting');
    });
  }

  startRun(mode = this.lastMode || 'normal') {
    this.audio.unlock();
    this.mode = mode;
    this.lastMode = mode;
    const daily = mode === 'daily' ? dailyChallenge() : null;
    const mods = daily ? daily.mods : defaultMods();
    if (mode === 'rampage' || mode === 'intro') Object.assign(mods, { closures: 0, hurry: 0, rivals: 0 });
    const intro = mode === 'intro';
    // このモードで回る停留所（入門コースは一部だけ）
    const course = intro ? INTRO.course.slice() : this.stops.map((s) => s.index);
    const seed = daily ? daily.seed : this.debug.seed || (Math.random() * 4294967296) >>> 0;
    const rnd = seededRandom(seed);
    // ハプニングの準備（工事の通行止めは小物として置く）
    const closures = planClosures(this.traffic.nodes, this.stops, START, rnd, mods.closures);
    const extra = closures.flatMap((c) => c.spawns);
    this._rebuildProps(extra);
    this.traffic.setClosed(closures.map((c) => [c.a, c.b]));
    this._resetWorld();
    this.railway.reset();
    this.railway.setPeriod(mods.trainPeriod);
    this.bus.tuning = { brake: mods.brakeMult, speed: mods.speedMult, accel: mods.accelMult };
    const detour = this._applySchedule(new Set(closures.flatMap((c) => c.seg.tiles)));
    if (intro) courseSchedule(this.stops, course).forEach((t, k) => (this.stops[course[k]].scheduled = t));
    const lastStop = this.stops[this.stops.length - 1];
    const rampage = mode === 'rampage';
    this.run = {
      t: 0,
      mode,
      mods,
      daily,
      course,
      stops: this.stops.map((s) => {
        const off = !rampage && !course.includes(s.index);
        const base = rampage || off ? 0 : s.terminal ? 0 : Math.round(s.wait * mods.waitMult);
        return { status: off ? 'off' : 'pending', arrival: null, result: null, boarded: 0, dwell: 0, elapsed: 0, base, shown: base, stolen: 0 };
      }),
      next: 0,
      onboard: 0,
      fare: 0,
      bonus: 0,
      combo: 0,
      maxCombo: 0,
      skill: 0,
      maki: 0,
      makiLegs: 0,
      depT: 0,
      tips: 0,
      pita: { perfect: 0, great: 0, good: 0, miss: 0 },
      hurry: planHurry(this.stops, rnd, mods.hurry),
      hurryDone: 0,
      rivalAt: planRivals(this.stops, rnd, mods.rivals),
      rivalWins: 0,
      rivalLosses: 0,
      closures,
      blocked: new Set(closures.flatMap((c) => c.seg.tiles)),
      crossingFines: 0,
      rampage: rampage ? { points: 0, chain: 0, lastHitT: -99, maxChain: 0, destroyed: 0, lastKind: '' } : null,
      ledger: new PenaltyLedger(),
      limit: rampage ? RAMPAGE.seconds : lastStop.scheduled + (intro ? INTRO.timeLimitMarginSec : RULES.timeLimitMarginSec),
      impactCd: 0,
      countdown: 3.4,
      lastCount: 4,
      serving: -1,
      terminalHold: 0,
      finished: false,
      resets: 0,
      maxSpeed: 0,
      brakeCd: 0,
      hardBrakeT: 0,
      brakeWarned: 0,
      stillT: 0,
      voiceCd: 0,
      fastCd: 0,
      chimed: new Set(),
      alleys: new Set(),
      driftT: 0,
      stuckT: 0,
      exhaustT: 0,
      dustT: 0,
      warned: false,
      lastTick: -1,
      unlocked: [],
      recorder: new GhostRecorder(),
    };
    // 区間ごとの想定走行時間（巻きボーナス用。通行止めの遠回りも含める）
    course.forEach((i, k) => {
      const ps = k ? this.stops[course[k - 1]] : null;
      const s = this.stops[i];
      const p = legPath(ps, s, this.run.blocked) || legPath(ps, s, this.run.blocked, true) || legPath(ps, s);
      this.run.stops[i].legPlan = legSeconds(p, s);
    });
    this.passengers.populate(this.stops, this.run.stops.map((x) => x.base));
    if (this.autopilot) this.autopilot.blocked = this.run.blocked;
    this.rival.blocked = this.run.blocked;
    this._updateHurryMarkers();
    this.effects.clear();
    this.ghost.setData(mode === 'normal' && this.settings.ghost !== false ? loadGhost() : null);
    this.bus.setOnboard(0, RULES.capacity);
    // デバッグ: 途中の停留所から開始
    const from = this.debug.startStop | 0;
    if (!rampage && !intro && from > 0 && from < this.stops.length) {
      const ps = this.stops[from - 1];
      const hd = { N: Math.PI / 2, S: -Math.PI / 2, E: 0, W: Math.PI }[ps.curb];
      this.bus.reset(ps.zone.cx, ps.zone.cz, hd);
      for (let k = 0; k < from; k++) this.run.stops[k].status = 'done';
      this.run.next = from;
      this.run.t = this.stops[from - 1].scheduled;
      this.run.depT = this.run.t;
    }
    this._startClips();
    this.state = 'countdown';
    this.hud.show(true);
    this.hud.setMode(mode, daily);
    this.ui.showScreen(null);
    this._setMarker(rampage ? null : this.stops[this.run.next]);
    this.audio.stopBgm(0.5);
    this.audio.startEngine();
    this.audio.play('count');
    if (rampage) this.audio.say('暴走モード。2分間、好きなだけ壊してください。');
    else this.audio.say('ご乗車ありがとうございます。このバスは、げんかいえき行きです。');
    // 本日の運行情報
    if (!rampage) {
      const info = [];
      if (daily) info.push(`日替わり：${daily.picks.map((p) => p.name).join('＋')}`);
      if (closures.length) info.push(`工事で通行止め ${closures.length} か所（地図の ✕）${detour > 0 ? `・時刻表を ${detour} 秒延長` : ''}`);
      if (this.run.hurry.length) info.push(`急ぎの客 ${this.run.hurry.length} 人`);
      if (this.run.rivalAt.length) info.push('ライバル会社が出没中');
      // 発車直後は画面がにぎやかなので、最初の停留所で止まっている間に知らせる
      this.run.infoQueue = info;
    }
    this._camSnap = true;
  }

  // ---------------- ハイライト動画 ----------------
  _clipsWanted() {
    if (this.debug.capture || !clipsSupported()) return false;
    const s = this.settings.clips || 'auto';
    if (s === 'off') return false;
    if (s === 'on') return true;
    // 自動：PC（マウス操作）だけ。スマホは重くなりやすいので録らない
    return !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  _startClips() {
    this.lastClips = [];
    this._bestShot = null;
    this._shotReq = null;
    if (this.clips) this.clips.stop();
    if (!this._clipsWanted()) {
      this.clips = null;
      return;
    }
    if (!this.clips) {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      this.clips = new ClipRecorder({ audioStream: this.audio.captureStream(), width: coarse ? 640 : 854, height: coarse ? 360 : 480, recorders: coarse ? 1 : 2 });
    }
    this.clips.start(performance.now() / 1000);
  }

  /** 見せ場（score が高いものほど残る） */
  _highlight(label, score, tail, shotDelay = 0.15, kind = label) {
    if (this.state !== 'playing') return;
    const now = performance.now() / 1000;
    if (this.clips) this.clips.highlight(label, score, now, tail, kind);
    if (!this._bestShot || score > this._bestShot.score) {
      if (!this._shotReq || score > this._shotReq.score) this._shotReq = { score, at: now + shotDelay };
    }
  }

  /** コースで i の次に回る停留所 */
  _nextInCourse(i) {
    const c = this.run.course;
    const k = c.indexOf(i);
    return k >= 0 && k + 1 < c.length ? c[k + 1] : this.stops.length - 1;
  }

  /** 通行止めで遠回りになる区間は、その分だけ時刻表を後ろにずらす（戻り値：延長した秒数） */
  _applySchedule(blocked) {
    let add = 0;
    this.stops.forEach((s, i) => {
      if (s.baseScheduled == null) s.baseScheduled = s.scheduled;
      if (blocked.size) {
        const ps = this.stops[i - 1];
        const a = legPath(ps, s);
        const b = legPath(ps, s, blocked) || legPath(ps, s, blocked, true);
        if (a && b) add += Math.max(0, legSeconds(b, s) - legSeconds(a, s));
      }
      s.scheduled = s.baseScheduled + Math.round(add / 5) * 5;
    });
    return Math.round(add / 5) * 5;
  }

  _rebuildProps(extra = []) {
    // 前回の破損状態をリセット
    for (const m of this.props.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.props.material.dispose();
    this.props.atlas.dispose();
    this._makeProps(extra);
  }

  _makeProps(extra = []) {
    // 工事の通行止めなど、その運行だけの小物を足す
    const spawns = {};
    for (const [k, v] of Object.entries(this.city.spawns)) spawns[k] = v.slice();
    for (const e of extra) (spawns[e.type] || (spawns[e.type] = [])).push({ x: e.x, z: e.z, rot: e.rot || 0, variant: 0 });
    this.props = new Props(this.scene, spawns, { onHit: (it, t) => this._onPropHit(it, t), shadows: this.q.shadows });
    this.props.onSplash = (it) => {
      this.audio.play('splash');
      this.effects.splash(it.x, it.z);
      this._floatWorld(it.x, -1, it.z, 'ドボン！', 'splash');
      if (this.state === 'playing') {
        this._voice('splash');
        this._unlock('dobon');
        this._highlight('ドボン！', 70, 4, 0.6);
      }
    };
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    this.input.releaseAll();
    this.audio.duck(true);
    this.audio.play('ui_pause');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this._pausedFrom || 'playing';
    this.audio.resume();
    this.audio.duck(false);
    this.ui.showScreen(null);
    this._last = performance.now();
  }

  toTitle() {
    this.state = 'title';
    if (this.clips) this.clips.stop();
    this.audio.stopEngine();
    this.audio.duck(false);
    this.audio.playBgm('title');
    this.effects.clear();
    this.ghost.setData(null);
    this.hud.show(false);
    this.hud.hideBig();
    this.hud.dwell(null);
    this._rebuildProps();
    this._resetWorld();
    this.ui.showScreen('title');
  }

  _finish(reason) {
    const run = this.run;
    if (!run || run.finished) return;
    run.finished = true;
    this.state = 'result';
    this.audio.stopEngine();
    this.audio.stopBgm(0.3);
    this.ghost.setData(null);
    this.hud.dwell(null);
    this.hud.pitaGuide(null);
    this.hud.speedLines(0);
    const allStops = reason === 'clear' && run.stops.every((s) => s.status === 'done' || s.status === 'off');
    const ledger = run.ledger;
    const damage = ledger.total((it) => ['cone', 'sign', 'guardrail', 'car'].includes(it.kind));
    const other = ledger.total((it) => ['reset', 'impact', 'brake', 'crossing', 'train'].includes(it.kind));
    const score = run.rampage
      ? { total: run.rampage.points, fare: 0, onTimeBonus: 0, skillBonus: 0, tips: 0, allStopsBonus: 0, damage: 0, other: 0 }
      : computeScore({ fare: run.fare, onTimeBonus: run.bonus, skillBonus: run.skill, makiBonus: run.maki, tips: run.tips, allStops, damage, other });
    const rank = rankFor(score.total, run.rampage ? RAMPAGE.ranks : run.mode === 'intro' ? INTRO.ranks : undefined);
    const result = {
      reason,
      mode: run.mode,
      modeLabel: MODES[run.mode].label,
      daily: run.daily ? { key: run.daily.key, picks: run.daily.picks.map((p) => ({ icon: p.icon, name: p.name })) } : null,
      rampage: run.rampage ? { ...run.rampage } : null,
      maxCombo: run.maxCombo,
      makiLegs: run.makiLegs,
      pita: { ...run.pita },
      hurry: { done: run.hurryDone, total: run.hurry.length },
      rival: { wins: run.rivalWins, losses: run.rivalLosses },
      ...score,
      rank: rank.rank,
      comment: rank.comment,
      stopsServed: run.stops.filter((s) => s.status === 'done').length,
      // このコースで回った停留所だけ（入門コースは 5 か所）
      stops: this.stops.filter((s) => run.stops[s.index].status !== 'off').map((s) => {
        const i = s.index;
        return {
          name: s.name,
          scheduled: RULES.startClockSec + s.scheduled,
          arrival: run.stops[i].arrival != null ? RULES.startClockSec + run.stops[i].arrival : null,
          delay: run.stops[i].result ? run.stops[i].result.delay : null,
          onTime: !!(run.stops[i].result && run.stops[i].result.onTime),
          board: run.stops[i].result ? run.stops[i].result.board : 0,
          lost: run.stops[i].result ? run.stops[i].result.lost : run.stops[i].base,
          stolen: run.stops[i].stolen,
          pita: run.stops[i].pita || null,
          status: run.stops[i].status,
          terminal: !!s.terminal,
        };
      }),
      counts: {
        cone: ledger.count('cone'),
        sign: ledger.count('sign'),
        guardrail: ledger.count('guardrail'),
        car: ledger.count('car'),
        impact: ledger.count('impact'),
        reset: ledger.count('reset'),
        brake: ledger.count('brake'),
        crossing: ledger.count('crossing'),
        train: ledger.count('train'),
      },
      damageByKind: {
        cone: ledger.total((it) => it.kind === 'cone'),
        sign: ledger.total((it) => it.kind === 'sign'),
        guardrail: ledger.total((it) => it.kind === 'guardrail'),
        car: ledger.total((it) => it.kind === 'car'),
      },
      crossingFine: ledger.total((it) => it.kind === 'crossing'),
      time: run.t,
      maxSpeedKmh: Math.round(run.maxSpeed * 3.6),
    };
    // 自己ベストならゴーストを保存（通常運行のみ。storage 側でベスト判定する前に比較）
    const prevBest = loadBest(run.mode, run.daily && run.daily.key);
    result.isBest = !prevBest || result.total > prevBest.total;
    if (result.isBest && !this.autopilot && run.mode === 'normal') run.recorder.save(result.total);
    if (run.rampage && run.rampage.points >= 100000) this._unlock('rampage', false);
    if (run.mode === 'daily' && reason === 'clear') this._unlock('daily', false);
    // 実績
    for (const id of achievementsForResult(result)) this._unlock(id, false);
    result.unlocked = run.unlocked.map(achievementById).filter(Boolean);
    this.lastResult = result;
    if (this.clips && this.clips.active) {
      const rec = this.clips;
      rec.finish(performance.now() / 1000).then((clips) => {
        if (this.lastResult !== result) return;
        this.lastClips = clips.slice();
        this.ui.showClips(this.lastClips);
      });
      rec.onChange = (clips) => this.lastResult === result && this.ui.showClips((this.lastClips = clips.slice()));
    } else this.lastClips = [];
    this.rival.stop();
    if (reason === 'clear' || reason === 'rampage') {
      this.audio.jingle('clear');
      if (reason === 'clear') this.audio.say('終点、げんかいえきです。ご乗車ありがとうございました。');
      this.effects.confetti(this.bus.x, 8, this.bus.z, 70);
    } else this.audio.jingle('timeout');
    if (reason === 'rampage') this.hud.big('そこまで！', `破壊点 ${run.rampage.points.toLocaleString()}`, 2.2, 'go');
    else this.hud.big(reason === 'clear' ? '終点到着！' : '時間切れ…', reason === 'clear' ? 'おつかれさまでした' : '運行打ち切り', 2.2, reason === 'clear' ? 'good' : 'bad');
    setTimeout(() => {
      if (this.state === 'result' && this.lastResult === result) {
        this.hud.show(false);
        this.ui.showResult(result);
      }
    }, 2600);
  }

  // ---------------- イベント ----------------
  _onPropHit(it, t) {
    const run = this.run;
    this._propSfx(it);
    this.effects.hitProp(it.type, it.x, it.y, it.z, this.bus.vx * 0.5, this.bus.vz * 0.5);
    if (!run || this.state !== 'playing' || it.noCharge) return;
    const p = PENALTY[it.kind.cls];
    if (run.rampage) {
      if (run.ledger.charge(it.id, it.kind.cls, p.amount, it.kind.label, run.t)) this._rampageHit(RAMPAGE.points[it.kind.cls] ?? p.amount, it.kind.label, it.x, it.z, it.kind.cls);
      return;
    }
    let amount = p.amount * run.mods.fineMult;
    // ガードレールは続けてこすっても 1 回の接触につき 1 区画分だけ
    let sameRail = false;
    if (it.kind.cls === 'guardrail') {
      sameRail = run.t - (run.railT ?? -99) < 1.5;
      run.railT = run.t;
      if (sameRail) amount = 0;
    }
    if (run.ledger.charge(it.id, it.kind.cls, amount, it.kind.label, run.t)) {
      if (!sameRail) this._floatWorld(it.x, 1.5, it.z, `−¥${amount.toLocaleString()} ${it.kind.label}`, 'fine');
      if (it.kind.cls === 'guardrail') {
        this.cam.shake = Math.max(this.cam.shake, 0.35);
        this._voice('rail');
      } else this._voice('hit', 0.5);
      this._hint('penalty');
    }
  }

  _propSfx(it) {
    const key = { cone: 'cone', pot: 'pot', sign: 'sign', board: 'board', nobori: 'nobori', barricade: 'board', guardrail: 'guardrail' }[it.type] || 'cone';
    this.audio.play(key, { volume: key === 'cone' ? 0.7 : 0.85, rate: 0.94 + Math.random() * 0.12, max: 3 });
  }

  _onCarHit(car, t) {
    const run = this.run;
    this.audio.play('car', { volume: 1 });
    this.audio.play('glass', { volume: 0.55, delay: 0.03 });
    this.cam.shake = Math.max(this.cam.shake, 0.7);
    this.effects.carCrash(car.x, car.z, this.bus.vx * 0.4, this.bus.vz * 0.4);
    // ヒットストップ（一瞬スローモーション）
    this.slowmo = 0.45;
    if (!run || this.state !== 'playing') return;
    this._voice('car');
    this._highlight('他の車に激突', run.rampage ? 25 : 40, 3.5, 0.3);
    car.gen = (car.gen || 0) + 1;
    const id = `${car.id}#${car.gen}`;
    if (run.rampage) {
      if (run.ledger.charge(id, 'car', PENALTY.car.amount, PENALTY.car.label, run.t)) this._rampageHit(RAMPAGE.points.car, '他車', car.x, car.z, 'car');
      return;
    }
    const amount = PENALTY.car.amount * run.mods.fineMult;
    if (run.ledger.charge(id, 'car', amount, PENALTY.car.label, run.t)) {
      this._floatWorld(car.x, 2, car.z, `−¥${amount.toLocaleString()} 他車に衝突！`, 'fine big');
      this.hud.toast(`他車に衝突！ 罰金 ¥${amount.toLocaleString()}`, 'bad');
    }
  }

  _floatWorld(x, y, z, text, kind) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return;
    const sx = (v.x * 0.5 + 0.5) * this.viewW;
    const sy = (-v.y * 0.5 + 0.5) * this.viewH;
    this.hud.floatText(Math.max(60, Math.min(this.viewW - 60, sx)), Math.max(60, Math.min(this.viewH - 60, sy)), text, kind);
  }

  resetBus() {
    const run = this.run;
    if (this.state !== 'playing' || !run) return;
    if (run.serving >= 0) return;
    const spot = this._findResetSpot();
    if (!spot) return;
    this.bus.reset(spot.x, spot.z, spot.h);
    this.bus.load = run.onboard / RULES.capacity;
    run.ledger.chargeEvent('reset', RULES.resetPenalty, '路面復帰', run.t);
    run.resets++;
    this.hud.toast(`路面へ復帰（ペナルティ ¥${RULES.resetPenalty.toLocaleString()}）`, 'bad');
    this.audio.play('reset');
    this.effects.dust(spot.x, spot.z, 6, ['#ffffff', '#dff4ff']);
    this._camSnap = true;
  }

  _findResetSpot() {
    const bc = Math.floor(this.bus.x / TILE), br = Math.floor(this.bus.z / TILE);
    const isHRow = (r) => Object.values(H_ROADS).some(([a, b]) => r === a || r === b);
    const isVCol = (c) => Object.values(V_ROADS).some(([a, b]) => c === a || c === b);
    const snap = (h) => Math.round(h / (Math.PI / 2)) * (Math.PI / 2);
    let best = null;
    for (let rad = 0; rad < 12 && !best; rad++) {
      for (let r = br - rad; r <= br + rad; r++) {
        for (let c = bc - rad; c <= bc + rad; c++) {
          if (Math.max(Math.abs(r - br), Math.abs(c - bc)) !== rad) continue;
          const t = tileAt(c, r);
          if (!isDrivableType(t)) continue;
          let axis; // 'x' = 東西
          if (t === T.ALLEY) {
            const a = ALLEYS.find((al) => c >= al.rect[0] && c <= al.rect[2] && r >= al.rect[1] && r <= al.rect[3]);
            axis = a && a.rect[0] === a.rect[2] ? 'z' : 'x';
          } else if (isHRow(r) && !isVCol(c)) axis = 'x';
          else if (isVCol(c) && !isHRow(r)) axis = 'z';
          else axis = Math.abs(Math.sin(this.bus.h)) > 0.7 ? 'x' : 'z';
          let h;
          if (axis === 'x') h = Math.sin(this.bus.h) >= 0 ? Math.PI / 2 : -Math.PI / 2;
          else h = Math.cos(this.bus.h) >= 0 ? 0 : Math.PI;
          if (t === T.PLAZA) h = snap(this.bus.h);
          const x = (c + 0.5) * TILE, z = (r + 0.5) * TILE;
          // 前後のタイルも走行可能であること
          const fx = Math.round(Math.sin(h)), fz = Math.round(Math.cos(h));
          if (!isDrivableType(tileAt(c + fx, r + fz)) || !isDrivableType(tileAt(c - fx, r - fz))) continue;
          const d = Math.hypot(x - this.bus.x, z - this.bus.z);
          if (!best || d < best.d) best = { x, z, h, d };
        }
      }
    }
    return best;
  }

  // ---------------- メインループ ----------------
  _loop(now) {
    requestAnimationFrame(this._loop);
    const cap = this.q.fpsCap;
    if (cap && now - this._lastRender < 1000 / cap - 3) return;
    this._lastRender = now;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    if (this.debug.fixedFrame) dt = this.debug.fixedFrame;
    this.frame(dt);
  }

  frame(dt) {
    const inp = this.input;
    if (this.debug.timescale) dt *= this.debug.timescale;
    // ヒットストップ
    const realDt = dt;
    if (this.slowmo > 0) {
      this.slowmo -= realDt;
      dt *= 0.3;
    }
    if (inp.consume('Escape') || inp.consume('KeyP')) {
      if (this.state === 'paused') this.resume();
      else this.pause();
    }
    if (inp.consume('KeyR')) this.resetBus();
    if (inp.consume('KeyM')) this.ui.toggleMinimap();
    if (inp.consume('KeyH') && this.state === 'playing') this.audio.play('horn', { max: 1 });

    if (this.state !== 'paused') {
      this.time += dt;
      this._acc += dt;
      let steps = 0;
      const maxSteps = this.debug.timescale ? 2000 : 24;
      while (this._acc >= PHYSICS_DT && steps < maxSteps) {
        this._step(PHYSICS_DT);
        this._acc -= PHYSICS_DT;
        steps++;
      }
      if (steps >= maxSteps) this._acc = 0;
    }
    const alpha = this.state === 'paused' ? 1 : this._acc / PHYSICS_DT;
    const pose = this.bus.sync(alpha);
    this.traffic.sync(alpha);
    this.passengers.update(this.state === 'paused' ? 0 : dt, this.time);
    if (this.state !== 'paused') this.effects.update(dt);
    this.ghost.update(this.run ? this.run.t : 0, this.state === 'playing' || this.state === 'paused', pose.x, pose.z);
    this._updateCamera(realDt, pose);
    this._updateMarker(dt);
    this.sky.update(this.camera);
    if (this.q.shadows) {
      this.sun.position.set(pose.x - 60, 110, pose.z + 40);
      this.sun.target.position.set(pose.x, 0, pose.z);
    }
    if (this.run && (this.state === 'playing' || this.state === 'countdown' || this.state === 'paused')) this._updateHud();
    this.renderer.render(this.scene, this.camera);
    if (this.clips && this.clips.active) this.clips.frame(this.renderer.domElement, performance.now() / 1000);
    // シェア画像の背景用：いちばんの見せ場の画面を写しておく（描画の直後でないと WebGL の画面は読めない）
    if (this._shotReq && performance.now() / 1000 >= this._shotReq.at) {
      const src = this.renderer.domElement;
      try {
        const c = document.createElement('canvas');
        c.width = 960;
        c.height = Math.round((960 * src.height) / src.width);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        this._bestShot = { score: this._shotReq.score, canvas: c };
      } catch (_) {
        /* 写せなければ結果画面の画面を使う */
      }
      this._shotReq = null;
    }
    inp.endFrame();
  }

  _step(dt) {
    const run = this.run;
    const playing = this.state === 'playing';
    let input = { throttle: false, brake: false, steer: 0, handbrake: false };
    if (playing) {
      if (this.autopilot) {
        // 暴走モードでは停留所を順にめぐって街を走り回る
        const target = run.rampage ? this.stops[(1 + Math.floor(run.t / 14)) % this.stops.length] : run.stops[run.next] ? this.stops[run.next] : this.stops[this.stops.length - 1];
        input = this.autopilot.drive(this.bus, target, dt);
      } else input = this.input.drive();
      // 乗降中はドアが開いているので発車できない
      if (run.serving >= 0) input = { throttle: false, brake: false, steer: input.steer, handbrake: false, hold: true };
    } else if (this.state === 'countdown' || this.state === 'title' || this.state === 'result') {
      input.hold = true;
    }

    this.railway.update(dt);
    const trainBoxes = this.railway.boxes();
    const rivalOn = run && this.rival.state !== 'off';
    const env = {
      staticHash: this.staticHash,
      cars: rivalOn ? [...this.traffic.cars, this.rival.proxy] : this.traffic.cars,
      props: this.props,
      boxes: trainBoxes,
      t: run ? run.t : 0,
      onCarHit: (car, bus, hit) => {
        if (!playing) return;
        if (car.isRival) this._onRivalBump(hit);
        else this.traffic.handleBusHit(car, bus, hit, run.t);
      },
      onBoxHit: (b) => playing && this._onTrainHit(b),
    };
    this.bus.lastImpactJ = 0;
    const res = this.bus.step(dt, input, env);
    this.traffic.update(dt, this.bus, this.props);
    this.props.update(dt);
    // ライバルのバス（他車・電車とはぶつかるが、罰金はなし）
    if (rivalOn && playing) {
      const ev = this.rival.step(dt, { staticHash: this.staticHash, cars: this.traffic.cars, boxes: trainBoxes, t: run.t, onCarHit: () => {} }, this.props);
      if (ev === 'arrived') this._onRivalArrive();
    }

    if (this.state === 'countdown') {
      run.countdown -= dt;
      const n = Math.ceil(run.countdown - 0.4);
      if (n !== run.lastCount && n >= 0) {
        run.lastCount = n;
        if (n > 0) {
          this.hud.big(String(n), '発車準備', 0.9, 'count');
        } else {
          if (run.rampage) this.hud.big('暴走開始！', '違う物を続けて壊すと倍率アップ', 1.6, 'go');
          else this.hud.big('発車オーライ！', `${run.course.indexOf(run.next) + 1}番 ${this.stops[run.next].name} へ`, 1.4, 'go');
          this.audio.play('go', { volume: 0.8 });
          this.audio.playBgm('drive', { fade: 1.2 });
          this.state = 'playing';
          this._hint('start');
          if (run.closures.length) setTimeout(() => this.run === run && this._hint('closure'), 9000);
        }
      }
      return;
    }
    if (!playing) return;

    run.t += dt;
    run.maxSpeed = Math.max(run.maxSpeed, this.bus.speed);
    const bus = this.bus;
    const skidding = (bus.slip > 2.6 && bus.speed > 4) || (bus.decel > 9.5 && bus.speed > 5) || (bus.handbrake && bus.speed > 4);
    this.audio.updateEngine(bus.speed, input.throttle, skidding ? Math.min(1, bus.speed / 12) : 0);
    this.audio.updateRail(this.railway.nearestWarn(bus.x, bus.z), this.railway.nearestTrain(bus.x, bus.z));
    run.recorder.sample(dt, bus.x, bus.z, bus.h);

    // 衝撃で乗客転倒
    run.impactCd -= dt;
    if (res.impact > 1.8) {
      this.audio.play('wall', { volume: Math.min(1, 0.35 + res.impact * 0.06), max: 2 });
      this.cam.shake = Math.max(this.cam.shake, Math.min(0.8, res.impact * 0.06));
      this.effects.dust(bus.x + Math.sin(bus.h) * 4, bus.z + Math.cos(bus.h) * 4, 3, ['#c9c4b6', '#b5ada0']);
    }
    if (res.impact * 3.6 >= RULES.impactSpeedKmh && run.onboard > 0 && run.impactCd <= 0) {
      run.impactCd = 2;
      run.ledger.chargeEvent('impact', RULES.impactPenalty, '乗客転倒', run.t);
      this.hud.toast(`激突！ 乗客が転倒 −¥${RULES.impactPenalty}`, 'bad');
      this.audio.play('fall', { volume: 0.8 });
    }

    // 急ブレーキ（強く長く踏んだまま高速から減速）
    run.brakeCd -= dt;
    if (bus.decel > RULES.suddenBrakeDecel && bus.speed * 3.6 > RULES.suddenBrakeKmh && run.onboard > 0) run.hardBrakeT += dt;
    else run.hardBrakeT = 0;
    if (run.hardBrakeT > RULES.suddenBrakeSec && run.brakeCd <= 0) {
      run.brakeCd = 4;
      if (run.brakeWarned < RULES.suddenBrakeFreeWarnings) {
        run.brakeWarned++;
        this.hud.toast('急ブレーキ注意！ 早めに軽く踏もう（次から −¥300）', 'warn');
      } else {
        run.ledger.chargeEvent('brake', RULES.suddenBrakePenalty, '急ブレーキ', run.t);
        this.hud.toast(`急ブレーキ！ 乗客がよろけた −¥${RULES.suddenBrakePenalty}`, 'bad');
      }
      this._voice('brake', 1, true);
      this._hint('brake');
    }

    this._updateDrivingFx(dt, input, skidding);
    this._updateCrossing(dt);
    if (run.rampage) this._updateRampage(dt);
    else {
      this._updateStops(dt);
      this._updateHurry();
    }

    if (run.t >= run.limit && !run.finished) this._finish(run.rampage ? 'rampage' : 'timeout');
  }

  // ---------------- 踏切 ----------------
  _updateCrossing() {
    const run = this.run;
    const bus = this.bus;
    const cr = this.railway.crossingAt(bus.x, bus.z);
    // 踏切に入った瞬間の遮断機の状態を覚えておく（渡っている途中で鳴り始めたら、そのまま渡りきってよい）
    if (cr !== run.crNow) {
      run.crNow = cr;
      run.crEnterGate = cr && cr.warn ? cr.gate : 0;
    }
    // 電車にはねられたあと、線路の上にいる間は同じ事故を二度数えない（線路から出るまで延長）
    if ((this._trainCd || 0) > run.t && bus.z > RAIL.z0 - 3 && bus.z < RAIL.z1 + 3) this._trainCd = run.t + 1.5;
    // 電車にはね飛ばされている間は踏切無視に数えない
    const knocked = bus.knockT > 0 || bus.airborne || (this._trainCd || 0) > run.t;
    if (cr && cr.warn && run.crEnterGate > 0.25 && bus.speed > 1 && !cr.violated && !knocked) {
      cr.violated = true;
      cr.broken = true;
      this.effects.chips_(cr.x, 1, bus.z, 10, ['#ffd400', '#111111']);
      this.audio.play('sign', { volume: 0.9 });
      if (run.rampage) {
        this._rampageHit(RAMPAGE.points.crossing, '遮断機', cr.x, bus.z, 'crossing');
      } else {
        const amt = RULES.crossingPenalty * run.mods.fineMult;
        run.ledger.chargeEvent('crossing', amt, '踏切無視', run.t);
        run.crossingFines++;
        this.hud.toast(`踏切無視！ 遮断機を突破 −¥${amt.toLocaleString()}`, 'bad');
        this._floatWorld(bus.x, 3, bus.z, `−¥${amt.toLocaleString()} 踏切無視`, 'fine big');
        this._voice('crossing', 1, true);
      }
    }
    // 線路の上にいるのに電車が迫ってきたら警笛
    if (cr && this.railway.nearestTrain(bus.x, bus.z) < 110 && (run.hornT || 0) < run.t) {
      run.hornT = run.t + 6;
      this.audio.play('train_horn', { volume: 0.9 });
    }
    // 鳴っている踏切に近づいたらヒント
    if (this.railway.nearestWarn(bus.x, bus.z) < 45) this._hint('crossing');
  }

  /** 電車にはねられた：バスが横転しながら吹っ飛ぶ */
  _onTrainHit(b) {
    const run = this.run;
    if (this._trainCd > run.t) return;
    this._trainCd = run.t + 3;
    const bus = this.bus;
    const train = b && b.train;
    const dir = train ? train.dir : 1;
    const away = train ? Math.sign(bus.z - train.z) || 1 : 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    // 踏切の道路に沿って、線路の外へ放り出す（電車の進む向きにも少し流す）
    bus.vx *= 0.2;
    bus.vz *= 0.2;
    bus.knock(dir * 4, away * 17, 9, side * 3.5, side * (7 + Math.random() * 3));
    this.cam.shake = Math.max(this.cam.shake, 1.4);
    this.slowmo = 0.9;
    this.audio.play('train_crash', { volume: 1 });
    this.audio.play('glass', { volume: 0.7, delay: 0.05 });
    this.audio.play('train_horn', { volume: 0.8, delay: 0.1 });
    this.effects.carCrash(bus.x, bus.z, dir * 9, away * 4);
    this.effects.sparks_(bus.x, 1.6, bus.z, 60, { vx: dir * 12, speed: 14 });
    this.effects.chips_(bus.x, 2, bus.z, 26, ['#f7f5ee', '#1f8a4c', '#22313c', '#c9e3f5', '#ffcc33'], { vx: dir * 10, vz: away * 4, speed: 9, up: 10, size: [0.12, 0.35] });
    run.smokeT = 6; // しばらく煙を上げる
    this._highlight('電車にはね飛ばされる', 100, 4.5, 0.5);
    this._unlock('train');
    if (run.rampage) {
      this._rampageHit(RAMPAGE.points.train, '電車と衝突', bus.x, bus.z, 'train');
      this.hud.big('大惨事！', '電車にはね飛ばされた', 1.6, 'bad');
      return;
    }
    const amt = RULES.trainCrashPenalty;
    // 直前に同じ踏切で取った「踏切無視」は、この事故の罰金にまとめる（二重に取らない）
    const items = run.ledger.items;
    for (let k = items.length - 1; k >= 0; k--) {
      if (items[k].kind === 'crossing' && run.t - items[k].t < 8) {
        items.splice(k, 1);
        run.crossingFines = Math.max(0, run.crossingFines - 1);
        break;
      }
    }
    run.ledger.chargeEvent('train', amt, '電車と接触事故', run.t);
    this.hud.big('大惨事！', `電車と接触事故 −¥${amt.toLocaleString()}`, 2, 'bad');
    this._floatWorld(bus.x, 4, bus.z, `−¥${amt.toLocaleString()} 電車と接触`, 'fine big');
    if (run.onboard > 0) {
      run.ledger.chargeEvent('impact', RULES.impactPenalty, '乗客転倒', run.t);
      this.audio.play('fall', { volume: 0.8, delay: 0.6 });
    }
    setTimeout(() => this.run === run && this._voice('car', 1, true), 700);
  }

  // ---------------- ライバル ----------------
  _spawnRival(fromStop) {
    const run = this.run;
    const targetIdx = run.next + 1;
    const target = this.stops[targetIdx];
    if (!target || target.terminal || run.stops[targetIdx].status !== 'pending') return;
    const spot = spotBehind(this.bus, 46);
    if (!spot) return;
    this.rival.start(spot.x, spot.z, spot.h, target, Math.min(12, this.bus.speed + 3));
    this.rival.targetIdx = targetIdx;
    run.rivalTarget = targetIdx;
    this.audio.play('rival', { volume: 0.8 });
    this.hud.big('ライバル出現！', `ギリギリ交通が「${target.name}」の客を狙っている`, 2.2, 'bad');
    this.hud.toast(`先に「${target.name}」に着かないと客を半分取られる！`, 'warn');
    this._hint('rival');
    void fromStop;
  }

  _onRivalArrive() {
    const run = this.run;
    const i = this.rival.targetIdx;
    const st = run.stops[i];
    if (!st || st.status !== 'pending') return;
    const s = this.stops[i];
    const n = st.shown;
    const take = Math.min(n, Math.ceil(n / 2));
    if (take <= 0) return;
    st.stolen += take;
    st.shown -= take;
    run.rivalLosses++;
    run.rivalTarget = -1;
    this.passengers.board(s, this.rival.doorPos(), take, () => {});
    this.audio.play('late', { volume: 0.7 });
    this.hud.toast(`ライバルに「${s.name}」の客を ${take} 人横取りされた！`, 'bad');
  }

  _onRivalBump(hit) {
    const run = this.run;
    const r = this.rival.bus;
    r.x -= hit.nx * hit.depth * 0.45;
    r.z -= hit.nz * hit.depth * 0.45;
    r.vx -= hit.nx * 2;
    r.vz -= hit.nz * 2;
    if ((this._rivalBumpCd || 0) > run.t) return;
    this._rivalBumpCd = run.t + 1.5;
    this.audio.play('wall', { volume: 0.7 });
    this.effects.sparks_((this.bus.x + r.x) / 2, 1.2, (this.bus.z + r.z) / 2, 12);
    this._voice('car', 0.6);
  }

  // ---------------- 急ぎの客 ----------------
  _updateHurry() {
    const run = this.run;
    for (const h of run.hurry) {
      if (h.state === 'riding' && run.t > h.deadline) {
        h.state = 'failed';
        this.hud.toast(`急ぎの客が間に合わず怒っている…（${this.stops[h.to].name}）`, 'bad');
        this._voice('late', 1, true);
      }
    }
  }

  // ---------------- 暴走モード ----------------
  _rampageHit(points, label, x, z, kind = '') {
    const rp = this.run.rampage;
    const t = this.run.t;
    // 違う種類のものを続けて壊すとコンボが伸びる（同じ種類ばかりだと伸びない）
    const before = rp.chain;
    if (t - rp.lastHitT > RAMPAGE.comboWindow) rp.chain = 1;
    else if (kind !== rp.lastKind) rp.chain++;
    rp.lastKind = kind;
    rp.lastHitT = t;
    rp.maxChain = Math.max(rp.maxChain, rp.chain);
    rp.destroyed++;
    const mult = rampageMultiplier(rp.chain);
    const got = Math.round(points * mult);
    rp.points += got;
    this._floatWorld(x, 2, z, `+${got.toLocaleString()}${mult > 1 ? ` ×${mult}` : ''} ${label}`, 'fare');
    if (rp.chain !== before && (rp.chain === 7 || rp.chain === 12)) this._highlight(`${rp.chain} コンボ破壊`, 40 + rp.chain * 2, undefined, 0.15, 'combo');
    if (rp.chain !== before && (rp.chain === 3 || rp.chain === 7 || rp.chain === 12)) {
      this.hud.big(`${rp.chain} コンボ！`, `破壊点 ×${mult}`, 0.9, 'go');
      this.audio.play('combo', { volume: 0.7 });
    }
  }

  _updateRampage() {
    const rp = this.run.rampage;
    if (rp.chain > 0 && this.run.t - rp.lastHitT > RAMPAGE.comboWindow) rp.chain = 0;
  }

  _updateStops(dt) {
    const run = this.run;
    const bus = this.bus;
    // ほぼ止まった状態が少し続いたら「停車」（ピタ止めは止まった位置で判定）
    run.stillT = bus.speed * 3.6 <= RULES.stopSpeedKmh ? run.stillT + dt : 0;
    const slow = run.stillT >= 0.15;
    const lastIdx = this.stops.length - 1;

    // 待機客の減少（未到着の停留所）
    for (let i = 0; i < this.stops.length; i++) {
      const st = run.stops[i];
      if (st.status !== 'pending') continue;
      const s = this.stops[i];
      const n = Math.max(0, remainingPassengers(st.base, run.t - s.scheduled) - st.stolen);
      if (n < st.shown) {
        this.passengers.setWaiting(s, n);
        if (i === run.next) {
          this.hud.toast(`${s.name}の客が待ちきれずに帰った… 残り${n}人`, 'warn');
          this.audio.play('leave', { volume: 0.6 });
          this._hint('late');
        }
        st.shown = n;
      }
    }

    // 乗降処理中
    if (run.serving >= 0) {
      const i = run.serving;
      const st = run.stops[i];
      const s = this.stops[i];
      st.elapsed += dt;
      const all = st.boarded >= st.result.board;
      this.hud.dwell(Math.min(st.elapsed / st.dwell, all ? 1 : 0.95), s.terminal ? 'お降りのお客様…' : `乗降中… ${st.boarded}/${st.result.board}人`);
      if ((st.elapsed >= st.dwell && all) || st.elapsed > st.dwell + 4) {
        // 取りこぼし分を精算
        while (st.boarded < st.result.board) this._boardOne(i);
        st.status = 'done';
        run.serving = -1;
        run.depT = run.t;
        bus.doorTarget = 0;
        this.hud.dwell(null);
        this.audio.play('door', { volume: 0.7 });
        if (s.terminal) {
          this._finish('clear');
          return;
        }
        run.next = this._nextInCourse(i);
        const ns = this.stops[run.next];
        this._setMarker(ns);
        this.audio.say(`発車します。次は、${ns.kana}です。`);
        this.hud.toast(`次は ${ns.name}`, 'info');
        // ライバル出現（この停留所を出たところで後ろから）
        if (run.rivalAt.includes(i) && this.rival.state === 'off') setTimeout(() => this.run === run && this.state === 'playing' && this._spawnRival(i), 1500);
      }
      return;
    }

    if (!slow) {
      run.terminalHold = 0;
      if (run.missHold) {
        run.missHold = false;
        this.hud.dwell(null);
      }
      return;
    }
    // 到着判定: 次の停留所、または終点（途中打ち切り）
    const candidates = [run.next];
    if (run.next !== lastIdx) candidates.push(lastIdx);
    for (const idx of candidates) {
      const s = this.stops[idx];
      if (!inZone(s, bus.x, bus.z)) continue;
      if (idx === lastIdx && run.next !== lastIdx) {
        // 終点に早く入った: 3秒停車し続けたら残りを通過扱いで終了
        run.terminalHold += dt;
        this.hud.dwell(run.terminalHold / 3, '残りの停留所を通過して運行終了…');
        if (run.terminalHold < 3) return;
        for (let k = run.next; k < lastIdx; k++) if (run.stops[k].status === 'pending') run.stops[k].status = 'skipped';
      } else if (!s.terminal) {
        // 停止位置が大きくずれていたら、すぐには到着にしない（少し動いて止め直せる）
        const err = stopError(s, bus.x, bus.z);
        const g = pitaGrade(err.along, err.gap).grade;
        const hold = g === 'miss' ? RULES.missHoldSec : g === 'good' ? RULES.goodHoldSec : 0;
        if (run.stillT < hold) {
          run.missHold = true;
          const a = this._pitaAhead(s, err);
          const where = Math.abs(a) >= 0.6 ? `${Math.abs(a).toFixed(1)}m ${a > 0 ? '行き過ぎ' : '手前'}` : '縁石から遠い';
          this.hud.dwell(run.stillT / hold, `位置ずれ（${where}）… 動けば止め直せます`);
          return;
        }
      }
      run.missHold = false;
      this._arrive(idx);
      return;
    }
    if (run.terminalHold > 0) {
      run.terminalHold = 0;
      this.hud.dwell(null);
    }
  }

  _arrive(i) {
    const run = this.run;
    const s = this.stops[i];
    const st = run.stops[i];
    const bus = this.bus;
    const res = resolveStop({
      initialWaiting: st.base,
      alighting: s.terminal ? run.onboard : s.off,
      scheduledSec: s.scheduled,
      arrivalSec: run.t,
      onboard: run.onboard,
      taken: st.stolen,
    });
    st.result = res;
    st.arrival = run.t;
    st.status = 'serving';
    st.boarded = 0;
    st.elapsed = 0;
    st.dwell = dwellTime(res.board, res.off);
    run.serving = i;
    run.next = i;
    run.onboard -= res.off;
    bus.vx = 0;
    bus.vz = 0;
    bus.doorTarget = 1;
    bus.load = run.onboard / RULES.capacity;
    // 定時コンボ
    let bonus = 0;
    const prevCombo = run.combo;
    if (res.onTime) {
      run.combo++;
      run.maxCombo = Math.max(run.maxCombo, run.combo);
      bonus = comboBonus(run.combo, run.mods.comboMult);
      run.bonus += bonus;
      if (run.combo >= 10) this._unlock('combo10');
    } else run.combo = 0;
    res.bonus = bonus;
    // 巻きボーナス：この区間を想定より速く走った（停留所を飛ばして終点に来たときはなし）
    const saved = (st.legPlan || 0) - (run.t - run.depT);
    const maki = run.stops.some((x) => x.status === 'skipped') ? 0 : makiBonus(saved, run.mods.makiMult || 1);
    st.saved = saved;
    if (maki > 0) {
      run.maki += maki;
      run.makiLegs++;
      setTimeout(() => this.run === run && this._floatWorld(bus.x, 6, bus.z, `${saved.toFixed(1)}秒巻き +¥${maki.toLocaleString()}`, 'fare'), 450);
    }
    // ピタ止め（中扉を標柱の横に、縁石ぎりぎりに）
    const err = stopError(s, bus.x, bus.z);
    const pg = pitaGrade(err.along, err.gap, run.mods.pitaMult);
    run.pita[pg.grade]++;
    run.skill += pg.bonus;
    st.pita = pg.grade;
    const advice = this._pitaAdvice(s, err, pg.grade);
    // 見出し（定時・遅延）を先に出す。あとから出る浮き文字はこの見出しにかぶらない位置に出る
    const pitaText = pg.grade === 'miss' ? (advice ? `　停止位置 ${advice}` : '') : `　${pg.label}`;
    if (s.terminal) {
      this.hud.big('終点 限界駅', (res.onTime ? `定時到着！ +¥${bonus}` : `遅延 ${Math.round(res.delay)}秒`) + pitaText, 2, res.onTime ? 'good' : 'bad');
    } else if (res.onTime) {
      this.hud.big(run.combo >= 2 ? `定時コンボ ×${run.combo}` : '定時到着！', `+¥${bonus.toLocaleString()} ボーナス${pitaText}`, 1.4, 'good');
    } else {
      this.hud.big(`遅延 ${Math.round(res.delay)}秒`, res.lost > 0 ? `${res.lost}人が待ちきれず帰宅…` : 'お客様はまだ待っていた', 1.6, 'bad');
    }
    if (run.pita.perfect >= 6) this._unlock('pitamaster');
    if (i <= 1 && !s.terminal) setTimeout(() => this.run === run && this._hint('pita'), 1800);
    this.bus.setOnboard(run.onboard, RULES.capacity);
    this.audio.play('door', { volume: 0.7 });
    if (res.onTime) {
      this.audio.play('ontime', { volume: 0.8 });
      this._voice(pg.grade === 'perfect' ? 'pita' : 'ontime', 0.8, true);
      if (res.delay > -1) this._unlock('justintime');
    } else {
      this.audio.play('late', { volume: 0.7 });
      if (res.lost > 0) this._voice('late', 0.9, true);
    }
    if (pg.grade !== 'miss') {
      this.audio.play(pg.grade === 'perfect' ? 'pita' : 'coin', { volume: pg.grade === 'perfect' ? 0.8 : 0.5, delay: 0.25 });
      this._floatWorld(bus.x, 4.5, bus.z, `${pg.label} +¥${pg.bonus}${advice ? `（${advice}）` : ''}`, pg.grade === 'perfect' ? 'pita' : 'fare');
      if (pg.grade === 'perfect') {
        this.effects.confetti(bus.x, 6, bus.z, 18);
        this._highlight(run.combo >= 3 ? `ピタッ！＋定時コンボ ×${run.combo}` : 'ピタッ！', 20 + Math.min(20, run.combo * 2), undefined, 0.15, 'pita');
      }
    } else if (!s.terminal) this._floatWorld(bus.x, 4.5, bus.z, `停止位置ずれ（${advice}）`, 'miss');
    if (!res.onTime && prevCombo >= 2) this.hud.toast(`定時コンボが途切れた…（${prevCombo}連続）`, 'warn');
    // ライバルとの競争
    if (run.rivalTarget === i && this.rival.state === 'race') {
      run.rivalWins++;
      run.rivalTarget = -1;
      run.skill += RULES.rivalWin;
      this.rival.giveUp();
      this.hud.toast(`ライバルに競り勝った！ +¥${RULES.rivalWin.toLocaleString()}`, 'achieve');
      this.audio.play('combo', { volume: 0.7, delay: 0.5 });
      this._unlock('rival');
      this._highlight('ライバルに競り勝つ', 45, 2.5);
    }
    // 急ぎの客
    for (const h of run.hurry) {
      if (h.to === i && h.state === 'riding') {
        h.state = 'done';
        const tip = RULES.hurryTip * run.mods.tipMult;
        run.tips += tip;
        run.hurryDone++;
        this.hud.toast(`急ぎの客を送り届けた！ チップ ¥${tip.toLocaleString()}`, 'achieve');
        this._floatWorld(bus.x, 5.2, bus.z, `チップ +¥${tip.toLocaleString()}`, 'pita');
        this.audio.play('tip', { volume: 0.8, delay: 0.4 });
        setTimeout(() => this.run === run && this._voice('thanks', 1, true), 900);
        if (run.hurryDone >= 3) this._unlock('tipking');
      }
      if (h.from === i && h.state === 'waiting') {
        h.state = 'riding';
        const allot = (this.stops[h.to].scheduled - s.scheduled) * 0.95 + 8;
        h.deadline = run.t + allot;
        h.allot = allot;
        setTimeout(() => {
          if (this.run !== run) return;
          this.hud.big('急ぎの客が乗車！', `${this.stops[h.to].name}まで ${Math.round(allot)}秒以内に！`, 2, 'go');
          this._voice('hurry', 1, true);
          this._hint('hurry');
        }, 1600);
        this._updateHurryMarkers();
      }
    }

    // 乗客の動き
    const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
    const lx = fz, lz = -fx; // 左（ドア側）
    const mid = { x: bus.x + lx * 1.6, z: bus.z + lz * 1.6 };
    const front = { x: bus.x + fx * 4 + lx * 1.6, z: bus.z + fz * 4 + lz * 1.6 };
    this.passengers.alight(s, front, Math.min(14, res.off));
    this.passengers.setWaiting(s, res.waiting);
    const n = this.passengers.board(s, mid, res.board, () => this._boardOne(i));
    st.visualBoard = n;
    if (n < res.board) {
      // 見た目の人数が足りない分は時間差で精算
      for (let k = n; k < res.board; k++) setTimeout(() => this.run === run && st.status === 'serving' && this._boardOne(i), 300 + k * 150);
    }

    if (run.infoQueue && run.infoQueue.length) {
      const q = run.infoQueue;
      run.infoQueue = null;
      q.forEach((t, k) => setTimeout(() => this.run === run && this.hud.toast(t, 'info'), 1600 + k * 900));
    }
    if (res.leftBehind > 0) this.hud.toast(`満員で${res.leftBehind}人乗れず…`, 'warn');
  }

  /** ピタ止めで、どれだけずれていたか（「2.4m 手前」など） */
  _pitaAdvice(s, err, grade) {
    if (grade === 'perfect') return '';
    const ahead = this._pitaAhead(s, err);
    const parts = [];
    if (Math.abs(ahead) > 0.6) parts.push(`${Math.abs(ahead).toFixed(1)}m ${ahead > 0 ? '行き過ぎ' : '手前'}`);
    if (err.gap > 0.9) parts.push(`縁石まで ${err.gap.toFixed(1)}m`);
    return parts.join('・');
  }

  /** 目標までの残り（進行方向基準。負 = 手前、正 = 行き過ぎ） */
  _pitaAhead(s, err) {
    const sign = s.travel ? s.travel.x * s.along.x + s.travel.z * s.along.z : 1;
    return err.along * sign;
  }

  _boardOne(i) {
    const run = this.run;
    const st = run.stops[i];
    if (!st || st.boarded >= st.result.board) return;
    st.boarded++;
    run.onboard++;
    run.fare += RULES.farePerPassenger;
    this.bus.load = run.onboard / RULES.capacity;
    this.bus.setOnboard(run.onboard, RULES.capacity);
    if (run.onboard >= 45) this._unlock('full');
    this.audio.play('coin', { volume: 0.45, rate: 0.97 + Math.random() * 0.08, max: 3 });
    this._floatWorld(this.bus.x, 3.6, this.bus.z, `+¥${RULES.farePerPassenger}`, 'fare');
  }

  /** 走行中の演出: タイヤ痕・土煙・排気・乗客のひとこと・実績・音楽の盛り上がり */
  _updateDrivingFx(dt, input, skidding) {
    const run = this.run;
    const bus = this.bus;
    this.effects.skid.add(bus.rearWheels(), bus.h, skidding);
    run.dustT -= dt;
    if (bus._onCurb() && bus.speed > 4 && run.dustT <= 0) {
      run.dustT = 0.12;
      const w = bus.rearWheels()[Math.random() < 0.5 ? 0 : 1];
      this.effects.dust(w.x, w.z, 1);
    }
    if (skidding && bus.speed > 6 && run.dustT <= 0) {
      run.dustT = 0.1;
      const w = bus.rearWheels()[Math.random() < 0.5 ? 0 : 1];
      this.effects.dust(w.x, w.z, 1, ['#d8d8d8', '#c4c4c4', '#e8e8e8']);
    }
    run.exhaustT -= dt;
    if (input.throttle && bus.speed < 10 && run.exhaustT <= 0) {
      run.exhaustT = 0.09;
      const e = bus.exhaustPos();
      this.effects.exhaust(e.x, e.y, e.z, -Math.sin(bus.h) * 1.5, -Math.cos(bus.h) * 1.5);
    }
    // 電車にはねられたバスの煙
    if (run.smokeT > 0) {
      run.smokeT -= dt;
      if (Math.random() < dt * 14) this.effects.wreckSmoke(bus.x + (Math.random() - 0.5) * 3, bus.z + (Math.random() - 0.5) * 3);
    }
    // 事故車の煙
    for (const car of this.traffic.cars) {
      if ((car.state === 'fly' || car.state === 'sink') && Math.random() < dt * 6) this.effects.wreckSmoke(car.x, car.z);
    }
    // 乗客のひとこと
    run.voiceCd -= dt;
    run.fastCd -= dt;
    if (run.onboard > 0 && Math.abs(bus._aLat) > 8.5 && bus.speed > 8) this._voice('turn', 0.7);
    if (run.onboard > 0 && bus.speed > 19 && run.fastCd <= 0) {
      run.fastCd = 15;
      this._voice('fast', 1);
    }
    // 実績（走りから判定できるもの）
    if (bus.speed * 3.6 >= 72) this._unlock('speed');
    if (bus.handbrake && bus.slip > 3) {
      run.driftT += dt;
      if (run.driftT > 3) {
        this._unlock('drift');
        if (!run.driftClip) {
          run.driftClip = true;
          this._highlight('バスでドリフト', 35);
        }
      }
    } else run.driftT = 0;
    const c = Math.floor(bus.x / TILE), r = Math.floor(bus.z / TILE);
    if (tileAt(c, r) === T.ALLEY) {
      const k = ALLEYS.findIndex((a) => c >= a.rect[0] && c <= a.rect[2] && r >= a.rect[1] && r <= a.rect[3]);
      if (k >= 0 && !run.alleys.has(k)) {
        run.alleys.add(k);
        this.hud.toast(`近道：${ALLEYS[k].name}`, 'info');
        if (run.alleys.size === ALLEYS.length) this._unlock('alleys');
      }
    }
    // 動けなくなったときのヒント
    if (input.throttle && bus.speed < 0.3 && run.serving < 0) {
      run.stuckT += dt;
      if (run.stuckT > 2.5) this._hint('stuck');
    } else run.stuckT = 0;
  }

  /** バスの上に乗客のひとこと（chance で間引き、force でクールダウン無視） */
  _voice(kind, chance = 1, force = false) {
    const run = this.run;
    if (!run || this.state !== 'playing' && this.state !== 'result') return;
    if (!force && run.voiceCd > 0) return;
    if (Math.random() > chance) return;
    run.voiceCd = 3;
    const v = new THREE.Vector3(this.bus.x, 4.2, this.bus.z).project(this.camera);
    if (v.z > 1) return;
    this.hud.bubble((v.x * 0.5 + 0.5) * this.viewW + (Math.random() - 0.5) * 60, (-v.y * 0.5 + 0.5) * this.viewH, pickOne(VOICES[kind]));
  }

  _hint(id) {
    if (this.autopilot || this.settings.hints === false) return;
    const text = this.hints.take(id);
    if (text) this.hud.hint(text);
  }

  _unlock(id, toast = true) {
    if (this.autopilot) return;
    if (!unlockAchievement(id)) return;
    const a = achievementById(id);
    if (this.run) this.run.unlocked.push(id);
    if (toast && a) {
      this.hud.toast(`🏆 実績解除：${a.icon} ${a.name}`, 'achieve');
      this.audio.play('achievement', { volume: 0.7 });
    }
  }

  _updateMarker(dt) {
    const m = this.marker;
    if (!m.group.visible) return;
    const t = this.time;
    m.zoneMat.opacity = 0.22 + Math.sin(t * 4) * 0.08;
    m.arrow.position.y = 6.5 + Math.sin(t * 3) * 0.6;
    m.arrow.rotation.y += dt * 2;
    // 近づいたら停留所名の札は消す（画面上部の時計と重ならないように）
    const lp = m.label.position;
    m.label.visible = Math.hypot(lp.x - this.bus.x, lp.z - this.bus.z) > 38;
  }

  _updateHud() {
    const run = this.run;
    const bus = this.bus;
    if (run.rampage) return this._updateRampageHud();
    const idx = Math.min(run.next, this.stops.length - 1);
    const s = this.stops[idx];
    const st = run.stops[idx];
    const waiting = st.status === 'pending' ? st.shown : st.result ? st.result.waiting : s.wait;
    const delay = run.t - s.scheduled;
    // 距離はピタ止めの位置まで
    const tg = s.target || { x: s.zone.cx, z: s.zone.cz };
    const dx = tg.x - bus.x, dz = tg.z - bus.z;
    const dist = Math.hypot(dx, dz);
    // 進行方向に対する角度（画面上の矢印、上 = 前方）
    const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
    const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    const fine = run.ledger.total();
    if (this.state === 'playing') {
      const remain = run.limit - run.t;
      // 遅れている・時間が少ないときは音楽を盛り上げる
      const rush = remain < 60 || (st.status === 'pending' && delay > -4) ? 1 : 0;
      this.audio.setRush(rush);
      if (remain <= 30 && !run.warned) {
        run.warned = true;
        this.audio.play('alarm', { volume: 0.6 });
        this.hud.toast('残り 30 秒！', 'bad');
      }
      const sec = Math.ceil(remain);
      if (sec <= 10 && sec > 0 && sec !== run.lastTick) {
        run.lastTick = sec;
        this.audio.play('tick', { volume: 0.9 });
      }
      // 次の停留所に近づいたら「次、とまります」
      if (dist < 85 && st.status === 'pending' && !run.chimed.has(idx)) {
        run.chimed.add(idx);
        this.audio.play('next_stop', { volume: 0.6 });
        this.hud.toast(s.terminal ? '次は終点、限界駅です' : '次、とまります', 'info');
        if (idx === 0) this._hint('stopZone');
      }
      this.hud.speedLines(bus.speed * 3.6);
    }
    this.hud.update({
      nextIndex: Math.max(0, run.course.indexOf(idx)),
      total: run.course.length,
      nextName: s.name,
      nextKana: s.kana,
      nextSched: RULES.startClockSec + s.scheduled,
      timeToSched: s.scheduled - run.t,
      waiting,
      initialWaiting: s.wait,
      terminal: !!s.terminal,
      leaveIn: delay >= 0 && st.status === 'pending' ? RULES.lateStepSec - (delay % RULES.lateStepSec) : null,
      arrivedDelay: st.status !== 'pending' && st.result ? st.result.delay : null,
      arrivedOnTime: !!(st.result && st.result.onTime),
      grace: RULES.onTimeGraceSec,
      dist,
      arrowDeg: (ang * 180) / Math.PI,
      clock: RULES.startClockSec + run.t,
      remain: run.limit - run.t,
      fare: run.fare,
      bonus: run.bonus,
      extra: run.skill + run.tips + run.maki,
      fine,
      speedKmh: bus.speed * 3.6,
      onboard: run.onboard,
      capacity: RULES.capacity,
    });
    // 大通り経由のおすすめルート（1秒ごとに再計算）
    this._routeT = (this._routeT || 0) - 1;
    if (this._routeT <= 0 || this._routeFor !== idx) {
      this._routeT = 30;
      this._routeFor = idx;
      const from = { c: Math.floor(bus.x / TILE), r: Math.floor(bus.z / TILE) };
      const to = { c: s.c, r: s.r };
      const hd = headingDir(bus.h);
      if (inZone(s, bus.x, bus.z) || (from.c === to.c && from.r === to.r)) {
        // もう停留所の枠の中：道順は出さず、停止位置だけを結ぶ（同じタイルから探すと街区を一周してしまう）
        this._route = [{ x: bus.x, z: bus.z }, s.target ? { x: s.target.x, z: s.target.z } : { x: s.zone.cx, z: s.zone.cz }];
        this._routeT = 8;
      } else {
        const p = approachPath(from, s, false, run.blocked, hd) || approachPath(from, s, true, run.blocked, hd) || shortestPath(from, to, true);
        this._route = p ? p.path.map((t) => tileCenter(t.c, t.r)) : null;
      }
    }
    this.hud.missions(this._missions());
    // ピタ止めのガイド（停留所の手前 26m から）
    if (this.state === 'playing' && st.status === 'pending' && run.serving < 0 && s.target && dist < 26) {
      const err = stopError(s, bus.x, bus.z);
      // 終点のロータリーは入ってくる向きが決まらないので、距離だけで案内
      const ahead = s.terminal ? -dist : this._pitaAhead(s, err);
      this.hud.pitaGuide(ahead, !s.terminal && err.gap > 1.6 && Math.abs(ahead) < 8);
    } else this.hud.pitaGuide(null);
    this.minimap.draw({
      route: this._route,
      bus: { x: bus.x, z: bus.z, h: bus.h },
      next: idx,
      stopStates: run.stops.map((x) => x.status),
      cars: this.traffic.cars,
      time: this.time,
      visible: this.ui.minimapVisible(),
      closures: run.closures.map((c) => c.seg),
      rival: this.rival.state === 'race' ? { x: this.rival.x, z: this.rival.z } : null,
      hurryTo: run.hurry.filter((h) => h.state === 'riding').map((h) => h.to),
    });
  }

  /** HUD に並べる進行中の目標 */
  _missions() {
    const run = this.run;
    const out = [];
    if (run.combo >= 1) {
      const nextBonus = comboBonus(run.combo + 1, run.mods.comboMult);
      out.push({ cls: run.combo >= 3 ? 'combo hot' : 'combo', text: `🔥 定時コンボ ×${run.combo}　次 +¥${nextBonus.toLocaleString()}` });
    }
    for (const h of run.hurry) {
      if (h.state === 'riding') {
        const left = Math.max(0, Math.ceil(h.deadline - run.t));
        out.push({ cls: left <= 20 ? 'hurry danger' : 'hurry', text: `🏃 急ぎ客 → ${this.stops[h.to].name}　あと ${left}秒` });
      } else if (h.state === 'waiting' && h.from === run.next) {
        out.push({ cls: 'hurry', text: `🏃 ${this.stops[h.from].name}に急ぎの客（チップ ¥${(RULES.hurryTip * run.mods.tipMult).toLocaleString()}）` });
      }
    }
    if (this.rival.state === 'race' && run.rivalTarget >= 0) {
      const s = this.stops[run.rivalTarget];
      const me = Math.hypot(s.zone.cx - this.bus.x, s.zone.cz - this.bus.z);
      const rv = Math.hypot(s.zone.cx - this.rival.x, s.zone.cz - this.rival.z);
      out.push({ cls: 'rival', text: `🏁 ライバルと「${s.name}」争奪戦　${me <= rv ? 'リード中' : '負けてる！'}` });
    }
    return out;
  }

  _updateRampageHud() {
    const run = this.run;
    const bus = this.bus;
    const rp = run.rampage;
    const remain = run.limit - run.t;
    if (this.state === 'playing') {
      this.audio.setRush(remain < 40 || rp.chain >= 3 ? 1 : 0);
      const sec = Math.ceil(remain);
      if (sec <= 10 && sec > 0 && sec !== run.lastTick) {
        run.lastTick = sec;
        this.audio.play('tick', { volume: 0.9 });
      }
      this.hud.speedLines(bus.speed * 3.6);
    }
    this.hud.rampage({
      points: rp.points,
      chain: rp.chain,
      mult: rampageMultiplier(rp.chain),
      destroyed: rp.destroyed,
      window: rp.chain > 0 ? 1 - (run.t - rp.lastHitT) / RAMPAGE.comboWindow : 0,
      remain,
      clockText: formatClock(RULES.startClockSec + run.t),
      speedKmh: bus.speed * 3.6,
    });
    this.minimap.draw({
      route: null,
      bus: { x: bus.x, z: bus.z, h: bus.h },
      next: -1,
      stopStates: run.stops.map(() => 'done'),
      cars: this.traffic.cars,
      time: this.time,
      visible: this.ui.minimapVisible(),
    });
  }

  // ---------------- カメラ ----------------
  _updateCamera(dt, pose) {
    const cam = this.camera;
    const c = this.cam;
    if (this.state === 'title' || (this.state === 'result' && !this.run)) {
      // タイトル: 営業所付近をゆっくり旋回
      const a = this.time * 0.08;
      const cx = 120, cz = 90;
      cam.position.set(cx + Math.cos(a) * 95, 48, cz + Math.sin(a) * 95);
      cam.lookAt(cx, 6, cz);
      cam.fov = 55;
      cam.updateProjectionMatrix();
      this._camSnap = true;
      return;
    }
    const fx = Math.sin(pose.h), fz = Math.cos(pose.h);
    // 撮影用のカメラ指定（yaw: 0 = 真後ろ、90 = 右横、180 = 正面。spin で旋回）
    if (this.camOverride && this.state !== 'result') {
      const o = this.camOverride;
      o.t = (o.t || 0) + dt;
      const yaw = pose.h + Math.PI - ((o.yaw + (o.spin || 0) * o.t) * Math.PI) / 180;
      let want, look;
      if (o.pos) {
        // 固定カメラ（look がなければバスを見る）
        want = new THREE.Vector3(o.pos[0] + (o.drift ? o.drift[0] * o.t : 0), o.pos[1], o.pos[2] + (o.drift ? o.drift[1] * o.t : 0));
        look = o.look ? new THREE.Vector3(...o.look) : new THREE.Vector3(pose.x, 1.6, pose.z);
      } else {
        want = new THREE.Vector3(pose.x + Math.sin(yaw) * o.dist, o.height, pose.z + Math.cos(yaw) * o.dist);
        look = new THREE.Vector3(pose.x + fx * (o.lookAhead || 0), o.lookY ?? 1.6, pose.z + fz * (o.lookAhead || 0));
      }
      if (this._camSnap) {
        c.pos.copy(want);
        c.look.copy(look);
        this._camSnap = false;
      } else {
        c.pos.lerp(want, 1 - Math.exp(-dt * (o.follow || 6)));
        c.look.lerp(look, 1 - Math.exp(-dt * 10));
      }
      cam.position.copy(c.pos);
      if (c.shake > 0) {
        cam.position.x += (Math.random() - 0.5) * c.shake;
        cam.position.y += (Math.random() - 0.5) * c.shake;
        c.shake = Math.max(0, c.shake - dt * 1.6);
      }
      cam.lookAt(c.look);
      if (cam.fov !== (o.fov || 55)) {
        cam.fov = o.fov || 55;
        cam.updateProjectionMatrix();
      }
      return;
    }
    // 停留所に近づいてゆっくり走っているときは、カメラを高くして白枠を見やすくする
    let k = 0;
    const run = this.run;
    if (run && !run.rampage && this.state === 'playing') {
      const s = this.stops[Math.min(run.next, this.stops.length - 1)];
      if (s && s.target) {
        const d = Math.hypot(s.target.x - pose.x, s.target.z - pose.z);
        k = Math.max(0, Math.min(1, (28 - d) / 14)) * Math.max(0, Math.min(1, (11 - this.bus.speed) / 5));
      }
    }
    c.stopK = (c.stopK || 0) + (k - (c.stopK || 0)) * Math.min(1, dt * 2.2);
    const K = c.stopK;
    // 路地では軒先や看板にカメラが埋まらないよう、近く・高くから見下ろす
    const inAlley = tileAt(Math.floor(pose.x / TILE), Math.floor(pose.z / TILE)) === T.ALLEY ? 1 : 0;
    c.alleyK = (c.alleyK || 0) + (inAlley - (c.alleyK || 0)) * Math.min(1, dt * 2.5);
    const A = c.alleyK * (1 - K);
    let dist = 13.5 - 2.5 * K - 4 * A, height = 6.4 + 6.5 * K + 4 * A;
    if (this.state === 'result') {
      const a = this.time * 0.3;
      cam.position.set(pose.x + Math.cos(a) * 22, 13, pose.z + Math.sin(a) * 22);
      cam.lookAt(pose.x, 1.5, pose.z);
      return;
    }
    // 建物にめり込まないように手前へ
    for (let d = 2; d <= dist; d += 1) {
      const px = pose.x - fx * d, pz = pose.z - fz * d;
      const tc = Math.floor(px / TILE), tr = Math.floor(pz / TILE);
      const rect = solidRectForTile(tc, tr);
      if (rect && px > rect.x0 - 0.5 && px < rect.x1 + 0.5 && pz > rect.z0 - 0.5 && pz < rect.z1 + 0.5) {
        dist = Math.max(5, d - 1);
        height = Math.max(height, 6.4 + (13.5 - dist) * 0.45);
        break;
      }
    }
    // 電柱がバスとカメラの間に入るなら、電柱より手前（バス寄り）にカメラを寄せる
    const poles = this.city.poles;
    if (poles) {
      for (const p of poles) {
        const rx = pose.x - p.x, rz = pose.z - p.z;
        if (Math.abs(rx) > dist + 2 || Math.abs(rz) > dist + 2) continue;
        const t = rx * fx + rz * fz; // バスから後ろ向きに測った電柱までの距離
        if (t < 2.5 || t > dist + 1) continue;
        if (Math.abs(rx * fz - rz * fx) < 1.1) {
          dist = Math.max(5, Math.min(dist, t - 1.4));
          height = Math.max(height, 6.4 + (13.5 - dist) * 0.45);
        }
      }
    }
    const want = new THREE.Vector3(pose.x - fx * dist, height + this.bus.lift + this.bus.air * 0.7, pose.z - fz * dist);
    const look = new THREE.Vector3(pose.x + fx * (5 + 2 * K), 1.8 - 1.2 * K, pose.z + fz * (5 + 2 * K));
    if (this._camSnap) {
      c.pos.copy(want);
      c.look.copy(look);
      this._camSnap = false;
    } else {
      const k = 1 - Math.exp(-dt * 5.5);
      c.pos.lerp(want, k);
      c.look.lerp(look, 1 - Math.exp(-dt * 9));
    }
    cam.position.copy(c.pos);
    if (c.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * c.shake;
      cam.position.y += (Math.random() - 0.5) * c.shake;
      c.shake = Math.max(0, c.shake - dt * 1.6);
    }
    cam.lookAt(c.look);
    const fov = 60 + Math.min(10, this.bus.speed * 0.45);
    c.fov += (fov - c.fov) * Math.min(1, dt * 3);
    if (Math.abs(cam.fov - c.fov) > 0.05) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
  }
}

export { formatClock };
