// Builds the three walking figures for scene.js as glTF binaries: node tools/make-walkers.mjs
//
// Each figure is a voxel model (8 voxels per tree cube) skinned rigidly to five joints — hips, two arms, two legs —
// with one looping "run" clip: the body leans and twists, legs and arms swing wide, the hips bounce, and each
// frame the figure is lifted just enough that nothing ever dips below the ground. One mesh, one material (vertex colours) per figure; faces of the same
// colour are merged into larger rectangles (greedy meshing) to keep the triangle count low.
//
// The look follows the three reference sprites: a blue hooded healer with a white-framed crest and swinging pigtails,
// a red mage with a tiered, bent-tipped hat and salmon hair, a gold warrior with a horned helmet and brown hair.
//
// Units: 1 = one tree cube (scene.js scales by info.cell). +Y up, feet on y = 0, facing +Z.
// The root node's extras carry { unit, height, radius, stride, cycle }: stride is how far the figure moves over one
// cycle when the clip plays at speed 1, so the host can set timeScale = speed / (stride / cycle).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const V = 0.125;              // voxel edge in tree cubes
const CYCLE = 0.56;           // seconds per run cycle (two strides)
const LEG_SWING = 40 * Math.PI / 180;
const ARM_SWING = 55 * Math.PI / 180;
const ARM_FORWARD = 10 * Math.PI / 180;   // arms carried a little in front
const LEAN = 11 * Math.PI / 180;          // forward lean of the body
const TWIST = 8 * Math.PI / 180;          // body turning with the arms
const BOUNCE = 2.2;           // hip rise in the flight phase, in voxels
const BRAID_LIFT = -32 * Math.PI / 180;   // pigtails' mean angle (down from straight out)
const BRAID_FLICK = 24 * Math.PI / 180;   // how far they flick up and down with the bounce
const BRAID_LAG = 1.3;                     // radians behind the bounce
const BRAID_SWAY = 10 * Math.PI / 180;
const BRAID_TRAIL = 30 * Math.PI / 180;   // swept back by the run
const STRIDE_GAIN = 1.0;      // stride per cycle, relative to how far the legs reach
const KEYS = 24;

// joints: 0 hips (body, head, hat, cape), 1 arm +x, 2 arm -x, 3 leg +x, 4 leg -x, 5 braid +x, 6 braid -x
const HIPS = 0, ARM_P = 1, ARM_N = 2, LEG_P = 3, LEG_N = 4, BRAID_P = 5, BRAID_N = 6;   // braids: only the blue figure has any
const PIVOTS = [[0, 5, 0], [8.5, 11, 0], [-8.5, 11, 0], [2.5, 5, 0], [-2.5, 5, 0], [8, 16, 0], [-8, 16, 0]];   // voxel units, absolute
const JOINT_NAMES = ['hips', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'braid_l', 'braid_r'];

function figure() {
  const parts = PIVOTS.map(() => new Map());
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const set = (j, x, y, z, col) => { if (col) parts[j].set(key(x, y, z), col); else parts[j].delete(key(x, y, z)); };
  const api = {
    parts,
    box(j, x0, x1, y0, y1, z0, z1, col) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) set(j, x, y, z, col);
    },
    px(j, x, y, z, col) { set(j, x, y, z, col); },
    // same box on both sides of x = 0
    pair(j, x0, x1, y0, y1, z0, z1, col) { api.box(j, x0, x1, y0, y1, z0, z1, col); api.box(j, -x1, -x0, y0, y1, z0, z1, col); },
    // box with its vertical edges and top edges bevelled off by one voxel (bottom edges kept)
    rbox(j, x0, x1, y0, y1, z0, z1, col, top = true) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
        const ex = x === x0 || x === x1 - 1, ez = z === z0 || z === z1 - 1, ey = top && y === y1 - 1;
        if ((ex && ez) || (ex && ey) || (ez && ey)) continue;
        set(j, x, y, z, col);
      }
    },
    // vertical cylinder of radius r round (cx, cz), voxel centres inside
    disc(j, cx, cz, r, y0, y1, col) {
      for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) for (let z = Math.floor(cz - r) - 1; z <= cz + r + 1; z++) {
        if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 > r * r) continue;
        for (let y = y0; y < y1; y++) set(j, x, y, z, col);
      }
    },
    // recolour the frontmost (+Z) / backmost (-Z) voxel of each (x, y) column in the range
    front(j, x0, x1, y0, y1, col, dir = 1) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) {
        let best = null;
        for (const k of parts[j].keys()) {
          const [a, b, c] = k.split(',').map(Number);
          if (a === x && b === y && (best === null || c * dir > best * dir)) best = c;
        }
        if (best !== null) set(j, x, y, best, col);
      }
    },
    back(j, x0, x1, y0, y1, col) { api.front(j, x0, x1, y0, y1, col, -1); }
  };
  return api;
}

// The common body (chibi: the head is about half the height): 3-voxel legs with shoes, a stepped robe over the
// hips, a 12x6x8 torso with shoulders, 3x7x4 arms with hands. Heads start at y = 12 and differ per figure.
function body(f, c) {
  for (const [j, x0] of [[LEG_P, 1], [LEG_N, -4]]) {
    f.box(j, x0, x0 + 3, 2, 5, -2, 2, c.leg);
    f.box(j, x0, x0 + 3, 0, 2, -2, 3, c.shoe);
  }
  f.rbox(HIPS, -8, 8, 2, 4, -6, 6, c.skirt, false);
  f.rbox(HIPS, -7, 7, 4, 6, -5, 5, c.skirt, false);
  f.rbox(HIPS, -6, 6, 6, 12, -4, 4, c.torso, false);
  f.rbox(HIPS, -7, 7, 10, 12, -3, 3, c.torso);
  for (const [j, x0] of [[ARM_P, 7], [ARM_N, -10]]) {
    f.rbox(j, x0, x0 + 3, 5, 12, -2, 2, c.sleeve);
    f.box(j, x0, x0 + 3, 5, 6, -2, 2, c.cuff);
    f.box(j, x0, x0 + 3, 3, 5, -1, 2, c.hand);
  }
}

// Face on the front layer (z = 5) of a 14-wide head: eyes 2x3, a small mouth.
function face(f, c) {
  f.box(HIPS, -6, 6, 12, 19, 5, 6, c.skin);
  f.box(HIPS, -4, -2, 14, 17, 5, 6, c.eye);
  f.box(HIPS, 2, 4, 14, 17, 5, 6, c.eye);
  f.box(HIPS, -1, 1, 13, 14, 5, 6, c.mouth);
}

const SKIN = { skin: '#EBB693', mouth: '#D49274', hand: '#EBB693' };

// Blue: hooded healer.
function blue() {
  const c = Object.assign({}, SKIN, {
    hood: '#1C4CC2', light: '#2E9BE6', dark: '#10308A', braid: '#1A3FA6', white: '#E8E8E2', eye: '#2B8FE6',
    leg: '#E8E8E2', shoe: '#E8E8E2', torso: '#1C4CC2', skirt: '#1C4CC2', sleeve: '#1C4CC2', cuff: '#2E9BE6'
  });
  const f = figure(); body(f, c);
  f.rbox(HIPS, -8, 8, 11, 25, -7, 7, c.hood);               // the hood is the head
  f.box(HIPS, -6, 6, 12, 20, 6, 7, null);                   // face opening, one voxel deep
  face(f, c);
  f.box(HIPS, -6, 6, 19, 20, 5, 6, c.hood);                 // hood's inner brow
  f.box(HIPS, -6, -5, 14, 19, 5, 6, c.dark); f.box(HIPS, 5, 6, 14, 19, 5, 6, c.dark);   // dark locks by the face
  f.rbox(HIPS, -8, 8, 20, 21, -7, 7, c.white, false);      // white band round the hood ...
  f.box(HIPS, -7, 7, 20, 21, 6, 8, c.white);                // crest: the band's front bar ...
  f.box(HIPS, -3, 3, 21, 25, 7, 8, c.white);                // ... white frame ...
  f.box(HIPS, -2, 2, 22, 24, 7, 8, c.light);                // ... light-blue jewel
  f.box(HIPS, -1, 1, 25, 26, -2, 6, c.white);               // ridge over the top
  f.box(HIPS, -6, 6, 20, 21, -8, -7, c.white);              // and a white T on the back
  f.box(HIPS, -1, 1, 21, 25, -8, -7, c.white);
  // pigtails from under the hood, on their own joints so they swing (modelled sticking straight out)
  for (const [j, s] of [[BRAID_P, 1], [BRAID_N, -1]]) {
    const bx = (a, b, y0, y1, col) => f.box(j, s > 0 ? a : -b, s > 0 ? b : -a, y0, y1, -1, 1, col);
    bx(8, 9, 14, 17, c.light);                              // hair tie
    bx(9, 13, 15, 17, c.dark);                              // plait ...
    bx(10, 11, 15, 17, c.braid); bx(12, 13, 15, 17, c.braid);
    bx(13, 15, 14, 18, c.dark);                             // ... ending in a tuft that curls up
    bx(14, 15, 18, 19, c.dark);
  }
  f.box(HIPS, -6, 6, 10, 12, 3, 5, c.light);                // collar, zigzag edged
  for (let x = -6; x < 6; x++) if (((x + 6) % 4) < 2) f.px(HIPS, x, 10, 4, c.hood);
  f.front(HIPS, -1, 1, 3, 10, c.light);                     // robe opening
  f.box(HIPS, -8, 8, 2, 3, -6, 6, c.dark);                  // hem
  f.back(HIPS, -5, 5, 3, 11, c.dark);                       // cape
  f.back(HIPS, -5, 5, 8, 9, c.light);
  return { name: 'walker-blue', f };
}

// Red: mage.
function red() {
  const c = Object.assign({}, SKIN, {
    hat: '#9C0E1C', band: '#BC1A28', hair: '#E2503B', eye: '#7E0B16',
    robe: '#DE4636', dark: '#9C0E1C', white: '#ECE6DE', leg: '#EBB693', shoe: '#ECE6DE', torso: '#DE4636', skirt: '#DE4636',
    sleeve: '#DE4636', cuff: '#ECE6DE'
  });
  const f = figure(); body(f, c);
  f.rbox(HIPS, -7, 7, 12, 23, -6, 6, c.hair);
  face(f, c);
  f.box(HIPS, -6, 6, 19, 21, 5, 6, c.hair);                 // fringe, parted at the sides
  for (const [x, y] of [[-6, 18], [-6, 17], [-5, 18], [5, 18], [5, 17], [4, 18]]) f.px(HIPS, x, y, 5, c.hair);
  f.pair(HIPS, 7, 8, 12, 19, -4, 3, c.hair);                // hair puffing out at the sides
  f.pair(HIPS, 8, 9, 13, 17, -2, 2, c.hair);
  f.box(HIPS, -7, 7, 6, 12, -6, -4, c.hair);                // long hair down the back
  f.disc(HIPS, 0, -0.5, 11, 22, 24, c.hat);                 // brim with a lighter band
  f.disc(HIPS, 0, -0.5, 11, 23, 24, c.band);
  f.disc(HIPS, 0, -0.5, 9.5, 23, 24, c.hat);
  f.disc(HIPS, 0, -0.5, 7, 24, 27, c.hat);                  // tiered crown, leaning back
  f.disc(HIPS, 0, -0.5, 7.01, 24, 25, c.band);
  f.disc(HIPS, -0.5, -1.5, 5.2, 27, 30, c.hat);
  f.disc(HIPS, -1, -2.5, 3.6, 30, 32, c.hat);
  f.box(HIPS, -3, 0, 32, 34, -4, -1, c.hat);                // tip, bending over
  f.box(HIPS, -6, -2, 34, 35, -4, -2, c.hat);
  f.px(HIPS, -6, 33, -3, c.hat);
  f.box(HIPS, -6, 6, 10, 12, 3, 5, c.white);                // white collar, zigzag edged
  for (let x = -6; x < 6; x++) if (((x + 6) % 4) >= 2) f.px(HIPS, x, 10, 4, c.robe);
  f.front(HIPS, -2, 2, 3, 10, c.dark);                      // robe opening
  f.box(HIPS, -8, 8, 2, 4, -6, 6, c.dark);                  // hem
  return { name: 'walker-red', f };
}

// Gold: horned warrior.
function gold() {
  const c = Object.assign({}, SKIN, {
    helm: '#D98E08', light: '#F2AA1A', dark: '#A76505', horn: '#D6D3C8', hornTip: '#F0EEE6', hair: '#5E320C', eye: '#3E1E06',
    white: '#E4E1D8', leg: '#E4E1D8', shoe: '#7A4410', torso: '#D98E08', skirt: '#D98E08',
    sleeve: '#D98E08', cuff: '#E4E1D8'
  });
  const f = figure(); body(f, c);
  f.rbox(HIPS, -7, 7, 12, 23, -6, 6, c.hair);
  face(f, c);
  f.box(HIPS, -6, -5, 15, 19, 5, 6, c.hair); f.box(HIPS, 5, 6, 15, 19, 5, 6, c.hair);   // sideburns
  f.box(HIPS, -5, -2, 18, 19, 5, 6, c.hair); f.box(HIPS, 2, 5, 18, 19, 5, 6, c.hair);   // thick brows
  f.rbox(HIPS, -8, 8, 19, 25, -7, 7, c.helm);               // helmet
  f.rbox(HIPS, -8, 8, 19, 20, -7, 7, c.dark, false);        // rim
  f.rbox(HIPS, -6, 6, 25, 27, -5, 5, c.light);              // dome
  f.box(HIPS, -1, 1, 20, 27, 7, 8, c.light);                // ridge down the front
  f.box(HIPS, -1, 1, 27, 28, -3, 4, c.light);
  f.pair(HIPS, 8, 10, 21, 23, -1, 1, c.horn);               // horns: out, up, and a knob turned out
  f.pair(HIPS, 10, 12, 21, 28, -1, 1, c.horn);
  f.pair(HIPS, 12, 13, 26, 29, -1, 1, c.hornTip);
  f.pair(HIPS, 10, 12, 28, 29, -1, 1, c.hornTip);
  f.box(HIPS, -7, 7, 12, 19, -7, -6, c.hair);               // hair at the back, below the helmet
  f.front(HIPS, -3, 3, 10, 11, c.white);                    // chest band
  f.box(HIPS, -6, 6, 7, 8, -4, 4, c.dark);                  // belt
  f.front(HIPS, -1, 1, 7, 8, c.light);                      // buckle
  f.box(HIPS, -8, 8, 2, 3, -6, 6, c.dark);                  // hem
  for (const [j, x0] of [[ARM_P, 7], [ARM_N, -10]]) f.rbox(j, x0 - 1, x0 + 4, 10, 13, -3, 3, c.light);   // pauldrons
  return { name: 'walker-gold', f };
}

// ---------------------------------------------------------------------------------------------------------------

const srgbToLinear = h => [1, 3, 5].map(i => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// Greedy meshing per joint: for each face direction and slice, merge same-coloured exposed faces into rectangles.
function mesh(parts) {
  const pos = [], nor = [], col = [], jnt = [], idx = [];
  const lin = new Map();
  const linear = hex => { if (!lin.has(hex)) lin.set(hex, srgbToLinear(hex)); return lin.get(hex); };
  parts.forEach((vox, j) => {
    if (!vox.size) return;
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
            if (!get(q)) mask[b * W + a] = c;
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
            // orient so the winding faces along n
            const e1 = quad[1].map((x, i) => x - quad[0][i]), e2 = quad[2].map((x, i) => x - quad[0][i]);
            const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            if (cr[d] * sign < 0) quad = quad.reverse();
            const base = pos.length / 3, lc = linear(c);
            for (const r of quad) { pos.push(r[0] * V, r[1] * V, r[2] * V); nor.push(...n); col.push(...lc); jnt.push(j, 0, 0, 0); }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
  });
  return { pos, nor, col, jnt, idx };
}

const quatX = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];

// quaternion helpers: [x, y, z, w]
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

// A run cycle: the body leans forward and twists with the arms, legs and arms swing wide (arms held a little
// forward), and the body is highest when the legs are spread (the moment both feet are off the ground) and
// lowest as a leg passes under it. Each key, the whole figure is posed and the hips lifted so that its lowest
// vertex sits exactly on y = 0 at the lowest point of the bounce, so nothing ever sinks into the ground.
function animation(m) {
  const X = [1, 0, 0], Y = [0, 1, 0];
  const keys = [];
  for (let i = 0; i <= KEYS; i++) {
    const ph = 2 * Math.PI * i / KEYS, s = Math.sin(ph);
    const legA = LEG_SWING * s, armA = ARM_SWING * s;
    const limb = [-armA - ARM_FORWARD, armA - ARM_FORWARD, legA, -legA].map(a => qAxis(X, a));
    // pigtails: hang down, flick up a beat after each bounce, trail behind, and sway with the body's twist
    for (const side of [1, -1]) {
      const lift = BRAID_LIFT + BRAID_FLICK * Math.cos(2 * ph - BRAID_LAG) + side * BRAID_SWAY * s;
      limb.push(qMul(qAxis(Y, side * (BRAID_TRAIL + 0.1 * Math.sin(2 * ph))), qAxis([0, 0, 1], side * lift)));
    }
    const hipQ = qMul(qAxis(Y, -TWIST * s), qAxis(X, LEAN));
    const bounce = BOUNCE * (1 - Math.cos(2 * ph)) / 2;
    // lowest vertex with the hips at their pivot height
    let low = Infinity;
    const posed = [];
    for (let k = 0; k < m.pos.length; k += 3) {
      const j = m.jnt[(k / 3) * 4];
      let v = [m.pos[k] / V, m.pos[k + 1] / V, m.pos[k + 2] / V];
      if (j) {
        const p = PIVOTS[j];
        v = qRot(limb[j - 1], [v[0] - p[0], v[1] - p[1], v[2] - p[2]]);
        v = [v[0] + p[0] - PIVOTS[HIPS][0], v[1] + p[1] - PIVOTS[HIPS][1], v[2] + p[2] - PIVOTS[HIPS][2]];
      } else v = [v[0] - PIVOTS[HIPS][0], v[1] - PIVOTS[HIPS][1], v[2] - PIVOTS[HIPS][2]];
      const w = qRot(hipQ, v);
      w[1] += PIVOTS[HIPS][1];
      posed.push(w);
      low = Math.min(low, w[1]);
    }
    keys.push({ limb, hipQ, bounce, low, posed });
  }
  // lift each key so its lowest point is on the ground, then add the bounce on top
  const times = [], hips = [], hipRot = [], rot = PIVOTS.slice(1).map(() => []);
  let height = 0, radius = 0;
  keys.forEach((k, i) => {
    const lift = -k.low + k.bounce + 0.04;
    for (const w of k.posed) { height = Math.max(height, (w[1] + lift) * V); radius = Math.max(radius, Math.hypot(w[0], w[2]) * V); }
    times.push(CYCLE * i / KEYS);
    hips.push(0, (PIVOTS[HIPS][1] + lift) * V, 0);
    hipRot.push(...k.hipQ);
    k.limb.forEach((q, j) => rot[j].push(...q));
  });
  const stride = STRIDE_GAIN * 4 * PIVOTS[LEG_P][1] * V * Math.sin(LEG_SWING);
  return { times, hips, hipRot, rot, stride, height, radius };
}

function glb({ name, f }) {
  const m = mesh(f.parts);
  const anim = animation(m);
  const maxY = anim.height, maxR = anim.radius;

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
  const nVerts = m.pos.length / 3;
  const P = new Float32Array(m.pos);
  const mn = [0, 1, 2].map(a => Math.min(...m.pos.filter((_, i) => i % 3 === a)));
  const mx = [0, 1, 2].map(a => Math.max(...m.pos.filter((_, i) => i % 3 === a)));
  const aPos = acc(P, 'VEC3', F, nVerts, { min: mn, max: mx }, 34962);
  const aNor = acc(new Float32Array(m.nor), 'VEC3', F, nVerts, null, 34962);
  const aCol = acc(new Float32Array(m.col), 'VEC3', F, nVerts, null, 34962);
  const aJnt = acc(new Uint8Array(m.jnt), 'VEC4', UB, nVerts, null, 34962);
  const W = new Float32Array(nVerts * 4); for (let i = 0; i < nVerts; i++) W[i * 4] = 1;
  const aWgt = acc(W, 'VEC4', F, nVerts, null, 34962);
  const aIdx = acc(new Uint16Array(m.idx), 'SCALAR', US, m.idx.length, null, 34963);

  // joint world positions at bind (hips at its pivot, children relative to it)
  const world = PIVOTS.map(p => p.map(v => v * V));
  const ibm = new Float32Array(16 * PIVOTS.length);
  world.forEach((w, j) => {
    const o = j * 16;
    ibm[o] = ibm[o + 5] = ibm[o + 10] = ibm[o + 15] = 1;
    ibm[o + 12] = -w[0]; ibm[o + 13] = -w[1]; ibm[o + 14] = -w[2];
  });
  const aIbm = acc(ibm, 'MAT4', F, PIVOTS.length);

  const aTime = acc(new Float32Array(anim.times), 'SCALAR', F, anim.times.length, { min: [0], max: [CYCLE] });
  const aHips = acc(new Float32Array(anim.hips), 'VEC3', F, anim.times.length);
  const aHipRot = acc(new Float32Array(anim.hipRot), 'VEC4', F, anim.times.length);
  const aRot = anim.rot.map(r => acc(new Float32Array(r), 'VEC4', F, anim.times.length));

  // nodes: 0 root, 1 mesh, 2 hips, 3.. limbs
  const nodes = [
    { name, children: [1, 2], extras: { unit: '1 = one tree cube (info.cell)', height: +maxY.toFixed(4), radius: +maxR.toFixed(4), stride: +anim.stride.toFixed(4), cycle: CYCLE } },
    { name: name + '-mesh', mesh: 0, skin: 0 },
    { name: 'hips', translation: world[HIPS], children: PIVOTS.slice(1).map((_, j) => 3 + j) }
  ];
  for (let j = 1; j < PIVOTS.length; j++) {
    nodes.push({ name: JOINT_NAMES[j], translation: world[j].map((v, a) => v - world[HIPS][a]) });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'SakuraQR tools/make-walkers.mjs' },
    scene: 0, scenes: [{ name, nodes: [0] }], nodes,
    meshes: [{ name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
    materials: [{ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    skins: [{ joints: PIVOTS.map((_, j) => 2 + j), inverseBindMatrices: aIbm, skeleton: 2 }],
    animations: [{
      name: 'run',
      samplers: [aHips, aHipRot, ...aRot].map(o => ({ input: aTime, output: o, interpolation: 'LINEAR' })),
      channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }, { sampler: 1, target: { node: 2, path: 'rotation' } },
        ...aRot.map((_, j) => ({ sampler: j + 2, target: { node: 3 + j, path: 'rotation' } }))]
    }],
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
  console.log(name + '.glb', file.length, 'bytes,', m.idx.length / 3, 'triangles, height', maxY.toFixed(2), 'radius', maxR.toFixed(2), 'stride', anim.stride.toFixed(2));
}

fs.mkdirSync(OUT, { recursive: true });
for (const fig of [blue(), red(), gold()]) glb(fig);
