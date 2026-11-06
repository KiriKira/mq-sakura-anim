// Where the real light comes from, read off the real tree's shadow on the table.
//
// The tree's shape is known (the design tree, squeezed like the print) and so is its pose in the camera image. For
// each of a set of light directions, work out once which points of the table around the plate lie in the tree's
// shadow. Then, every few frames, look at those points in the camera image: the direction whose shadowed points are
// clearly darker than the rest is where the light comes from. When no direction stands out (overcast, soft light),
// say so, and the page softens its shadows instead.
//
// All geometry is in the stage's own (design) coordinates: metres, the plate's bottom at y = 0, centred. Light
// directions are physical (as printed): a direction d in print space is P⁻¹d in design space, P the print scale.
import * as THREE from 'three';

const AZ_STEP = 15, ELEVATIONS = [20, 30, 40, 50, 60, 70, 80];   // degrees
const STEP = 0.0004;                                             // ray-march step, design metres

export function createLightEstimator({ tree, info, printScale, stage }) {
  // ---- solid intervals per grid cell, from the tree's horizontal faces (each face covers one cell) ----
  const N = info.grid.cols, cell = info.cell, x0 = info.grid.origin[0], z0 = info.grid.origin[1];
  const faces = Array.from({ length: N * N }, () => []);
  const toTree = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(tree.matrixWorld).invert();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  tree.traverse(o => {
    if (!o.isMesh) return;
    toTree.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.getAttribute('position'), idx = o.geometry.index;
    const tri = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
    for (let t = 0; t < (idx ? idx.count : p.count) / 3; t += 2) {   // quads: two triangles each, take the first
      a.fromBufferAttribute(p, tri(t, 0)).applyMatrix4(toTree); b.fromBufferAttribute(p, tri(t, 1)).applyMatrix4(toTree); c.fromBufferAttribute(p, tri(t, 2)).applyMatrix4(toTree);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      if (Math.abs(n.y) < 0.9) continue;
      const i = Math.floor(((a.x + b.x + c.x) / 3 - x0) / cell), k = Math.floor(((a.z + b.z + c.z) / 3 - z0) / cell);
      if (i >= 0 && k >= 0 && i < N && k < N) faces[k * N + i].push([(a.y + b.y + c.y) / 3, n.y > 0 ? 1 : -1]);
    }
  });
  const solid = faces.map(f => {   // [bottom, top, bottom, top, ...]
    f.sort((u, v) => u[0] - v[0]); const out = []; let depth = 0;
    for (const [y, s] of f) { if (s < 0) { if (depth++ === 0) out.push(y); } else if (--depth === 0) out.push(y); else if (depth < 0) depth = 0; }
    return out;
  });
  let top = 0; for (const s of solid) if (s.length) top = Math.max(top, s[s.length - 1]);
  const blocked = (x, y, z) => {
    const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell);
    if (i < 0 || k < 0 || i >= N || k >= N) return false;
    const s = solid[k * N + i];
    for (let j = 0; j + 1 < s.length; j += 2) if (y >= s[j] && y <= s[j + 1]) return true;
    return false;
  };
  // from (x, 0.0002, z) towards direction d (design space, unit): does it run into the tree before rising above it?
  const hits = (x, z, d, y = 0.0002) => {
    for (let t = STEP; ; t += STEP) {
      const yy = y + d.y * t; if (yy > top) return false;
      if (blocked(x + d.x * t, yy, z + d.z * t)) return true;
    }
  };

  // ---- table points round the plate, out to 6 cm (design), every 2.5 mm, not on the plate ----
  const half = info.plate.size / 2 + 0.0015, pts = [];
  for (let x = -0.06; x <= 0.06; x += 0.0025) for (let z = -0.06; z <= 0.06; z += 0.0025)
    if (Math.hypot(x, z) <= 0.06 && (Math.abs(x) > half || Math.abs(z) > half)) pts.push(x, z);
  const nPts = pts.length / 2;

  // ---- light directions (physical) and which points each shadows ----
  const dirs = [], masks = [];
  for (const el of ELEVATIONS) for (let az = 0; az < 360; az += AZ_STEP) {
    const e = el * Math.PI / 180, z = az * Math.PI / 180;
    const phys = new THREE.Vector3(Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z));
    const d = phys.clone().divide(printScale).normalize();
    const m = new Uint8Array(nPts);
    for (let p = 0; p < nPts; p++) m[p] = hits(pts[2 * p], pts[2 * p + 1], d) ? 1 : 0;
    dirs.push({ az, el, phys }); masks.push(m);
  }

  // ---- reading the camera image ----
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true });
  const lum = new Float32Array(nPts), seen = new Uint8Array(nPts), v = new THREE.Vector3(), camLocal = new THREE.Vector3(), toCam = new THREE.Vector3();
  let brightness = 0.5;
  // video: the <video>; camera: the three camera whose view is the video's (same aspect). Returns the best direction
  // { phys, az, el, contrast } or null when no shadow stands out; .brightness is the image's mean brightness (0-1).
  function estimate(video, camera) {
    const W = 192, H = Math.max(1, Math.round(W * video.videoHeight / video.videoWidth));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.drawImage(video, 0, 0, W, H);
    const img = g.getImageData(0, 0, W, H).data;
    let sum = 0; for (let i = 0; i < img.length; i += 16) sum += img[i] + img[i + 1] + img[i + 2]; brightness = sum / (img.length / 16) / 765;
    stage.updateMatrixWorld(); camera.updateMatrixWorld();
    camLocal.set(0, 0, 0).applyMatrix4(camera.matrixWorld); stage.worldToLocal(camLocal);
    let nSeen = 0;
    for (let p = 0; p < nPts; p++) {
      seen[p] = 0;
      const x = pts[2 * p], z = pts[2 * p + 1];
      v.set(x, 0, z); stage.localToWorld(v); v.project(camera);
      if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98 || v.z > 1) continue;
      toCam.set(camLocal.x - x, camLocal.y, camLocal.z - z).normalize();
      if (hits(x, z, toCam)) continue;                                   // behind the tree, seen from the camera
      const px = Math.floor((v.x + 1) / 2 * W), py = Math.floor((1 - v.y) / 2 * H), i = (py * W + px) * 4;
      lum[p] = (0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]) / 255; seen[p] = 1; nSeen++;
    }
    if (nSeen < 150) return null;
    let best = null;
    for (let j = 0; j < dirs.length; j++) {
      const m = masks[j]; let si = 0, ni = 0, so = 0, no = 0;
      for (let p = 0; p < nPts; p++) if (seen[p]) { if (m[p]) { si += lum[p]; ni++; } else { so += lum[p]; no++; } }
      if (ni < 25 || no < 60) continue;
      const contrast = (so / no - si / ni) / (so / no + 1e-3);           // how much darker the shadow is
      if (!best || contrast > best.contrast) best = { ...dirs[j], contrast };
    }
    return best;
  }
  return { estimate, get brightness() { return brightness; }, count: dirs.length, points: nPts };
}
