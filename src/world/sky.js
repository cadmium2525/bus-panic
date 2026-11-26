// 空のグラデーションと遠景の山（カメラに追従させて常に最背面に描く）
import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder.js';

export function createSky(scene) {
  const group = new THREE.Group();
  group.name = 'sky';

  // 空のドーム（頂点カラーのグラデーション）
  const dome = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.2);
  const pos = dome.getAttribute('position');
  const cols = [];
  const top = new THREE.Color('#5d9be0'), hor = new THREE.Color('#d7e7f2'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    c.copy(hor).lerp(top, Math.pow(Math.max(0, y), 0.6));
    cols.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const domeMesh = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
  domeMesh.renderOrder = -10;
  group.add(domeMesh);

  // 山並み（半径1の円周上、角度固定）
  const mb = new MeshBuilder();
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rnd() * 0.12;
    const d = 0.9;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.05 + rnd() * 0.11;
    const r = 0.12 + rnd() * 0.12;
    const col = ['#7d9ab0', '#88a4b7', '#93adbf', '#7690a6'][i % 4];
    mb.cone(x, -0.02, z, r, h, col, 7);
  }
  const mountains = new THREE.Mesh(mb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, depthTest: false }));
  mountains.renderOrder = -9;
  group.add(mountains);

  // 雲
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf7fbff, fog: false, depthWrite: false, depthTest: false });
  const cb = new MeshBuilder();
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, el = 0.18 + rnd() * 0.25;
    const x = Math.cos(a) * Math.cos(el), z = Math.sin(a) * Math.cos(el), y = Math.sin(el);
    for (let k = 0; k < 4; k++) cb.blob(x + (rnd() - 0.5) * 0.08, y + (rnd() - 0.5) * 0.015, z + (rnd() - 0.5) * 0.08, 0.035 + rnd() * 0.03, '#ffffff', 0.012);
  }
  const clouds = new THREE.Mesh(cb.build(), cloudMat);
  clouds.renderOrder = -8;
  group.add(clouds);

  group.frustumCulled = false;
  for (const m of [domeMesh, mountains, clouds]) m.frustumCulled = false;
  scene.add(group);

  return {
    group,
    update(camera) {
      const R = camera.far * 0.85;
      group.position.set(camera.position.x, 0, camera.position.z);
      group.scale.setScalar(R);
      // 地平線を少し下げる（カメラ高さぶん）
      group.position.y = camera.position.y - R * 0.01;
    },
  };
}
