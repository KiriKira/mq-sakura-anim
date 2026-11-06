// Builds the sky whale for scene.js as a glTF binary: node tools/make-whale.mjs
//
// A voxel cartoon whale (voxel edge 0.5 tree cube) skinned to seven joints: a spine of body, head, tail1, tail2 and
// fluke, plus the two pectoral fins. It carries one looping "swim" clip: a vertical undulation that travels down the
// tail with growing amplitude and lag, a counter-phase nod of the head, a gentle bob, and slow mirrored fin strokes.
// One mesh, one material (vertex colours); same-coloured faces are merged into rectangles (greedy meshing) as in
// tools/make-walkers.mjs.
//
// Seamless bending: the spine is cut on voxel planes. Every vertex lying exactly on a cut is weighted 50/50 to the two
// joints that meet there, every other vertex rigidly to its segment. Faces are meshed in thin bands either side of
// each cut, so no merged rectangle runs from a cut into the rigid interior (which would open T-junction cracks).
//
// Units: 1 = one tree cube. +Y up, head facing +Z, origin at the body's centre.
// The root node's extras carry { unit, length, span, height, cycle } (span and height measured over the clip).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const V = 0.5;                // voxel edge in tree cubes
const CYCLE = 2.4;            // seconds per swim stroke
const KEYS = 24;
const D = Math.PI / 180;

// joints (skin order): 0 body, 1 head, 2 tail1, 3 tail2, 4 fluke, 5 fin +x, 6 fin -x
const BODY = 0, HEAD = 1, TAIL1 = 2, TAIL2 = 3, FLUKE = 4, FIN_P = 5, FIN_N = 6;
const JOINT_NAMES = ['body', 'head', 'tail1', 'tail2', 'fluke', 'fin_l', 'fin_r'];
const PARENT = [-1, BODY, BODY, TAIL1, TAIL2, BODY, BODY];
const PIVOTS = [[0, 0, 0], [0, 0, 10], [0, 0, -6], [0, 0, -14], [0, 0, -21], [5.5, -4, 6], [-5.5, -4, 6]];   // voxel units
// spine cuts (voxel planes, front to back) and the segment in front of / behind each
const CUTS = [[10, HEAD, BODY], [-6, BODY, TAIL1], [-14, TAIL1, TAIL2], [-21, TAIL2, FLUKE]];
const segmentOf = z => z > 10 ? HEAD : z > -6 ? BODY : z > -14 ? TAIL1 : z > -21 ? TAIL2 : FLUKE;

const C = {
  back: '#2B57A8', side: '#4F86D4', belly: '#F3EFE6', groove: '#DCE6F0', eye: '#1B2340', white: '#FFFFFF',
  blush: '#F2A7B9', mouth: '#1E3C7E', hole: '#16285A', finTop: '#24489A', finBottom: '#C9DBF2', spot: '#7FA8E4',
  edge: '#E4ECF6'
};

// ---------------------------------------------------------------------------------------------------------------
// shape

const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const lerpTable = (tab, x) => {
  if (x >= tab[0][0]) return tab[0].slice(1);
  for (let i = 1; i < tab.length; i++) if (x >= tab[i][0]) {
    const [a, b] = [tab[i - 1], tab[i]], t = smooth((x - b[0]) / (a[0] - b[0]));
    return b.slice(1).map((v, k) => v + (a[k + 1] - v) * t);
  }
  return tab[tab.length - 1].slice(1);
};

// Side and top profile, a fat teardrop: blunt rounded head, fullest just behind it, tapering to a slim tail stock
// that rises a little. Rows: slice centre z, half width, half height, centre height (voxel units).
const PROFILE = [
  [22.5, 3.4, 4.2, -0.9],
  [21.5, 4.7, 5.3, -0.7],
  [19.5, 5.8, 6.1, -0.5],
  [16.5, 6.6, 6.7, -0.25],
  [12.5, 7.0, 7.0, 0],
  [7.5, 7.0, 7.0, 0],
  [2.5, 6.6, 6.7, 0.1],
  [-3.5, 5.5, 5.9, 0.4],
  [-8.5, 4.1, 4.7, 0.8],
  [-13.5, 2.8, 3.5, 1.2],
  [-17.5, 2.0, 2.7, 1.5],
  [-20.5, 1.6, 2.3, 1.6],
  [-22.5, 1.0, 1.4, 1.6]
];
function section(zc) { const [rx, ry, cy] = lerpTable(PROFILE, zc); return { rx, ry, cy }; }
const P = 2.3;   // superellipse exponent: a little squarer than an ellipse, reads well in voxels
// mouth line (voxel row) along the side: level along the jaw, curling up at the back into a smile
const mouthY = zc => -3 + 2 * smooth((13.5 - zc) / 2);

function whale() {
  const spine = new Map(), finP = new Map(), finN = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;

  // body + tail stock (z from -23, the hub between the flukes, to 23, the snout)
  for (let z = -23; z < 23; z++) {
    const zc = z + 0.5, s = section(zc);
    for (let y = Math.floor(s.cy - s.ry) - 1; y <= s.cy + s.ry + 1; y++) for (let x = -8; x < 8; x++) {
      const xc = x + 0.5, yc = y + 0.5 - s.cy;
      if ((Math.abs(xc) / s.rx) ** P + (Math.abs(yc) / s.ry) ** P > 1) continue;
      spine.set(key(x, y, z), colour(y, zc, s));
    }
  }

  // back dark, sides lighter, belly cream; the throat and lower jaw carry ventral grooves (alternate rows)
  function colour(y, zc, s) {
    const ny = (y + 0.5 - s.cy) / s.ry;
    const lowY = Math.floor(s.cy - s.ry + 0.5);                  // bottom row stays plain cream
    const throat = zc > 3 && zc < 22 && y > lowY;
    if (zc > 12 && y < mouthY(zc)) return throat && (y % 2 === 0) ? C.groove : C.belly;
    if (ny < -0.34) return throat && (y % 2 === 0) && zc > 4 + ((y + 20) % 3) ? C.groove : C.belly;
    return ny > 0.32 ? C.back : C.side;
  }

  // paint the outermost voxel (both sides) at (y, z)
  const outer = (y, z, col) => {
    for (const dir of [1, -1]) {
      for (let x = dir > 0 ? 8 : -9; Math.abs(x + 0.5) > 0; x -= dir) {
        const k = key(x, y, z);
        if (spine.has(k)) { spine.set(k, col); break; }
      }
    }
  };
  const top = (x, z, col) => { for (let y = 10; y > -10; y--) { const k = key(x, y, z); if (spine.has(k)) { spine.set(k, col); return; } } };
  const front = (x, y, col) => { for (let z = 23; z > 0; z--) { const k = key(x, y, z); if (spine.has(k)) { spine.set(k, col); return; } } };

  // mouth line along each side and round the snout, turning up at the corner into a smile
  for (let z = 13; z < 23; z++) outer(-3, z, C.mouth);
  outer(-2, 12, C.mouth); outer(-1, 11, C.mouth);
  for (let x = -8; x < 8; x++) front(x, -3, C.mouth);
  // eye (2 x 3 with a white highlight) above the mouth corner, a pink blush on the cheek below it
  for (const [y, z, col] of [[0, 13, C.eye], [0, 14, C.eye], [1, 13, C.eye], [1, 14, C.eye], [2, 13, C.eye], [2, 14, C.white],
    [-1, 13, C.blush], [-1, 14, C.blush], [-1, 15, C.blush]]) outer(y, z, col);
  // blowhole on top, just behind the head joint
  top(-1, 9, C.hole); top(0, 9, C.hole); top(-1, 8, C.hole); top(0, 8, C.hole);
  // a few pale spots along the back
  for (const [x, z] of [[2, 4], [-3, 2], [3, -2], [-2, -4], [1, -9]]) top(x, z, C.spot);

  // pectoral fins: long rounded paddles reaching out and back, dark on top, pale beneath, rooted inside the body
  for (const [m, sx] of [[finP, 1], [finN, -1]]) {
    for (let a = 3; a < 13; a++) {                 // a = voxel column out from the centre line
      const o = Math.max(0, a + 0.5 - 5.5) / 7;    // 0 at the root, 1 at the tip
      const mid = 6.5 - 5 * o ** 1.2, half = 2.5 + 0.6 * Math.sin(Math.min(1, o * 2) * Math.PI / 2) - 2.2 * smooth((o - 0.45) / 0.6);
      const y0 = -5 - (o > 0.55 ? 1 : 0);
      for (let z = -6; z < 12; z++) {
        const q = z + 0.5 - mid;
        if (Math.abs(q) > half) continue;
        const x = sx > 0 ? a : -a - 1;
        m.set(key(x, y0 + 1, z), C.finTop);
        m.set(key(x, y0, z), q > half - 1 && o > 0.1 ? C.edge : C.finBottom);   // pale leading edge beneath
      }
    }
  }

  // flukes: a swept crescent, dark on top, pale beneath, notched at the centre
  const fy = Math.floor(section(-21).cy);
  for (let x = -10; x < 10; x++) {
    const ax = Math.abs(x + 0.5);
    const lead = -20.6 - 0.055 * ax * ax, trail = -24 - 2.6 * smooth(ax / 6);
    for (let z = -27; z < -21; z++) {
      const zc = z + 0.5;
      if (zc > lead || zc < trail) continue;
      spine.set(key(x, fy + 1, z), C.finTop);
      spine.set(key(x, fy, z), C.finBottom);
    }
  }
  return { spine, finP, finN };
}

// ---------------------------------------------------------------------------------------------------------------
// meshing

const srgbToLinear = h => [1, 3, 5].map(i => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// Greedy meshing of one group of voxels: a face is emitted where the neighbouring cell is not in `solid` (so faces
// between bands of the spine are hidden), and same-coloured faces within a slice are merged into rectangles.
function meshGroup(vox, solid, weigh, out) {
  if (!vox.size) return;
  const lin = out.lin;
  const linear = hex => { if (!lin.has(hex)) lin.set(hex, srgbToLinear(hex)); return lin.get(hex); };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const k of vox.keys()) k.split(',').map(Number).forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); });
  const get = p => vox.get(p[0] + ',' + p[1] + ',' + p[2]);
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    for (const sign of [1, -1]) {
      const n = [0, 0, 0]; n[d] = sign;
      for (let s = lo[d]; s <= hi[d]; s++) {
        const W = hi[u] - lo[u] + 1, H = hi[v] - lo[v] + 1;
        const mask = new Array(W * H).fill(null);
        const p = [0, 0, 0], q = [0, 0, 0];
        for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) {
          p[d] = s; p[u] = lo[u] + a; p[v] = lo[v] + b;
          const c = get(p);
          if (!c) continue;
          q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[d] += sign;
          if (!solid.has(q[0] + ',' + q[1] + ',' + q[2])) mask[b * W + a] = c;
        }
        for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) {
          const c = mask[b * W + a];
          if (!c) continue;
          let w = 1; while (a + w < W && mask[b * W + a + w] === c) w++;
          let h = 1;
          grow: while (b + h < H) { for (let k = 0; k < w; k++) if (mask[(b + h) * W + a + k] !== c) break grow; h++; }
          for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) mask[(b + y) * W + a + k] = null;
          const plane = s + (sign > 0 ? 1 : 0);
          const corner = (da, db) => { const r = [0, 0, 0]; r[d] = plane; r[u] = lo[u] + a + da; r[v] = lo[v] + b + db; return r; };
          let quad = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
          const e1 = quad[1].map((x, i) => x - quad[0][i]), e2 = quad[2].map((x, i) => x - quad[0][i]);
          const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          if (cr[d] * sign < 0) quad = quad.reverse();
          const base = out.pos.length / 3, lc = linear(c);
          for (const r of quad) {
            const [js, ws] = weigh(r);
            out.pos.push(r[0] * V, r[1] * V, r[2] * V); out.nor.push(...n); out.col.push(...lc);
            out.jnt.push(...js); out.wgt.push(...ws);
          }
          out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
}

function mesh({ spine, finP, finN }) {
  const out = { pos: [], nor: [], col: [], jnt: [], wgt: [], idx: [], lin: new Map() };
  // spine bands: cut either side of every joint plane so merged faces never span from a cut into a rigid interior
  const planes = [...new Set(CUTS.flatMap(([p]) => [p - 1, p, p + 1]))].sort((a, b) => a - b);
  const bandOf = z => planes.filter(p => z >= p).length;         // voxel z occupies [z, z+1]
  const bands = new Map();
  for (const [k, c] of spine) {
    const b = bandOf(+k.split(',')[2]);
    if (!bands.has(b)) bands.set(b, new Map());
    bands.get(b).set(k, c);
  }
  const spineWeigh = r => {
    const cut = CUTS.find(([p]) => p === r[2]);
    if (cut) return [[cut[1], cut[2], 0, 0], [0.5, 0.5, 0, 0]];
    return [[segmentOf(r[2]), 0, 0, 0], [1, 0, 0, 0]];
  };
  for (const b of [...bands.keys()].sort((a, b) => a - b)) meshGroup(bands.get(b), spine, spineWeigh, out);
  meshGroup(finP, finP, () => [[FIN_P, 0, 0, 0], [1, 0, 0, 0]], out);
  meshGroup(finN, finN, () => [[FIN_N, 0, 0, 0], [1, 0, 0, 0]], out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// animation

const qAxis = (ax, a) => [ax[0] * Math.sin(a / 2), ax[1] * Math.sin(a / 2), ax[2] * Math.sin(a / 2), Math.cos(a / 2)];
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};

// One stroke: a wave of rotation about X travels from the body down to the flukes, each segment a little later and
// further than the one before (positive = tail bends up). The body pitches very slightly with it and bobs, rising as
// the flukes push down; the head nods against the body. The pectoral fins make a slow mirrored stroke a beat later.
const LAG = 0.6;
const WAVE = [[TAIL1, 6 * D, 1], [TAIL2, 10 * D, 2], [FLUKE, 18 * D, 3]];
const BODY_PITCH = 1.5 * D, HEAD_NOD = 2 * D, BOB = 0.15, FIN_FLAP = 17 * D, FIN_LAG = 0.9, FIN_DROOP = 4 * D;

function pose(ph) {
  const X = [1, 0, 0], Z = [0, 0, 1];
  const rot = PIVOTS.map(() => [0, 0, 0, 1]);
  rot[BODY] = qAxis(X, BODY_PITCH * Math.sin(ph + 0.6));
  rot[HEAD] = qAxis(X, -HEAD_NOD * Math.sin(ph));
  for (const [j, amp, k] of WAVE) rot[j] = qAxis(X, amp * Math.sin(ph - k * LAG));
  const flap = FIN_FLAP * Math.sin(ph - FIN_LAG) - FIN_DROOP;
  rot[FIN_P] = qAxis(Z, flap);
  rot[FIN_N] = qAxis(Z, -flap);
  // flukes up (positive) come with the body low; the power stroke down lifts it
  const bob = -BOB * Math.sin(ph - 3 * LAG);
  return { rot, bob };
}

// bind-relative local translations (tree cubes)
const local = PIVOTS.map((p, j) => PARENT[j] < 0 ? p.map(v => v * V) : p.map((v, a) => (v - PIVOTS[PARENT[j]][a]) * V));

function worlds({ rot, bob }) {
  const W = [];
  for (let j = 0; j < PIVOTS.length; j++) {
    const t = j === BODY ? [local[0][0], local[0][1] + bob, local[0][2]] : local[j];
    if (PARENT[j] < 0) W.push({ q: rot[j], t });
    else {
      const p = W[PARENT[j]], o = qRot(p.q, t);
      W.push({ q: qMul(p.q, rot[j]), t: [p.t[0] + o[0], p.t[1] + o[1], p.t[2] + o[2]] });
    }
  }
  return W;
}

function skinVertex(W, m, i) {
  const r = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = m.wgt[i * 4 + k]; if (!w) continue;
    const j = m.jnt[i * 4 + k], piv = PIVOTS[j];
    const p = qRot(W[j].q, [m.pos[i * 3] - piv[0] * V, m.pos[i * 3 + 1] - piv[1] * V, m.pos[i * 3 + 2] - piv[2] * V]);
    for (let a = 0; a < 3; a++) r[a] += w * (p[a] + W[j].t[a]);
  }
  return r;
}

function animation(m) {
  const times = [], bodyT = [], rot = PIVOTS.map(() => []);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= KEYS; i++) {
    const ph = 2 * Math.PI * i / KEYS, ps = pose(ph);
    times.push(CYCLE * i / KEYS);
    bodyT.push(local[0][0], local[0][1] + ps.bob, local[0][2]);
    ps.rot.forEach((q, j) => rot[j].push(...q));
    const W = worlds(ps);
    for (let v = 0; v < m.pos.length / 3; v++) {
      const p = skinVertex(W, m, v);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    }
  }
  return { times, bodyT, rot, lo, hi };
}

// ---------------------------------------------------------------------------------------------------------------
// glTF

function glb(name) {
  const m = mesh(whale());
  const anim = animation(m);
  const nVerts = m.pos.length / 3;
  const mn = [0, 1, 2].map(a => Math.min(...m.pos.filter((_, i) => i % 3 === a)));
  const mx = [0, 1, 2].map(a => Math.max(...m.pos.filter((_, i) => i % 3 === a)));
  const length = mx[2] - mn[2];
  const span = 2 * Math.max(Math.abs(anim.lo[0]), Math.abs(anim.hi[0]));
  const height = anim.hi[1] - anim.lo[1];

  const chunks = [], views = [], accessors = [];
  let offset = 0;
  const add = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    views.push(Object.assign({ buffer: 0, byteOffset: offset, byteLength: buf.length }, target ? { target } : {}));
    offset += buf.length + pad;
    return views.length - 1;
  };
  const acc = (typed, type, componentType, count, extra, target) => {
    accessors.push(Object.assign({ bufferView: add(typed, target), componentType, count, type }, extra || {}));
    return accessors.length - 1;
  };
  const F = 5126, UB = 5121, US = 5123;
  const aPos = acc(new Float32Array(m.pos), 'VEC3', F, nVerts, { min: mn, max: mx }, 34962);
  const aNor = acc(new Float32Array(m.nor), 'VEC3', F, nVerts, null, 34962);
  const aCol = acc(new Float32Array(m.col), 'VEC3', F, nVerts, null, 34962);
  const aJnt = acc(new Uint8Array(m.jnt), 'VEC4', UB, nVerts, null, 34962);
  const aWgt = acc(new Float32Array(m.wgt), 'VEC4', F, nVerts, null, 34962);
  const aIdx = acc(new Uint16Array(m.idx), 'SCALAR', US, m.idx.length, null, 34963);

  const ibm = new Float32Array(16 * PIVOTS.length);
  PIVOTS.forEach((p, j) => {
    const o = j * 16;
    ibm[o] = ibm[o + 5] = ibm[o + 10] = ibm[o + 15] = 1;
    ibm[o + 12] = -p[0] * V; ibm[o + 13] = -p[1] * V; ibm[o + 14] = -p[2] * V;
  });
  const aIbm = acc(ibm, 'MAT4', F, PIVOTS.length);

  const nk = anim.times.length;
  const aTime = acc(new Float32Array(anim.times), 'SCALAR', F, nk, { min: [0], max: [CYCLE] });
  const aBodyT = acc(new Float32Array(anim.bodyT), 'VEC3', F, nk);
  const aRot = anim.rot.map(r => acc(new Float32Array(r), 'VEC4', F, nk));

  // nodes: 0 root, 1 mesh, 2.. joints in skin order
  const r4 = x => +x.toFixed(4);
  const nodes = [
    { name, children: [1, 2], extras: { unit: '1 = one tree cube', length: r4(length), span: r4(span), height: r4(height), cycle: CYCLE } },
    { name: name + '-mesh', mesh: 0, skin: 0 }
  ];
  PIVOTS.forEach((_, j) => {
    const kids = PARENT.map((p, c) => p === j ? 2 + c : -1).filter(c => c >= 0);
    nodes.push(Object.assign({ name: JOINT_NAMES[j], translation: local[j] }, kids.length ? { children: kids } : {}));
  });
  const samplers = [{ input: aTime, output: aBodyT, interpolation: 'LINEAR' }];
  const channels = [{ sampler: 0, target: { node: 2, path: 'translation' } }];
  aRot.forEach((a, j) => {
    samplers.push({ input: aTime, output: a, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: 2 + j, path: 'rotation' } });
  });
  const gltf = {
    asset: { version: '2.0', generator: 'SakuraQR tools/make-whale.mjs' },
    scene: 0, scenes: [{ name, nodes: [0] }], nodes,
    meshes: [{ name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
    materials: [{ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    skins: [{ joints: PIVOTS.map((_, j) => 2 + j), inverseBindMatrices: aIbm, skeleton: 2 }],
    animations: [{ name: 'swim', samplers, channels }],
    accessors, bufferViews: views, buffers: [{ byteLength: offset }]
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const file = Buffer.concat([header, ch(json.length, 0x4E4F534A), json, ch(bin.length, 0x004E4942), bin]);
  fs.writeFileSync(path.join(OUT, name + '.glb'), file);
  console.log(name + '.glb', file.length, 'bytes,', m.idx.length / 3, 'triangles,', nVerts, 'vertices; length', length.toFixed(2),
    'span', span.toFixed(2), 'height', height.toFixed(2), '; bind box', mn.map(r4), mx.map(r4), '; anim box', anim.lo.map(r4), anim.hi.map(r4));
}

fs.mkdirSync(OUT, { recursive: true });
glb('whale');
