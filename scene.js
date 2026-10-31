// SakuraQR animation: cherry petals drifting down from the canopy, and three little figures chasing each other round
// the trunk on the base plate.
//
//   import setup from './scene.js';
//   const { update, dispose } = await setup({ THREE, stage, tree, info, mode });
//
// stage: THREE.Group everything is added to. tree: the SakuraQR GLB root, already in stage, never touched.
// info: tree.userData.sakuraqr. mode: '3d' or 'ar' (the scene is the same in both).
// update(dt, elapsed) once per frame (seconds); dispose() removes and frees everything this module created.
//
// Nothing here goes inside the tree: at setup the tree's own triangles are rasterised into vertical columns
// (4 per cube each way) listing the solid intervals above every point, and petals and walkers are only ever moved to
// places those columns say are empty. Everything is modelled in cubes (1 = info.cell) in a group that follows the tree.
// Opaque materials only, no lights, no DOM, no network except ./assets/. Fixed-seed random numbers.
import * as THREE_NS from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WALKERS = ['walker-blue', 'walker-red', 'walker-gold'];
const PETALS = 240;
const PETAL_SIZE = 0.5, PETAL_THICK = 0.06;
// Collision extents of a petal, in cubes: horizontally its half-diagonal (0.354 x up to 1.15) plus the collision
// grid's half spacing and a little; vertically its tumbling half-extent.
const PETAL_RH = 0.62, PETAL_RV = 0.45;
const PETAL_COLOURS = ['#FFB8CB', '#F27A9C'];
const SAMPLES = 4;             // collision columns per cube, each way
const SEED = 0x5A6B2026;
const MAX_DT = 0.1;
const RADIUS_SHARE = 0.5;     // the runners' circle: this share of the way from the trunk to the nearest plate edge

export default async function setup({ THREE = THREE_NS, stage, tree, info, mode = '3d' }) {
  const cell = info.cell;
  const rand = mulberry32(SEED);

  // ---- group that follows the tree, in cubes --------------------------------------------------------------------
  stage.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'SakuraQR-animation';
  root.userData.mode = mode;
  new THREE.Matrix4().copy(stage.matrixWorld).invert().multiply(tree.matrixWorld)
    .decompose(root.position, root.quaternion, root.scale);
  root.scale.multiplyScalar(cell);
  stage.add(root);

  const field = buildField(THREE, tree, info);
  const plateTop = info.plate.top / cell;

  // ---- walkers ----------------------------------------------------------------------------------------------------
  const loader = new GLTFLoader();
  const gltfs = await Promise.all(WALKERS.map(n => loader.loadAsync(new URL('./assets/' + n + '.glb', import.meta.url).href)));
  const walkers = gltfs.map(g => {
    const obj = g.scene;
    const ex = (obj.children[0] && obj.children[0].userData) || {};
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    obj.visible = false;
    root.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(g.animations[0]).play();
    return { obj, mixer, height: ex.height || 5, radius: ex.radius || 1.6, natural: (ex.stride || 1.41) / (ex.cycle || 0.8), s: 0, v: 0 };
  });
  const walkR = Math.max(...walkers.map(w => w.radius)) + 0.35;
  const walkH = Math.max(...walkers.map(w => w.height)) + 0.25;
  const path = buildPath(THREE, field, info, plateTop, walkR, walkH);
  const V0 = 2.8;                       // the leader's average running speed, cubes per second
  const MIN_GAP = 2.6;                  // closest two walkers get, along the loop (they are ~2 cubes deep)
  const CHASE_GAP = MIN_GAP + 1.4;      // usual distance between a chaser and the one in front
  if (path) {
    walkers.forEach((w, i) => { w.s = ((-i * CHASE_GAP) % path.length + path.length) % path.length; w.obj.visible = true; });
  }

  // ---- petals -----------------------------------------------------------------------------------------------------
  const petalGeo = new THREE.BoxGeometry(PETAL_SIZE, PETAL_THICK, PETAL_SIZE);
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, PETALS);
  petalMesh.name = 'petals';
  petalMesh.castShadow = true; petalMesh.receiveShadow = true;
  petalMesh.frustumCulled = false;
  petalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(petalMesh);
  const colour = new THREE.Color();
  const spawns = spawnPoints(field, info, plateTop);

  const P = [];
  for (let i = 0; i < PETALS; i++) {
    colour.set(PETAL_COLOURS[i % 2]);
    petalMesh.setColorAt(i, colour);
    const ax = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).normalize();
    P.push({
      state: HIDDEN, timer: -rand() * 12, x: 0, y: 0, z: 0, vy: 0, ix: 0, iz: 0,
      axis: ax, angle: rand() * 6.28, spin: (rand() < 0.5 ? -1 : 1) * (1.5 + rand() * 2.5), yaw: rand() * 6.28,
      fall: 0.75 + rand() * 0.4, phase: rand() * 6.28, sway: 0.15 + rand() * 0.2, size: 0.8 + rand() * 0.35, scale: 0
    });
  }
  petalMesh.instanceColor.needsUpdate = true;

  const xMin = field.x0, xMax = field.x0 + field.nx / SAMPLES, zMin = field.z0, zMax = field.z0 + field.nz / SAMPLES;
  const wind = { x: 0, z: 0 };
  let clock = 0;

  function respawn(p) {
    const top = spawns.top.length && (rand() < 0.45 || !spawns.under.length);
    const list = top ? spawns.top : spawns.under;
    if (!list.length) { p.state = HIDDEN; p.timer = 5; return; }
    const k = Math.floor(rand() * list.length / 3) * 3;
    p.x = list[k]; p.y = list[k + 1]; p.z = list[k + 2];
    p.vy = top ? 0.5 + rand() * 0.5 : 0;
    p.ix = p.iz = 0;
    p.yaw = rand() * 6.28; p.angle = rand() * 6.28;
    p.state = GROW; p.timer = 0;
  }

  function stepPetal(p, dt, active) {
    p.timer += dt;
    switch (p.state) {
      case HIDDEN:
        p.scale = 0;
        if (p.timer > 0) respawn(p);
        return;
      case GROW:
        p.scale = Math.min(1, p.timer / 0.6);
        p.angle += p.spin * dt * 0.3;
        if (p.timer >= 0.6) { p.state = FALL; p.timer = 0; }
        return;
      case REST:
        if (active) kick(p);
        if (p.state === REST && p.timer > p.restFor) { p.state = FADE; p.timer = 0; }
        return;
      case FADE:
        p.scale = Math.max(0, 1 - p.timer / 0.8);
        if (p.timer >= 0.8) { p.state = HIDDEN; p.timer = -(0.2 + rand() * 1.5); p.scale = 0; }
        return;
    }
    // FALL
    const r = PETAL_RV, rh = PETAL_RH;
    const targetVy = -p.fall + 0.3 * Math.sin(p.phase + clock * 2.3);
    p.vy += (targetVy - p.vy) * Math.min(1, 1.2 * dt);
    let vx = wind.x + p.sway * Math.sin(p.phase * 1.7 + clock * 1.3) + p.ix;
    let vz = wind.z + p.sway * Math.cos(p.phase * 2.3 + clock * 1.1) + p.iz;
    const decay = Math.exp(-2.5 * dt); p.ix *= decay; p.iz *= decay;
    // keep clear of the plate's edge and of the walkers
    const m = 1.8;
    if (p.x - xMin < m) vx += (m - (p.x - xMin)) * 0.8;
    if (xMax - p.x < m) vx -= (m - (xMax - p.x)) * 0.8;
    if (p.z - zMin < m) vz += (m - (p.z - zMin)) * 0.8;
    if (zMax - p.z < m) vz -= (m - (zMax - p.z)) * 0.8;
    if (active) for (const w of walkers) {
      if (p.y - r > plateTop + w.height + 0.4) continue;
      const dx = p.x - w.px, dz = p.z - w.pz, d = Math.hypot(dx, dz) || 1e-6, reach = w.radius + 0.9;
      if (d < reach) { const push = 3 * (reach - d) / d; vx += dx * push; vz += dz * push; }
    }
    const nx = p.x + vx * dt, nz = p.z + vz * dt;
    if (!field.footBlocked(nx, nz, p.y - r, p.y + r, rh)) { p.x = nx; p.z = nz; }
    const ny = p.y + p.vy * dt;
    if (p.vy < 0) {
      const g = field.footGround(p.x, p.z, p.y - r + 1e-4, rh);
      if (ny - r <= g) {
        p.y = g + PETAL_THICK / 2 + 0.01;
        p.state = REST; p.timer = 0; p.restFor = 2 + rand() * 3.5; p.ground = g;
        return;
      }
    } else {
      const c = field.footCeil(p.x, p.z, p.y + r - 1e-4, rh);
      if (ny + r >= c) { p.vy = 0; return; }
    }
    p.y = ny;
    p.angle += p.spin * dt;
  }

  // A resting petal on the plate that a walker steps near is kicked back up into the air.
  function kick(p) {
    if (p.ground > plateTop + 0.05) return;
    for (const w of walkers) {
      const dx = p.x - w.px, dz = p.z - w.pz, d = Math.hypot(dx, dz);
      if (d > w.radius * 0.85) continue;
      const y = p.ground + PETAL_RV + 0.01;
      if (field.footBlocked(p.x, p.z, y - PETAL_RV, y + PETAL_RV, PETAL_RH)) return;
      p.y = y; p.vy = 1.1 + rand() * 0.5;
      const k = 1.2 / (d || 1);
      p.ix = (dx || rand() - 0.5) * k; p.iz = (dz || rand() - 0.5) * k;
      p.state = FALL; p.timer = 0;
      return;
    }
  }

  const q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), mat = new THREE.Matrix4();
  function writePetals() {
    for (let i = 0; i < PETALS; i++) {
      const p = P[i];
      qYaw.setFromAxisAngle(up, p.yaw);
      if (p.state === FALL || p.state === GROW) q.setFromAxisAngle(p.axis, p.angle).multiply(qYaw); else q.copy(qYaw);
      const s = p.scale * p.size;
      pos.set(p.x, p.y, p.z); scl.set(s, s, s);
      petalMesh.setMatrixAt(i, mat.compose(pos, q, scl));
    }
    petalMesh.instanceMatrix.needsUpdate = true;
  }

  function stepWind(t) {
    const a = 0.7 + 0.9 * Math.sin(t * 0.045) + 0.3 * Math.sin(t * 0.13);
    const m = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.31 + Math.sin(t * 0.17) * 2));
    wind.x = Math.cos(a) * m; wind.z = Math.sin(a) * m;
  }

  const tan = new THREE.Vector3();
  function stepWalkers(dt) {
    if (!path) return;
    // walker 0 leads at a wandering pace; each of the others chases the one in front, closing in and dropping back
    const L = path.length;
    walkers.forEach((w, i) => {
      let v;
      if (i === 0) v = V0 * (1 + 0.25 * Math.sin(clock * 0.31) + 0.12 * Math.sin(clock * 0.77));
      else {
        const ahead = walkers[i - 1];
        const gap = ((ahead.s - w.s) % L + L) % L;
        const want = CHASE_GAP + 1.1 * Math.sin(clock * (0.9 + 0.17 * i) + i * 1.9);
        v = ahead.v + 1.6 * (gap - want);
        if (gap < MIN_GAP + 0.6) v = Math.min(v, ahead.v * Math.max(0, (gap - MIN_GAP) / 0.6));
      }
      w.v = Math.min(Math.max(v, 0), 4);
      w.s = (w.s + w.v * dt) % L;
    });
    walkers.forEach(w => {
      const u = w.s / L;
      path.curve.getPointAt(u, pos);
      path.curve.getTangentAt(u, tan);
      // lean into the turn (turn rate x speed), eased; lifted by the lean so the outer foot stays above ground
      const yaw = Math.atan2(tan.x, tan.z);
      let turn = yaw - (w.yaw ?? yaw);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const rate = dt > 0 ? turn / dt : 0;
      const bank = Math.max(-0.25, Math.min(0.25, -rate * w.v * 0.12));
      w.bank = (w.bank ?? 0) + (bank - (w.bank ?? 0)) * Math.min(1, dt * 4);
      w.yaw = yaw;
      w.obj.rotation.set(0, yaw, w.bank, 'YXZ');
      w.obj.position.set(pos.x, plateTop + 0.75 * Math.abs(Math.sin(w.bank)), pos.z);
      w.px = pos.x; w.pz = pos.z;
      w.mixer.timeScale = w.v / w.natural;
      w.mixer.update(dt);
    });
  }

  // warm up so the petals are already spread out when the scene first shows
  for (let t = 0; t < 20; t += 1 / 30) { clock += 1 / 30; stepWind(clock); for (const p of P) stepPetal(p, 1 / 30, false); }
  stepWalkers(0);
  writePetals();

  return {
    update(dt) {
      dt = Math.min(Math.max(dt || 0, 0), MAX_DT);
      clock += dt;
      stepWind(clock);
      stepWalkers(dt);
      for (const p of P) stepPetal(p, dt, !!path);
      writePetals();
    },
    dispose() {
      stage.remove(root);
      for (const w of walkers) { w.mixer.stopAllAction(); w.mixer.uncacheRoot(w.obj); }
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); });
        if (o.isInstancedMesh) o.dispose();
        if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
      });
      root.clear();
    }
  };
}

const HIDDEN = 0, GROW = 1, FALL = 2, REST = 3, FADE = 4;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- collision columns -----------------------------------------------------------------------------------------
// Every triangle of the tree that isn't vertical is rasterised onto a grid of vertical lines over the plate;
// downward faces open a solid run, upward faces close it. Each column keeps its solid runs [bottom, top, ...] in cubes.
// Anything outside the plate counts as solid, which keeps petals and walkers on it.
function buildField(THREE, tree, info) {
  const cell = info.cell, S = SAMPLES, D = 0.0137, E = 0.0071;   // small, unequal offsets: no sample line runs along an edge or a diagonal
  const x0 = info.grid.origin[0] / cell, z0 = info.grid.origin[1] / cell;
  const nx = info.grid.cols * S, nz = info.grid.rows * S;
  const hits = Array.from({ length: nx * nz }, () => []);
  tree.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(tree.matrixWorld).invert();
  const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  tree.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const flip = m.determinant() < 0 ? -1 : 1;
    const pa = o.geometry.attributes.position, ix = o.geometry.index;
    const n = ix ? ix.count : pa.count;
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pa, ix ? ix.getX(t) : t).applyMatrix4(m).divideScalar(cell);
      b.fromBufferAttribute(pa, ix ? ix.getX(t + 1) : t + 1).applyMatrix4(m).divideScalar(cell);
      c.fromBufferAttribute(pa, ix ? ix.getX(t + 2) : t + 2).applyMatrix4(m).divideScalar(cell);
      const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(area) < 1e-9) continue;
      const dir = -area * flip > 0 ? -1 : 1;           // normal.y = -area: up-facing closes (-1), down-facing opens (+1)
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) * S - 0.5 - D));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) * S - 0.5 - D));
      const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) * S - 0.5 - E));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) * S - 0.5 - E));
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5 + E) / S;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5 + D) / S;
          const l1 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / area;
          const l2 = ((px - a.x) * (c.z - a.z) - (c.x - a.x) * (pz - a.z)) / area;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          hits[j * nx + i].push(l1 * a.y + l2 * b.y + l3 * c.y, dir);
        }
      }
    }
  });
  const runs = hits.map(h => {
    const order = [];
    for (let k = 0; k < h.length; k += 2) order.push([h[k], h[k + 1]]);
    order.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
    const out = [];
    let depth = 0, start = 0;
    for (const [y, d] of order) {
      if (d > 0) { if (depth++ === 0) start = y; } else if (depth > 0 && --depth === 0) out.push(start, y);
    }
    if (depth > 0) out.push(start, Infinity);
    return new Float32Array(out);
  });
  const col = (x, z) => {
    const i = Math.floor((x - x0) * S), j = Math.floor((z - z0) * S);
    return i < 0 || j < 0 || i >= nx || j >= nz ? null : runs[j * nx + i];
  };
  const blocked = (x, z, y0, y1) => {
    const r = col(x, z);
    if (!r) return true;
    for (let k = 0; k < r.length; k += 2) if (r[k] < y1 && r[k + 1] > y0) return true;
    return false;
  };
  const ground = (x, z, y) => {
    const r = col(x, z);
    if (!r) return Infinity;
    let g = -Infinity;
    for (let k = 1; k < r.length; k += 2) if (r[k] <= y && r[k] > g) g = r[k];
    return g;
  };
  const ceil = (x, z, y) => {
    const r = col(x, z);
    if (!r) return -Infinity;
    let c = Infinity;
    for (let k = 0; k < r.length; k += 2) if (r[k] >= y && r[k] < c) c = r[k];
    return c;
  };
  // footprint: centre, 16 points on the rim, 8 half way
  const OFF = [[0, 0]];
  for (let k = 0; k < 16; k++) OFF.push([Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
  for (let k = 0; k < 8; k++) OFF.push([0.5 * Math.cos(k * Math.PI / 4 + 0.39), 0.5 * Math.sin(k * Math.PI / 4 + 0.39)]);
  return {
    x0, z0, nx, nz, runs, col, blocked, ground, ceil,
    footBlocked(x, z, y0, y1, r) {
      for (const [u, v] of OFF) if (blocked(x + u * r, z + v * r, y0, y1)) return true;
      return false;
    },
    footGround(x, z, y, r) {
      let g = -Infinity;
      for (const [u, v] of OFF) g = Math.max(g, ground(x + u * r, z + v * r, y));
      return g;
    },
    footCeil(x, z, y, r) {
      let c = Infinity;
      for (const [u, v] of OFF) c = Math.min(c, ceil(x + u * r, z + v * r, y));
      return c;
    }
  };
}

// Places just outside the canopy where a petal can appear: on top of it and under its overhang.
function spawnPoints(field, info, plateTop) {
  const top = [], under = [], r = PETAL_RV, rh = PETAL_RH, S = SAMPLES;
  for (let j = 1; j < field.nz; j += 2) for (let i = 1; i < field.nx; i += 2) {
    const runs = field.runs[j * field.nx + i];
    if (runs.length < 2) continue;
    const x = field.x0 + (i + 0.5) / S, z = field.z0 + (j + 0.5) / S;
    const last = runs[runs.length - 1];
    if (last > plateTop + 4) {
      const y = last + r + 0.05;
      if (!field.footBlocked(x, z, y - r, y + r, rh)) top.push(x, y, z);
    }
    for (let k = 2; k < runs.length; k += 2) {
      const b = runs[k], below = runs[k - 1];
      if (b - below < 2 * r + 0.5 || b < plateTop + 3) continue;
      const y = b - r - 0.05;
      if (!field.footBlocked(x, z, y - r, y + r, rh)) under.push(x, y, z);
    }
  }
  return { top, under };
}

// A circle round the trunk, about half way out to the plate's edge, kept off anything solid (where a low branch or
// root is in the way it bends round it).
function buildPath(THREE, field, info, plateTop, R, H) {
  const cell = info.cell;
  const cx = info.trunk.centre[0] / cell, cz = info.trunk.centre[1] / cell;
  const xMin = field.x0 + R, xMax = field.x0 + field.nx / SAMPLES - R;
  const zMin = field.z0 + R, zMax = field.z0 + field.nz / SAMPLES - R;
  const disc = [];
  for (let u = -R; u <= R + 1e-6; u += 0.25) for (let v = -R; v <= R + 1e-6; v += 0.25) if (u * u + v * v <= R * R) disc.push([u, v]);
  const clear = (x, z) => {
    if (x < xMin || x > xMax || z < zMin || z > zMax) return false;
    for (const [u, v] of disc) {
      if (field.blocked(x + u, z + v, plateTop + 0.001, plateTop + H)) return false;
      if (field.ground(x + u, z + v, plateTop + 0.01) < plateTop - 0.01) return false;
    }
    return true;
  };
  // a circle round the trunk; its radius is RADIUS_SHARE of the distance from the trunk to the nearest plate edge
  const K = 120;
  const reach = Math.min(xMax - cx, cx - xMin, zMax - cz, cz - zMin);
  const want = Math.max(2, (reach - 0.3) * RADIUS_SHARE);
  const dirs = [], rad = [];
  for (let k = 0; k < K; k++) {
    const a = 2 * Math.PI * k / K, ux = Math.cos(a), uz = Math.sin(a);
    dirs.push([ux, uz]);
    let rMax = Infinity;
    if (ux > 1e-6) rMax = Math.min(rMax, (xMax - cx) / ux); else if (ux < -1e-6) rMax = Math.min(rMax, (xMin - cx) / ux);
    if (uz > 1e-6) rMax = Math.min(rMax, (zMax - cz) / uz); else if (uz < -1e-6) rMax = Math.min(rMax, (zMin - cz) / uz);
    // where a low branch or root is in the way, the nearest clear radius in this direction
    let found = NaN;
    for (let d = 0; d <= rMax; d += 0.25) {
      if (want - d >= 2 && clear(cx + ux * (want - d), cz + uz * (want - d))) { found = want - d; break; }
      if (d && want + d <= rMax - 0.3 && clear(cx + ux * (want + d), cz + uz * (want + d))) { found = want + d; break; }
    }
    if (Number.isNaN(found)) return null;
    rad.push(found);
  }
  // smooth the radius, keeping each angle where the smoothed point is still clear
  for (let pass = 0; pass < 4; pass++) {
    const next = rad.map((_, k) => {
      let s = 0; for (let d = -4; d <= 4; d++) s += rad[(k + d + K) % K];
      return s / 9;
    });
    next.forEach((r, k) => { if (clear(cx + dirs[k][0] * r, cz + dirs[k][1] * r)) rad[k] = r; });
  }
  const pts = rad.map((r, k) => new THREE.Vector3(cx + dirs[k][0] * r, 0, cz + dirs[k][1] * r));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 600;
  const length = curve.getLength();
  const p = new THREE.Vector3();
  for (let k = 0; k < 400; k++) {
    curve.getPointAt(k / 400, p);
    if (!clear(p.x, p.z)) return null;
  }
  return { curve, length };
}

// for tests
export const _internals = { buildField, buildPath, spawnPoints };
