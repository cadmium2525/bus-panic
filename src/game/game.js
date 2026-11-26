// ゲーム本体: 描画・ループ・状態遷移・停留所処理・スコア
import * as THREE from 'three';
import { RULES, PENALTY, QUALITY, PHYSICS_DT, BUS } from '../config.js';
import { buildCity } from '../world/city.js';
import { createSky } from '../world/sky.js';
import { MeshBuilder } from '../world/meshBuilder.js';
import { busStopPlateTexture, labelTexture } from '../world/textures.js';
import { Props } from '../entities/props.js';
import { Bus } from '../entities/bus.js';
import { Traffic } from '../entities/traffic.js';
import { Passengers } from '../entities/passengers.js';
import { createStops, inZone, START } from './stops.js';
import { remainingPassengers, resolveStop, dwellTime, computeScore, rankFor, PenaltyLedger, formatClock } from './rules.js';
import { SpatialHash } from '../core/collision.js';
import { TILE, N, T, tileAt, isDrivableType, solidRectForTile, H_ROADS, V_ROADS, ALLEYS } from '../world/map.js';
import { Autopilot } from './autopilot.js';

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
    this.city = buildCity(this.scene, { decorDensity: this.q.decorDensity, stops: this.stops });
    this.sky = createSky(this.scene);
    this.staticHash = new SpatialHash(16);
    for (const c of this.city.colliders.circles) this.staticHash.insertAABB(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);

    this.props = new Props(this.scene, this.city.spawns, {
      onHit: (it, t) => this._onPropHit(it, t),
      shadows: this.q.shadows,
    });
    this.props.onSplash = (it) => {
      this.audio.sfxSplash();
      this._floatWorld(it.x, -1, it.z, 'ドボン！', 'splash');
    };
    this.bus = new Bus(this.scene);
    this.traffic = new Traffic(this.scene, this.city.intersections, {
      count: this.q.cars,
      onHit: (car, t) => this._onCarHit(car, t),
      onHonk: (car) => {
        if (this.state === 'playing' && Math.hypot(car.x - this.bus.x, car.z - this.bus.z) < 40) this.audio.sfxHorn();
      },
    });
    this.passengers = new Passengers(this.scene, 260);
    this._buildStopVisuals();
    this._buildMarker();

    this.minimap = minimap;
    const ap = debug.autopilot;
    this.autopilot = ap
      ? new Autopilot(ap.includes('fast') ? { alleys: ap.includes('alley'), cruise: 19.5, turnSpeed: 8.5, decel: 8.5 } : { alleys: ap.includes('alley') })
      : null;

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
    requestAnimationFrame(this._loop);
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
    m.beam.position.set(zn.cx, 30, zn.cz);
    m.arrow.position.set(zn.cx, 6.5, zn.cz);
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
    this.run = null;
    this._setMarker(null);
  }

  startRun() {
    this.audio.unlock();
    // やり直し時は壊れた小物も元に戻す
    this._rebuildProps();
    this._resetWorld();
    const lastStop = this.stops[this.stops.length - 1];
    this.run = {
      t: 0,
      stops: this.stops.map((s) => ({ status: 'pending', arrival: null, result: null, boarded: 0, dwell: 0, elapsed: 0, shown: s.wait })),
      next: 0,
      onboard: 0,
      fare: 0,
      bonus: 0,
      ledger: new PenaltyLedger(),
      limit: lastStop.scheduled + RULES.timeLimitMarginSec,
      impactCd: 0,
      countdown: 3.4,
      lastCount: 4,
      serving: -1,
      terminalHold: 0,
      finished: false,
      resets: 0,
      maxSpeed: 0,
    };
    // デバッグ: 途中の停留所から開始
    const from = this.debug.startStop | 0;
    if (from > 0 && from < this.stops.length) {
      const ps = this.stops[from - 1];
      const hd = { N: Math.PI / 2, S: -Math.PI / 2, E: 0, W: Math.PI }[ps.curb];
      this.bus.reset(ps.zone.cx, ps.zone.cz, hd);
      for (let k = 0; k < from; k++) this.run.stops[k].status = 'done';
      this.run.next = from;
      this.run.t = this.stops[from - 1].scheduled;
      this._setMarker(this.stops[from]);
    }
    this.state = 'countdown';
    this.hud.show(true);
    this.ui.showScreen(null);
    if (!(this.debug.startStop > 0)) this._setMarker(this.stops[0]);
    this.audio.startEngine();
    this.audio.say('ご乗車ありがとうございます。このバスは、げんかいえき行きです。');
    this._camSnap = true;
  }

  _rebuildProps() {
    // 前回の破損状態をリセット
    for (const m of this.props.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.props = new Props(this.scene, this.city.spawns, { onHit: (it, t) => this._onPropHit(it, t), shadows: this.q.shadows });
    this.props.onSplash = (it) => {
      this.audio.sfxSplash();
      this._floatWorld(it.x, -1, it.z, 'ドボン！', 'splash');
    };
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    this.input.releaseAll();
    this.audio.suspend();
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this._pausedFrom || 'playing';
    this.audio.resume();
    this.ui.showScreen(null);
    this._last = performance.now();
  }

  toTitle() {
    this.state = 'title';
    this.audio.stopEngine();
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
    this.hud.dwell(null);
    const allStops = reason === 'clear' && run.stops.every((s) => s.status === 'done');
    const ledger = run.ledger;
    const damage = ledger.total((it) => ['cone', 'sign', 'guardrail', 'car'].includes(it.kind));
    const other = ledger.total((it) => ['reset', 'impact'].includes(it.kind));
    const score = computeScore({ fare: run.fare, onTimeBonus: run.bonus, allStops, damage, other });
    const rank = rankFor(score.total);
    const result = {
      reason,
      ...score,
      rank: rank.rank,
      comment: rank.comment,
      stopsServed: run.stops.filter((s) => s.status === 'done').length,
      stops: this.stops.map((s, i) => ({
        name: s.name,
        scheduled: RULES.startClockSec + s.scheduled,
        arrival: run.stops[i].arrival != null ? RULES.startClockSec + run.stops[i].arrival : null,
        delay: run.stops[i].result ? run.stops[i].result.delay : null,
        board: run.stops[i].result ? run.stops[i].result.board : 0,
        lost: run.stops[i].result ? run.stops[i].result.lost : s.wait,
        status: run.stops[i].status,
        terminal: !!s.terminal,
      })),
      counts: {
        cone: ledger.count('cone'),
        sign: ledger.count('sign'),
        guardrail: ledger.count('guardrail'),
        car: ledger.count('car'),
        impact: ledger.count('impact'),
        reset: ledger.count('reset'),
      },
      damageByKind: {
        cone: ledger.total((it) => it.kind === 'cone'),
        sign: ledger.total((it) => it.kind === 'sign'),
        guardrail: ledger.total((it) => it.kind === 'guardrail'),
        car: ledger.total((it) => it.kind === 'car'),
      },
      time: run.t,
    };
    this.lastResult = result;
    if (reason === 'clear') {
      this.audio.sfxFanfare();
      this.audio.say('終点、げんかいえきです。ご乗車ありがとうございました。');
    } else this.audio.sfxPenalty();
    this.hud.big(reason === 'clear' ? '終点到着！' : '時間切れ…', reason === 'clear' ? 'おつかれさまでした' : '運行打ち切り', 2.2, reason === 'clear' ? 'good' : 'bad');
    setTimeout(() => {
      if (this.state === 'result' && this.lastResult === result) {
        this.hud.show(false);
        this.ui.showResult(result);
      }
    }, 2300);
  }

  // ---------------- イベント ----------------
  _onPropHit(it, t) {
    const run = this.run;
    if (!run || this.state !== 'playing' || it.noCharge) {
      this._propSfx(it.kind.cls);
      return;
    }
    const p = PENALTY[it.kind.cls];
    if (run.ledger.charge(it.id, it.kind.cls, p.amount, it.kind.label, run.t)) {
      this._floatWorld(it.x, 1.5, it.z, `−¥${p.amount.toLocaleString()} ${it.kind.label}`, 'fine');
      this._propSfx(it.kind.cls);
      if (it.kind.cls === 'guardrail') this.cam.shake = Math.max(this.cam.shake, 0.35);
    }
  }

  _propSfx(cls) {
    if (cls === 'cone') this.audio.sfxCone();
    else if (cls === 'sign') this.audio.sfxSign();
    else if (cls === 'guardrail') this.audio.sfxGuardrail();
  }

  _onCarHit(car, t) {
    const run = this.run;
    this.audio.sfxCar();
    this.cam.shake = Math.max(this.cam.shake, 0.7);
    if (!run || this.state !== 'playing') return;
    car.gen = (car.gen || 0) + 1;
    const id = `${car.id}#${car.gen}`;
    if (run.ledger.charge(id, 'car', PENALTY.car.amount, PENALTY.car.label, run.t)) {
      this._floatWorld(car.x, 2, car.z, `−¥${PENALTY.car.amount.toLocaleString()} 他車に衝突！`, 'fine big');
      this.hud.toast('他車に衝突！ 罰金 ¥3,000', 'bad');
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
    this.audio.sfxPenalty();
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
    if (inp.consume('Escape') || inp.consume('KeyP')) {
      if (this.state === 'paused') this.resume();
      else this.pause();
    }
    if (inp.consume('KeyR')) this.resetBus();
    if (inp.consume('KeyM')) this.ui.toggleMinimap();
    if (inp.consume('KeyH') && this.state === 'playing') this.audio.sfxBusHorn();

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
    this._updateCamera(dt, pose);
    this._updateMarker(dt);
    this.sky.update(this.camera);
    if (this.q.shadows) {
      this.sun.position.set(pose.x - 60, 110, pose.z + 40);
      this.sun.target.position.set(pose.x, 0, pose.z);
    }
    if (this.run && (this.state === 'playing' || this.state === 'countdown' || this.state === 'paused')) this._updateHud();
    this.renderer.render(this.scene, this.camera);
    inp.endFrame();
  }

  _step(dt) {
    const run = this.run;
    const playing = this.state === 'playing';
    let input = { throttle: false, brake: false, steer: 0, handbrake: false };
    if (playing) {
      if (this.autopilot) {
        const target = run.stops[run.next] ? this.stops[run.next] : this.stops[this.stops.length - 1];
        input = this.autopilot.drive(this.bus, target, dt);
      } else input = this.input.drive();
      // 乗降中はドアが開いているので発車できない
      if (run.serving >= 0) input = { throttle: false, brake: false, steer: input.steer, handbrake: false, hold: true };
    } else if (this.state === 'countdown' || this.state === 'title' || this.state === 'result') {
      input.hold = true;
    }

    const env = {
      staticHash: this.staticHash,
      cars: this.traffic.cars,
      props: this.props,
      t: run ? run.t : 0,
      onCarHit: (car, bus, hit) => {
        if (!playing) return;
        this.traffic.handleBusHit(car, bus, hit, run.t);
      },
    };
    this.bus.lastImpactJ = 0;
    const res = this.bus.step(dt, input, env);
    this.traffic.update(dt, this.bus, this.props);
    this.props.update(dt);

    if (this.state === 'countdown') {
      run.countdown -= dt;
      const n = Math.ceil(run.countdown - 0.4);
      if (n !== run.lastCount && n >= 0) {
        run.lastCount = n;
        if (n > 0) {
          this.hud.big(String(n), '発車準備', 0.9, 'count');
          this.audio.sfxCount(false);
        } else {
          this.hud.big('発車オーライ！', '1番 ' + this.stops[0].name + ' へ', 1.4, 'go');
          this.audio.sfxCount(true);
          this.state = 'playing';
        }
      }
      return;
    }
    if (!playing) return;

    run.t += dt;
    run.maxSpeed = Math.max(run.maxSpeed, this.bus.speed);
    this.audio.updateEngine(this.bus.speed, input.throttle);

    // 衝撃で乗客転倒
    run.impactCd -= dt;
    if (res.impact > 1.8) {
      this.audio.sfxWall(res.impact);
      this.cam.shake = Math.max(this.cam.shake, Math.min(0.8, res.impact * 0.06));
    }
    if (res.impact * 3.6 >= RULES.impactSpeedKmh && run.onboard > 0 && run.impactCd <= 0) {
      run.impactCd = 2;
      run.ledger.chargeEvent('impact', RULES.impactPenalty, '乗客転倒', run.t);
      this.hud.toast(`激突！ 乗客が転倒 −¥${RULES.impactPenalty}`, 'bad');
    }

    this._updateStops(dt);

    if (run.t >= run.limit && !run.finished) this._finish('timeout');
  }

  _updateStops(dt) {
    const run = this.run;
    const bus = this.bus;
    const slow = bus.speed * 3.6 <= RULES.stopSpeedKmh;
    const lastIdx = this.stops.length - 1;

    // 待機客の減少（未到着の停留所）
    for (let i = 0; i < this.stops.length; i++) {
      const st = run.stops[i];
      if (st.status !== 'pending') continue;
      const s = this.stops[i];
      const n = remainingPassengers(s.wait, run.t - s.scheduled);
      if (n < st.shown) {
        this.passengers.setWaiting(s, n);
        if (i === run.next) this.hud.toast(`${s.name}の客が待ちきれずに帰った… 残り${n}人`, 'warn');
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
        bus.doorTarget = 0;
        this.hud.dwell(null);
        this.audio.sfxDoor();
        if (s.terminal) {
          this._finish('clear');
          return;
        }
        run.next = i + 1;
        const ns = this.stops[run.next];
        this._setMarker(ns);
        this.audio.sfxChime();
        this.audio.say(`発車します。次は、${ns.kana}です。`);
        this.hud.toast(`次は ${ns.name}`, 'info');
      }
      return;
    }

    if (!slow) {
      run.terminalHold = 0;
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
      }
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
      initialWaiting: s.wait,
      alighting: s.terminal ? run.onboard : s.off,
      scheduledSec: s.scheduled,
      arrivalSec: run.t,
      onboard: run.onboard,
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
    if (res.bonus) run.bonus += res.bonus;
    this.audio.sfxDoor();

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

    if (s.terminal) {
      this.hud.big('終点 限界駅', res.onTime ? '定時到着！ +¥' + res.bonus : `遅延 ${Math.round(res.delay)}秒`, 2, res.onTime ? 'good' : 'bad');
    } else if (res.onTime) {
      this.hud.big('定時到着！', `+¥${res.bonus} ボーナス`, 1.4, 'good');
    } else {
      this.hud.big(`遅延 ${Math.round(res.delay)}秒`, res.lost > 0 ? `${res.lost}人が待ちきれず帰宅…` : 'お客様はまだ待っていた', 1.6, 'bad');
    }
    if (res.leftBehind > 0) this.hud.toast(`満員で${res.leftBehind}人乗れず…`, 'warn');
  }

  _boardOne(i) {
    const run = this.run;
    const st = run.stops[i];
    if (!st || st.boarded >= st.result.board) return;
    st.boarded++;
    run.onboard++;
    run.fare += RULES.farePerPassenger;
    this.bus.load = run.onboard / RULES.capacity;
    this.audio.sfxCoin();
    this._floatWorld(this.bus.x, 3.6, this.bus.z, `+¥${RULES.farePerPassenger}`, 'fare');
  }

  _updateMarker(dt) {
    const m = this.marker;
    if (!m.group.visible) return;
    const t = this.time;
    m.zoneMat.opacity = 0.22 + Math.sin(t * 4) * 0.08;
    m.arrow.position.y = 6.5 + Math.sin(t * 3) * 0.6;
    m.arrow.rotation.y += dt * 2;
  }

  _updateHud() {
    const run = this.run;
    const bus = this.bus;
    const idx = Math.min(run.next, this.stops.length - 1);
    const s = this.stops[idx];
    const st = run.stops[idx];
    const waiting = st.status === 'pending' ? st.shown : st.result ? st.result.waiting : s.wait;
    const delay = run.t - s.scheduled;
    const dx = s.zone.cx - bus.x, dz = s.zone.cz - bus.z;
    const dist = Math.hypot(dx, dz);
    // 進行方向に対する角度（画面上の矢印、上 = 前方）
    const fx = Math.sin(bus.h), fz = Math.cos(bus.h);
    const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    const fine = run.ledger.total();
    this.hud.update({
      nextIndex: idx,
      total: this.stops.length,
      nextName: s.name,
      nextKana: s.kana,
      nextSched: RULES.startClockSec + s.scheduled,
      timeToSched: s.scheduled - run.t,
      waiting,
      initialWaiting: s.wait,
      terminal: !!s.terminal,
      leaveIn: delay >= 0 && st.status === 'pending' ? RULES.lateStepSec - (delay % RULES.lateStepSec) : null,
      dist,
      arrowDeg: (ang * 180) / Math.PI,
      clock: RULES.startClockSec + run.t,
      remain: run.limit - run.t,
      fare: run.fare,
      bonus: run.bonus,
      fine,
      speedKmh: bus.speed * 3.6,
      onboard: run.onboard,
      capacity: RULES.capacity,
    });
    this.minimap.draw({
      bus: { x: bus.x, z: bus.z, h: bus.h },
      next: idx,
      stopStates: run.stops.map((x) => x.status),
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
    let dist = 13.5, height = 6.4;
    if (this.state === 'result') {
      const a = this.time * 0.3;
      cam.position.set(pose.x + Math.cos(a) * 20, 9, pose.z + Math.sin(a) * 20);
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
        height = 6.4 + (13.5 - dist) * 0.45;
        break;
      }
    }
    const want = new THREE.Vector3(pose.x - fx * dist, height + this.bus.lift, pose.z - fz * dist);
    const look = new THREE.Vector3(pose.x + fx * 5, 1.8, pose.z + fz * 5);
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
