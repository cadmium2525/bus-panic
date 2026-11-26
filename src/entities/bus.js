// 路線バス: モデル生成と簡易車両物理（キネマティック二輪モデル＋横滑り）
import * as THREE from 'three';
import { BUS } from '../config.js';
import { MeshBuilder } from '../world/meshBuilder.js';
import { busSideTexture, destinationTexture, LIVERIES } from '../world/textures.js';
import { TILE, tileAt, solidRectForTile, T } from '../world/map.js';
import { circleVsAABB, circleVsCircle } from '../core/collision.js';

const SIDE_PLAIN = [0.01, 0.99];

function buildModel(lv = LIVERIES.genkai) {
  const root = new THREE.Group();
  root.name = 'bus';
  const body = new THREE.Group(); // ロール・ピッチ・バウンドを与える
  root.add(body);

  const L = BUS.length / 2, W = BUS.width / 2;
  const y0 = 0.42, y1 = 3.05;
  const sideTex = busSideTexture(lv);

  // 車体（側面にストライプと社名）
  const shell = new MeshBuilder(SIDE_PLAIN);
  const wy0 = 1.65, wy1 = 2.7; // 窓の帯
  const v = (y) => (y - y0) / (y1 - y0);
  // 側面（左 +x は前から後ろへ u が増える、右 -x は後ろから前へ）
  const sideL = (za, zb, ya, yb) => shell.quad([W, ya, za], [W, ya, zb], [W, yb, zb], [W, yb, za], '#ffffff', [[(L - za) / (2 * L), v(ya)], [(L - zb) / (2 * L), v(ya)], [(L - zb) / (2 * L), v(yb)], [(L - za) / (2 * L), v(yb)]]);
  const sideR = (za, zb, ya, yb) => shell.quad([-W, ya, za], [-W, ya, zb], [-W, yb, zb], [-W, yb, za], '#ffffff', [[(za + L) / (2 * L), v(ya)], [(zb + L) / (2 * L), v(ya)], [(zb + L) / (2 * L), v(yb)], [(za + L) / (2 * L), v(yb)]]);
  sideL(L, -L, y0, wy0);
  sideL(L, -L, wy1, y1);
  sideL(L, 3.2, wy0, wy1);
  sideL(-4.7, -L, wy0, wy1);
  sideR(-L, L, y0, wy0);
  sideR(-L, L, wy1, y1);
  sideR(4.7, L, wy0, wy1);
  sideR(-L, -4.7, wy0, wy1);
  shell.quad([-W, y0, L], [W, y0, L], [W, y1, L], [-W, y1, L], '#f7f5ee'); // 前
  // 後面（後ろの窓の部分はくり抜く）
  shell.quad([W, y0, -L], [-W, y0, -L], [-W, 1.9, -L], [W, 1.9, -L], '#f7f5ee');
  shell.quad([W, 2.7, -L], [-W, 2.7, -L], [-W, y1, -L], [W, y1, -L], '#f7f5ee');
  shell.quad([W, 1.9, -L], [W - 0.3, 1.9, -L], [W - 0.3, 2.7, -L], [W, 2.7, -L], '#f7f5ee');
  shell.quad([-W + 0.3, 1.9, -L], [-W, 1.9, -L], [-W, 2.7, -L], [-W + 0.3, 2.7, -L], '#f7f5ee');
  shell.quad([-W, y1, L], [W, y1, L], [W, y1, -L], [-W, y1, -L], '#e9e7df'); // 屋根
  shell.quad([-W, y0, -L], [W, y0, -L], [W, y0, L], [-W, y0, L], '#333'); // 床下
  const shellMat = new THREE.MeshLambertMaterial({ map: sideTex, vertexColors: true });
  const shellMesh = new THREE.Mesh(shell.build(), shellMat);
  shellMesh.castShadow = true;
  body.add(shellMesh);

  // ガラス・バンパー・ライトなどの単色部品
  const parts = new MeshBuilder();
  const glass = '#22313c';
  const e = 0.015;
  // 側窓・前後のガラスは半透明（車内の乗客が見える）
  const glassB = new MeshBuilder();
  glassB.quad([W + e, 1.65, 3.2], [W + e, 1.65, -4.7], [W + e, 2.7, -4.7], [W + e, 2.7, 3.2], glass);
  glassB.quad([-W - e, 1.65, -4.7], [-W - e, 1.65, 4.7], [-W - e, 2.7, 4.7], [-W - e, 2.7, -4.7], glass);
  glassB.quad([-W + 0.1, 1.0, L + e], [W - 0.1, 1.0, L + e], [W - 0.1, 2.75, L + e], [-W + 0.1, 2.75, L + e], glass);
  glassB.quad([W - 0.3, 1.9, -L - e], [-W + 0.3, 1.9, -L - e], [-W + 0.3, 2.7, -L - e], [W - 0.3, 2.7, -L - e], glass);
  const glassMesh = new THREE.Mesh(glassB.build(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
  glassMesh.renderOrder = 2;
  body.add(glassMesh);
  // 車内（暗い内壁・座席の背もたれ）
  const inner = new MeshBuilder();
  inner.box(-W + 0.05, 0.45, -L + 0.05, W - 0.05, 3.0, L - 0.05, '#3a3f45', { top: false, bottom: true });
  const innerMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.BackSide });
  const innerMesh = new THREE.Mesh(inner.build(), innerMat);
  body.add(innerMesh);
  // 乗客の頭（乗車人数に応じて表示数が変わる）
  const headGeo = new MeshBuilder();
  headGeo.blob(0, 0, 0, 0.17, '#f1c9a5', 0.2);
  headGeo.blob(0, 0.1, -0.02, 0.17, '#2a1f1a', 0.1);
  // 0 番目は運転手（前の右側）、続いて座席・立ち客
  const seats = [[-0.75, 1.95, 4.55]];
  const rows = [];
  for (let z = -4.1; z < 3.2; z += 0.9) rows.push(z);
  // 前から順に埋まるように並べる
  rows.reverse().forEach((z) => { seats.push([0.75, 1.88, z], [-0.75, 1.88, z]); });
  for (let z = 2.6; z > -3.8; z -= 0.75) seats.push([((Math.abs(z) * 7) % 0.5) - 0.25, 2.05, z]); // 立っている人
  const heads = new THREE.InstancedMesh(headGeo.build(), new THREE.MeshLambertMaterial({ vertexColors: true }), seats.length);
  const dm = new THREE.Object3D();
  seats.forEach((p, i) => {
    dm.position.set(p[0], p[1], p[2]);
    dm.rotation.y = i === 0 ? 0 : Math.PI + ((i * 1.7) % 1) - 0.5;
    dm.updateMatrix();
    heads.setMatrixAt(i, dm.matrix);
  });
  heads.count = 1;
  body.add(heads);
  // 座席の背もたれ
  for (const z of rows) for (const sx of [1, -1]) parts.box(sx * 0.75 - 0.35, 0.9, z - 0.38, sx * 0.75 + 0.35, 1.75, z - 0.28, '#2f6f8f');
  // 運転席側の窓枠（柱）
  for (let z = -3.7; z < 4.6; z += 1.45) {
    parts.box(W + e, 1.65, z, W + 2 * e, 2.7, z + 0.1, '#e8e6de', { top: false });
    parts.box(-W - 2 * e, 1.65, z, -W - e, 2.7, z + 0.1, '#e8e6de', { top: false });
  }
  // 後面: エンジングリル・反射板・ロゴ板
  for (let k = 0; k < 5; k++) parts.box(-0.9, 0.78 + k * 0.13, -L - 0.03, 0.9, 0.84 + k * 0.13, -L, '#3b3f44', { top: false });
  for (const sx of [1, -1]) parts.box(sx * 0.95 - 0.12, 0.62, -L - 0.03, sx * 0.95 + 0.12, 0.72, -L, '#c0181c', { top: false });
  parts.box(-W, 1.55, -L - 0.02, W, 1.65, -L, '#1f8a4c', { top: false });
  // バンパー
  parts.box(-W - 0.02, 0.3, L - 0.05, W + 0.02, 0.72, L + 0.12, '#2b2b2b');
  parts.box(-W - 0.02, 0.3, -L - 0.12, W + 0.02, 0.72, -L + 0.05, '#2b2b2b');
  // 屋根のエアコン
  parts.box(-0.9, y1, -1.8, 0.9, y1 + 0.32, 1.6, '#d9d9d2');
  // 前面の社章ライン
  parts.box(-W, 0.85, L, W, 0.98, L + e * 2, '#1f8a4c', { top: false });
  // ナンバー
  parts.box(-0.35, 0.42, L + 0.12, 0.35, 0.62, L + 0.14, '#f4f4f4', { top: false });
  parts.box(-0.35, 0.42, -L - 0.14, 0.35, 0.62, -L - 0.12, '#f4f4f4', { top: false });
  // アンダーミラー（前の角から突き出す）
  for (const sx of [1, -1]) {
    parts.boxRot(sx * (W + 0.35), 2.75, L - 0.1, 0.7, 0.05, 0.05, 0, '#222');
    parts.boxRot(sx * (W + 0.68), 2.35, L - 0.1, 0.05, 0.8, 0.05, 0, '#222');
    parts.blob(sx * (W + 0.68), 1.9, L - 0.05, 0.16, '#111', 0.2);
  }
  // ホイールハウス
  for (const z of [BUS.wheelBase / 2 + 0.2, -BUS.wheelBase / 2 + 0.2]) {
    for (const sx of [1, -1]) parts.box(sx > 0 ? W - 0.02 : -W - 0.01, 0.42, z - 0.65, sx > 0 ? W + 0.01 : -W + 0.02, 1.15, z + 0.65, '#1a1a1a', { top: false });
  }
  const partsMesh = new THREE.Mesh(parts.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  partsMesh.castShadow = true;
  body.add(partsMesh);

  // ドア（左側: 前扉・中扉）
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x2a3a46 });
  const doorGeo = new THREE.BoxGeometry(0.06, 2.3, 0.55);
  const doors = [];
  for (const zc of [4.05, 0.0]) {
    for (const k of [-1, 1]) {
      const d = new THREE.Mesh(doorGeo, doorMat);
      d.position.set(W + 0.03, 0.42 + 1.15 + 0.05, zc + k * 0.28);
      d.userData = { baseZ: zc + k * 0.28, dir: k };
      body.add(d);
      doors.push(d);
    }
  }
  // ドア開口部（暗い）
  const gap = new MeshBuilder();
  for (const zc of [4.05, 0.0]) gap.box(W - 0.01, 0.45, zc - 0.56, W + 0.005, 2.75, zc + 0.56, '#0c0f12', { top: false });
  body.add(new THREE.Mesh(gap.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));

  // 行先表示
  const dest = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.4), new THREE.MeshBasicMaterial({ map: destinationTexture(lv.dest) }));
  dest.position.set(0, 2.88, L + 0.03);
  body.add(dest);
  const destSide = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.32), new THREE.MeshBasicMaterial({ map: destinationTexture(lv.destShort) }));
  destSide.position.set(W + 0.03, 2.82, 2.8);
  destSide.rotation.y = Math.PI / 2;
  body.add(destSide);

  // ライト
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  const lights = new MeshBuilder();
  for (const sx of [1, -1]) lights.box(sx * 0.85 - 0.25, 0.75, L + 0.01, sx * 0.85 + 0.25, 0.95, L + 0.04, '#fff', { top: false });
  const head = new THREE.Mesh(lights.build(), headMat);
  body.add(head);
  const tl = new MeshBuilder();
  for (const sx of [1, -1]) tl.box(sx * 0.95 - 0.18, 0.8, -L - 0.04, sx * 0.95 + 0.18, 1.3, -L - 0.01, '#fff', { top: false });
  const tail = new THREE.Mesh(tl.build(), tailMat);
  body.add(tail);
  // ウインカー（左右）
  const blinkMatL = new THREE.MeshBasicMaterial({ color: 0x664411 });
  const blinkMatR = new THREE.MeshBasicMaterial({ color: 0x664411 });
  const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), blinkMatL);
  bl.position.set(1.0, 1.05, L + 0.03);
  const br = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), blinkMatR);
  br.position.set(-1.0, 1.05, L + 0.03);
  body.add(bl, br);

  // タイヤ
  const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.32, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x161616 });
  const hubGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.34, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x9a9fa3 });
  const wheels = [];
  for (const [z, front] of [[BUS.wheelBase / 2 + 0.2, true], [-BUS.wheelBase / 2 + 0.2, false]]) {
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W - 0.18), 0.52, z);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.add(new THREE.Mesh(hubGeo, hubMat));
      w.castShadow = true;
      pivot.add(w);
      root.add(pivot);
      wheels.push({ pivot, mesh: w, front, side: sx });
    }
  }

  // 影の代わりの丸影（影オフ時）
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(BUS.width + 0.8, BUS.length + 0.8),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.renderOrder = 1;
  root.add(blob);

  // 後ろの行先表示
  const destRear = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.3), new THREE.MeshBasicMaterial({ map: destinationTexture(lv.destShort) }));
  destRear.position.set(0, 2.85, -L - 0.03);
  destRear.rotation.y = Math.PI;
  body.add(destRear);

  return { root, body, wheels, doors, tailMat, headMat, blinkMatL, blinkMatR, blob, heads };
}

export class Bus {
  constructor(scene, { livery } = {}) {
    this.model = buildModel(livery);
    this.tuning = { brake: 1, speed: 1, accel: 1 };
    scene.add(this.model.root);
    this.circles = [];
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.h = heading;
    this.vx = 0;
    this.vz = 0;
    this.spin = 0;
    this.steer = 0;
    this.px = x;
    this.pz = z;
    this.ph = heading;
    this.speed = 0;
    this.vf = 0;
    this.roll = 0;
    this.rollV = 0;
    this.pitch = 0;
    this.pitchV = 0;
    this.bounce = 0;
    this.bounceV = 0;
    this.lift = 0;
    this.wheelRot = 0;
    this.load = 0; // 0〜1（乗車率）
    this.doorOpen = 0;
    this.doorTarget = 0;
    this.braking = false;
    this.lastImpact = 0;
    this.blink = 0;
    this.reverseHold = 0;
    this.brakeHold = 0;
    this.slip = 0;
    this.decel = 0;
    this._aLat = 0;
    this._aLong = 0;
  }

  /** 乗車人数に応じて車内の頭を表示（0 番目は運転手） */
  setOnboard(n, capacity) {
    const h = this.model.heads;
    const seats = h.instanceMatrix.count - 1;
    h.count = 1 + Math.min(seats, Math.round((n / capacity) * seats * 1.15));
  }

  /** 後輪の位置（タイヤ痕用） */
  rearWheels() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    const a = -BUS.wheelBase / 2 + 0.2, w = BUS.width / 2 - 0.18;
    return [-1, 1].map((sd) => ({ x: this.x + fx * a + rx * w * sd, z: this.z + fz * a + rz * w * sd, y: this.lift }));
  }
  /** 排気管の位置（車体後部の左下） */
  exhaustPos() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    return { x: this.x - fx * (BUS.length / 2 + 0.2) - rx * 0.8, y: 0.45 + this.lift, z: this.z - fz * (BUS.length / 2 + 0.2) - rz * 0.8 };
  }

  get forward() {
    return { x: Math.sin(this.h), z: Math.cos(this.h) };
  }

  /**
   * 固定タイムステップの物理更新
   * input: { throttle, brake, steer(-1..1, +が右), handbrake }
   * env: { staticHash, cars, props, t }
   * 戻り値: { impact: 衝突で失った速度(m/s), propsSlow }
   */
  step(dt, input, env) {
    this.px = this.x;
    this.pz = this.z;
    this.ph = this.h;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx; // 右方向
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const speed = Math.hypot(this.vx, this.vz);
    const loadK = 1 - 0.28 * this.load;

    // ステアリング（デジタル入力をなめらかに）
    const target = -input.steer; // 正 = 左
    const rate = Math.sign(target) !== Math.sign(this.steer) && target !== 0 ? 5 : target === 0 ? 4 : 2.6;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);

    // 加減速
    let along = 0;
    if (input.throttle && !input.hold) {
      if (vf < -0.5) along += BUS.brake * loadK;
      else along += BUS.accel * this.tuning.accel * loadK * Math.max(0, 1 - Math.pow(Math.max(0, vf) / (BUS.maxSpeed * this.tuning.speed), 2));
    }
    // 停車保持（乗降中・カウントダウン中など）
    if (input.hold) {
      vf *= Math.exp(-14 * dt);
      vl *= Math.exp(-14 * dt);
      if (Math.abs(vf) < 0.05) vf = 0;
    }
    // 停止してからブレーキを押し続けると後退
    if (input.hold) this.reverseHold = 0;
    else if (input.brake && !input.throttle && Math.abs(vf) < 0.4) this.reverseHold += dt;
    else if (!input.brake) this.reverseHold = 0;
    // ブレーキは踏み続けるほど強くなる（軽く踏めば急ブレーキにならない）
    if (input.brake && !input.hold && vf > 0.4) this.brakeHold += dt;
    else this.brakeHold = 0;
    const brakeForce = BUS.brake * this.tuning.brake * (0.45 + 0.55 * Math.min(1, this.brakeHold / 0.6));
    if (input.brake && !input.hold) {
      if (vf > 0.4) along -= brakeForce * (0.85 + 0.15 * loadK);
      else if (!input.throttle && (this.reverseHold > 0.35 || vf < -0.4)) along -= vf > -BUS.maxReverse ? BUS.reverseAccel : 0;
      else if (!input.throttle) vf *= Math.exp(-12 * dt);
    }
    this.braking = !!input.brake && vf > 0.4;
    const prevVf = vf;
    vf += along * dt;
    // 抵抗
    const resist = BUS.rolling + BUS.drag * Math.abs(vf) + (input.handbrake ? 5 : 0);
    if (!input.throttle && !(input.brake && vf <= 0.4)) {
      if (vf > 0) vf = Math.max(0, vf - resist * dt);
      else if (vf < 0) vf = Math.min(0, vf + resist * dt);
    } else {
      vf -= Math.sign(vf) * BUS.drag * Math.abs(vf) * dt;
    }
    // ブレーキで前進→後退に一気に切り替わらないように
    if (input.brake && prevVf > 0.4 && vf < 0) vf = 0;

    // 旋回（速度感応ステア＋横G制限）
    const maxSteer = BUS.maxSteer / (1 + Math.abs(vf) / 16);
    const delta = this.steer * maxSteer;
    let yaw = (vf * Math.tan(delta)) / BUS.wheelBase;
    const aMax = input.handbrake ? 16 : 11;
    const yawMax = aMax / Math.max(3, Math.abs(vf));
    yaw = THREE.MathUtils.clamp(yaw, -yawMax, yawMax);
    if (input.handbrake && Math.abs(vf) > 4) yaw *= 1.45;

    // 横滑り（グリップ）
    const grip = input.handbrake ? BUS.handbrakeGrip : BUS.grip;
    vl *= Math.exp(-grip * dt);

    this.h += (yaw + this.spin) * dt;
    this.spin *= Math.exp(-5 * dt);
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
    const nrx = -nfz, nrz = nfx;
    this.vx = nfx * vf + nrx * vl;
    this.vz = nfz * vf + nrz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // 姿勢（ロール・ピッチ）用の加速度
    const aLat = vf * yaw;
    const aLong = (vf - prevVf) / dt;
    this._aLat = aLat;
    this._aLong = aLong;
    this.vf = vf;
    this.slip = Math.abs(vl);
    this.decel = this.braking ? -aLong : 0;
    this.handbrake = !!input.handbrake;

    // 衝突
    const before = Math.hypot(this.vx, this.vz);
    this._collide(env);
    const after = Math.hypot(this.vx, this.vz);
    const impact = Math.max(0, before - after);

    // 小物
    let propsSlow = 0;
    if (env.props) {
      this._updateCircles();
      propsSlow = env.props.collideBus(this.circles, BUS.collisionRadius, this, env.t);
      if (propsSlow > 0) {
        this.vx *= 1 - propsSlow;
        this.vz *= 1 - propsSlow;
        this.bounceV += 1.2 * propsSlow * 10;
        this.rollV += (Math.random() - 0.5) * 0.4;
      }
    }

    this.speed = Math.hypot(this.vx, this.vz);
    this._updatePose(dt, impact);
    return { impact, propsSlow };
  }

  _updateCircles() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    const r = BUS.collisionRadius;
    const span = BUS.length / 2 - r;
    const pts = [
      [-span, 0], [-span / 3, 0], [span / 3, 0], [span, 0],
      [BUS.length / 2 - 0.35, 0.9], [BUS.length / 2 - 0.35, -0.9], [-BUS.length / 2 + 0.35, 0.9], [-BUS.length / 2 + 0.35, -0.9],
    ];
    for (let i = 0; i < pts.length; i++) {
      const [a, l] = pts[i];
      const c = this.circles[i] || (this.circles[i] = {});
      c.x = this.x + fx * a + rx * l;
      c.z = this.z + fz * a + rz * l;
      c.a = a;
      c.l = l;
      c.r = i < 4 ? r : 0.36;
    }
    this.circles.length = pts.length;
  }

  _collide(env) {
    const near = [];
    for (let iter = 0; iter < 3; iter++) {
      this._updateCircles();
      let any = false;
      for (const c of this.circles) {
        // 建物・川などのタイル
        const c0 = Math.floor((c.x - c.r) / TILE), c1 = Math.floor((c.x + c.r) / TILE);
        const r0 = Math.floor((c.z - c.r) / TILE), r1 = Math.floor((c.z + c.r) / TILE);
        for (let tr = r0; tr <= r1; tr++) {
          for (let tc = c0; tc <= c1; tc++) {
            const rect = solidRectForTile(tc, tr);
            if (!rect) continue;
            const hit = circleVsAABB(c.x, c.z, c.r, rect);
            if (hit) {
              this._resolve(c, hit, 0.15, 1);
              any = true;
            }
          }
        }
        // 動く箱（電車など）
        if (env.boxes) {
          for (const b of env.boxes) {
            const hit = circleVsAABB(c.x, c.z, c.r, b);
            if (hit) {
              this._resolve(c, hit, 0.35, 1);
              env.onBoxHit && env.onBoxHit(b, hit);
              any = true;
            }
          }
        }
        // 電柱など
        if (env.staticHash) {
          env.staticHash.query(c.x, c.z, c.r + 1, near);
          for (const s of near) {
            const hit = circleVsCircle(c.x, c.z, c.r, s.x, s.z, s.r);
            if (hit) {
              this._resolve(c, hit, 0.2, 1);
              any = true;
            }
          }
        }
        // 他車
        if (env.cars) {
          for (const car of env.cars) {
            if (!car.solid) continue;
            const reach = car.reach || 6;
            if (Math.abs(car.x - c.x) > reach || Math.abs(car.z - c.z) > reach) continue;
            for (const cc of car.circles) {
              const hit = circleVsCircle(c.x, c.z, c.r, cc.x, cc.z, cc.r);
              if (hit) {
                env.onCarHit && env.onCarHit(car, this, hit);
                this._resolve(c, hit, 0.3, 0.55);
                any = true;
              }
            }
          }
        }
      }
      if (!any) break;
    }
  }

  _resolve(c, hit, restitution, massShare) {
    // 位置補正
    this.x += hit.nx * hit.depth * massShare;
    this.z += hit.nz * hit.depth * massShare;
    c.x += hit.nx * hit.depth * massShare;
    c.z += hit.nz * hit.depth * massShare;
    const vn = this.vx * hit.nx + this.vz * hit.nz;
    if (vn < 0) {
      const j = -(1 + restitution) * vn * massShare;
      this.vx += j * hit.nx;
      this.vz += j * hit.nz;
      // 壁沿いの摩擦
      this.vx *= 0.985;
      this.vz *= 0.985;
      // 接触点まわりの回転
      const rxw = c.x - this.x, rzw = c.z - this.z;
      const torque = rzw * (j * hit.nx) - rxw * (j * hit.nz);
      this.spin += THREE.MathUtils.clamp(torque * 0.06, -1.5, 1.5);
      // 車体の揺れ
      const lat = -(hit.nx * -Math.cos(this.h) + hit.nz * Math.sin(this.h));
      this.rollV += lat * Math.min(2.5, j * 0.12);
      this.bounceV += Math.min(3, j * 0.15);
      this.lastImpactJ = Math.max(this.lastImpactJ || 0, j);
    }
  }

  _updatePose(dt, impact) {
    // ロール: 旋回で外側へ大げさに傾く
    const rollTarget = THREE.MathUtils.clamp(this._aLat * 0.02, -0.16, 0.16);
    const pitchTarget = THREE.MathUtils.clamp(-this._aLong * 0.012, -0.06, 0.08);
    const k = 60, d = 7;
    this.rollV += ((rollTarget - this.roll) * k - this.rollV * d) * dt;
    this.roll += this.rollV * dt;
    this.pitchV += ((pitchTarget - this.pitch) * k - this.pitchV * d) * dt;
    this.pitch += this.pitchV * dt;
    // 歩道に乗り上げると車体が持ち上がる
    const onCurb = this._onCurb() ? 0.15 : 0;
    this.lift += (onCurb - this.lift) * Math.min(1, dt * 12);
    this.bounceV += (-this.bounce * 90 - this.bounceV * 9) * dt;
    this.bounce += this.bounceV * dt;
    if (impact > 3) {
      this.pitchV += Math.min(1.2, impact * 0.08);
    }
    this.wheelRot += (this.vf * dt) / 0.52;
    this.doorOpen += THREE.MathUtils.clamp(this.doorTarget - this.doorOpen, -dt * 2.5, dt * 2.5);
    this.blink += dt;
  }

  _onCurb() {
    const c = Math.floor(this.x / TILE), r = Math.floor(this.z / TILE);
    const t = tileAt(c, r);
    if (t !== T.SOLID && t !== T.BANK) return false;
    return true;
  }

  /** 描画用（補間係数 alpha） */
  sync(alpha) {
    const m = this.model;
    const x = this.px + (this.x - this.px) * alpha;
    const z = this.pz + (this.z - this.pz) * alpha;
    let dh = this.h - this.ph;
    const h = this.ph + dh * alpha;
    m.root.position.set(x, this.lift, z);
    m.root.rotation.set(0, h, 0);
    m.body.position.y = this.bounce * 0.6;
    m.body.rotation.set(this.pitch, 0, this.roll);
    for (const w of m.wheels) {
      w.mesh.rotation.x = this.wheelRot;
      if (w.front) w.pivot.rotation.y = this.steer * BUS.maxSteer * 0.8;
    }
    for (const d of m.doors) {
      d.position.z = d.userData.baseZ + d.userData.dir * this.doorOpen * 0.5;
      d.position.x = BUS.width / 2 + 0.03 + this.doorOpen * 0.08;
    }
    m.tailMat.color.setHex(this.braking ? 0xff2a2a : 0x7a1010);
    // ハザード（停車中ドア開）・ウインカー
    const on = Math.floor(this.blink * 2.6) % 2 === 0;
    const left = this.doorTarget > 0 || this.steer > 0.35;
    const right = this.doorTarget > 0 || this.steer < -0.35;
    m.blinkMatL.color.setHex(left && on ? 0xffa000 : 0x664411);
    m.blinkMatR.color.setHex(right && on ? 0xffa000 : 0x664411);
    return { x, z, h };
  }

  setShadowMode(on) {
    this.model.blob.visible = !on;
  }
}
