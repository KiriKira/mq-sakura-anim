// Second pass on the tree's pose: line the code printed on the plate up with the camera image.
//
// The network's pose is good to a few millimetres and degrees. The plate's top carries the code's dark and light
// squares at exactly known places, with crisp edges, so: sample points along the edges between dark and light squares
// (and along the plate's outline), project them with the current pose, look along each edge's normal in the image for
// the real edge (light to dark in the right direction; either way for the outline), and solve for the small change of
// pose that moves the projected points onto the edges found (least squares on the distances along the normals,
// Tukey-weighted, three rounds with a shrinking search range). Classic model-based edge tracking (RAPiD).
// The result is used only when enough edges agree, it moved the pose a plausible amount and it fits tightly; otherwise
// the caller keeps the network's pose.
import * as THREE from 'three';
import { treeGeometry } from './treegeom.js';

export function createRefiner({ tree, info, stage }) {
  const geo = treeGeometry(tree, info), { N, cell, x0, z0, plateTop, plateY } = geo;
  // ---- samples: [x, z, nx, nz, kind] in design coordinates; normal from the light side to the dark side (kind 0),
  // or outwards (kind 1, the plate's outline: either contrast) ----
  const S = [];
  const at = (i, k) => (i < 0 || k < 0 || i >= N || k >= N) ? -2 : plateTop[k * N + i];
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const c = at(i, k); if (c < 0) continue;
    for (const [di, dk] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const o = at(i + di, k + dk);
      const ex = x0 + (i + 0.5 + di / 2) * cell, ez = z0 + (k + 0.5 + dk / 2) * cell;   // the shared edge's middle
      const tx = dk, tz = di;                                                               // along the edge
      if (o === -2) for (const f of [-0.3, 0.3]) S.push(ex + tx * f * cell, ez + tz * f * cell, di, dk, 1);   // outline
      else if (o >= 0 && o !== c && c === 0)   // each light|dark pair once, normal towards the dark square
        for (const f of [-0.3, 0.3]) S.push(ex + tx * f * cell, ez + tz * f * cell, di, dk, 0);
    }
  }
  const nS = S.length / 5;

  // ---- the image round the tree, as grey levels ----
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true });
  let img = null, W = 0, H = 0;
  const grey = (x, y) => {   // bilinear, outside -> NaN
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return NaN;
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, i = yi * W + xi;
    return (img[i] * (1 - fx) + img[i + 1] * fx) * (1 - fy) + (img[i + W] * (1 - fx) + img[i + W + 1] * fx) * fy;
  };

  const R = new THREE.Matrix3(), q = new THREE.Quaternion(), M = new THREE.Matrix4(), toA = new THREE.Matrix4();
  const P = new THREE.Vector3(), Pn = new THREE.Vector3(), camLocal = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
  const A = new Float64Array(36), B = new Float64Array(6), row = new Float64Array(6);
  const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), ok: false, used: 0, rms: 0, moved: 0, turned: 0 };

  // source: the video (or a canvas); vw, vh: its size; vfov (degrees) and aspect: the camera's;
  // pos, quat: the anchor's pose in camera space to start from (the anchor is the stage's parent).
  function refine(source, vw, vh, vfov, aspect, pos, quat) {
    const hv = Math.tan(vfov * Math.PI / 360), hh = hv * aspect;
    toA.compose(stage.position, stage.quaternion, stage.scale);   // design -> anchor
    const cp = pos.clone(), cq = quat.clone();
    const project = (X, o) => { o.x = (X.x / -X.z / hh + 1) / 2 * vw; o.y = (1 - X.y / -X.z / hv) / 2 * vh; return o; };   // video px
    const pose = () => { M.compose(cp, cq, tmp.set(1, 1, 1)).multiply(toA); };
    // which samples the camera can see: not behind the tree, facing the camera
    pose(); camLocal.set(0, 0, 0).applyMatrix4(M.clone().invert());
    const vis = new Uint8Array(nS); let nVis = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; const v2 = { x: 0, y: 0 };
    for (let s = 0; s < nS; s++) {
      const x = S[5 * s], z = S[5 * s + 1];
      if (camLocal.y <= plateY) continue;
      dir.set(camLocal.x - x, camLocal.y - plateY, camLocal.z - z).normalize();
      if (dir.y < 0.25 || geo.hits(x, plateY + 0.0001, z, dir)) continue;
      P.set(x, plateY, z).applyMatrix4(M); if (P.z > -0.01) continue;
      project(P, v2); if (v2.x < 0 || v2.y < 0 || v2.x >= vw || v2.y >= vh) continue;
      vis[s] = 1; nVis++; bx0 = Math.min(bx0, v2.x); by0 = Math.min(by0, v2.y); bx1 = Math.max(bx1, v2.x); by1 = Math.max(by1, v2.y);
    }
    out.ok = false; out.used = 0;
    if (nVis < 60) return out;
    // the image: the samples' box plus a margin, at the video's resolution (at most 480 px across)
    const m = 0.15 * Math.max(bx1 - bx0, by1 - by0) + 16;
    const cx0 = Math.max(0, Math.floor(bx0 - m)), cy0 = Math.max(0, Math.floor(by0 - m));
    const cw = Math.min(vw, Math.ceil(bx1 + m)) - cx0, ch = Math.min(vh, Math.ceil(by1 + m)) - cy0;
    const sc = Math.min(1, 480 / Math.max(cw, ch));
    W = Math.max(8, Math.round(cw * sc)); H = Math.max(8, Math.round(ch * sc));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.drawImage(source, cx0, cy0, cw, ch, 0, 0, W, H);
    const rgba = g.getImageData(0, 0, W, H).data;
    if (!img || img.length !== W * H) img = new Float32Array(W * H);
    for (let i = 0, j = 0; i < img.length; i++, j += 4) img[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    const toImg = o => { o.x = (o.x - cx0) * sc; o.y = (o.y - cy0) * sc; return o; };

    const a2 = { x: 0, y: 0 }, b2 = { x: 0, y: 0 }, d = [], rowsJ = [];
    for (const radius of [10, 6, 3.5]) {
      pose(); d.length = 0; rowsJ.length = 0;
      for (let s = 0; s < nS; s++) {
        if (!vis[s]) continue;
        const x = S[5 * s], z = S[5 * s + 1], nx = S[5 * s + 2], nz = S[5 * s + 3], kind = S[5 * s + 4];
        P.set(x, plateY, z).applyMatrix4(M);                       // camera space
        Pn.set(x + nx * 0.0003, plateY, z + nz * 0.0003).applyMatrix4(M);
        toImg(project(P, a2)); toImg(project(Pn, b2));
        let ux = b2.x - a2.x, uy = b2.y - a2.y; const l = Math.hypot(ux, uy); if (l < 1e-3) continue; ux /= l; uy /= l;
        // along the normal: the strongest step from light to dark (kind 0) or any strong step (outline)
        let best = 0, bestAt = 0, gPrev = NaN, gPrev2 = NaN, ok = true;
        const gs = [];
        for (let t = -radius; t <= radius; t += 0.5) {
          const i1 = grey(a2.x + (t + 0.5) * ux, a2.y + (t + 0.5) * uy), i0 = grey(a2.x + (t - 0.5) * ux, a2.y + (t - 0.5) * uy);
          if (Number.isNaN(i1) || Number.isNaN(i0)) { ok = false; break; }
          const gr = kind === 0 ? i0 - i1 : Math.abs(i1 - i0);      // light -> dark along the normal: grey falls
          gs.push(gr); if (gr > best) { best = gr; bestAt = gs.length - 1; }
        }
        if (!ok || best < 10) continue;
        // sub-step peak
        let off = -radius + 0.5 * bestAt;
        if (bestAt > 0 && bestAt < gs.length - 1) { const l0 = gs[bestAt - 1], l2 = gs[bestAt + 1], den = l0 - 2 * best + l2; if (den < 0) off += 0.5 * 0.5 * (l0 - l2) / den; }
        // Jacobian of the image point along the normal w.r.t. a small motion [ω, v] of the camera-space point P
        const s_ = -P.z, kx = vw / (2 * hh) * sc, ky = -vh / (2 * hv) * sc;
        const dux = [kx / s_, 0, kx * P.x / (s_ * s_)], duy = [0, ky / s_, ky * P.y / (s_ * s_)];
        const gx = ux * dux[0] + uy * duy[0], gy = ux * dux[1] + uy * duy[1], gz = ux * dux[2] + uy * duy[2];
        // d(P)/dω = ω × P  ->  [gx, gy, gz] · (ω × P) = ω · (P × g)
        row[0] = P.y * gz - P.z * gy; row[1] = P.z * gx - P.x * gz; row[2] = P.x * gy - P.y * gx;
        row[3] = gx; row[4] = gy; row[5] = gz;
        rowsJ.push(Float64Array.from(row)); d.push(off);
      }
      if (d.length < 50) return out;
      // Tukey weights round the median offset
      const sorted = d.map(Math.abs).sort((p, r) => p - r), c = Math.max(1.0, 2.5 * sorted[sorted.length >> 1]);
      A.fill(0); B.fill(0); let wsum = 0;
      for (let r = 0; r < d.length; r++) {
        const u = d[r] / (2 * c); if (Math.abs(u) >= 1) continue; const w = (1 - u * u) ** 2; wsum += w;
        const J = rowsJ[r];
        for (let i = 0; i < 6; i++) { B[i] += w * J[i] * d[r]; for (let j = 0; j < 6; j++) A[i * 6 + j] += w * J[i] * J[j]; }
      }
      if (wsum < 30) return out;
      for (let i = 0; i < 6; i++) A[i * 6 + i] *= 1.001;
      const x = solve6(A, B); if (!x) return out;
      // apply: P' = (I + [ω]) P + v for the whole pose
      const w = new THREE.Vector3(x[0], x[1], x[2]), ang = w.length();
      if (ang > 1e-9) q.setFromAxisAngle(w.clone().divideScalar(ang), ang); else q.identity();
      cq.premultiply(q); cp.applyQuaternion(q).add(tmp.set(x[3], x[4], x[5]));
    }
    // how well it fits now: the inliers' spread
    let ss = 0, n = 0; for (const v of d) if (Math.abs(v) < 2) { ss += v * v; n++; }
    out.used = n; out.rms = n ? Math.sqrt(ss / n) / sc : 99;   // in video pixels
    out.moved = cp.distanceTo(pos); out.turned = THREE.MathUtils.radToDeg(cq.angleTo(quat));
    // the fit is judged in the pixels it was measured in (the crop, at most 480 across): with a sharper camera the
    // crop is scaled down further, and the same fit would read worse in video pixels without being any worse
    out.ok = n >= 50 && out.rms * sc < 1.5 && out.moved < 0.008 && out.turned < 8;
    out.pos.copy(cp); out.quat.copy(cq);
    return out;
  }
  return { refine, samples: nS };
}

// 6x6 symmetric positive (semi)definite solve, Gaussian elimination with partial pivoting
function solve6(A, b) {
  const a = Float64Array.from(A), x = Float64Array.from(b);
  for (let c = 0; c < 6; c++) {
    let p = c; for (let r = c + 1; r < 6; r++) if (Math.abs(a[r * 6 + c]) > Math.abs(a[p * 6 + c])) p = r;
    if (Math.abs(a[p * 6 + c]) < 1e-12) return null;
    if (p !== c) { for (let k = 0; k < 6; k++) { const t = a[c * 6 + k]; a[c * 6 + k] = a[p * 6 + k]; a[p * 6 + k] = t; } const t = x[c]; x[c] = x[p]; x[p] = t; }
    for (let r = c + 1; r < 6; r++) { const f = a[r * 6 + c] / a[c * 6 + c]; for (let k = c; k < 6; k++) a[r * 6 + k] -= f * a[c * 6 + k]; x[r] -= f * x[c]; }
  }
  for (let c = 5; c >= 0; c--) { let s = x[c]; for (let k = c + 1; k < 6; k++) s -= a[c * 6 + k] * x[k]; x[c] = s / a[c * 6 + c]; }
  return x;
}
