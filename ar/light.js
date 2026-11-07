// Where the real light comes from, read off the real tree's shadow.
//
// The tree's shape is known (the design tree, squeezed like the print) and so is its pose in the camera image. For
// each of a set of light directions, work out once which points around the tree lie in its shadow: on the table round
// the plate, and on the plate's own light squares. Then, every few frames, look at those points in the camera image
// and score each direction by how much darker its shadowed points are than the rest:
//  - on the table, after taking out any overall brightening or darkening across it (a plane fitted to the brightness):
//    a table that is just darker towards the camera, say, is not a shadow;
//  - and next to the tree: in a ring of table round the plate, or on the plate's light squares. The tree's shadow
//    starts at the tree; a dark patch further off (the photographer's own shadow, which falls right where the tree's
//    would with the light in front of the camera) doesn't count on its own.
// A direction scores the smaller of the two. The scores add up over time (each direction keeps a running average of
// the frames it could be judged in), and the best one so far is where the light comes from; single odd frames don't
// swing it. When none stands out (overcast, soft light), the page softens its shadows instead.
//
// All geometry is in the stage's own (design) coordinates: metres, the plate's bottom at y = 0, centred. Light
// directions are physical (as printed): a direction d in print space is P⁻¹d in design space, P the print scale.
import * as THREE from 'three';
import { treeGeometry } from './treegeom.js';

const AZ_STEP = 15, ELEVATIONS = [20, 30, 40, 50, 60, 70, 80];   // degrees
const NEAR = 0.015;   // m (design): the ring of table next to the plate
const KEEP = 0.15;    // how much each new frame moves a direction's running score
const SETTLE = 6;    // frames a direction must have been judged in before it can be the answer (about 2 s)

export function createLightEstimator({ tree, info, printScale, stage }) {
  const geo = treeGeometry(tree, info);

  // ---- sample points: table round the plate out to 6 cm, every 2.5 mm (group 0 = near the plate, 1 = further), and
  // the plate's light squares, every 1.25 mm, not where the trunk stands (group 2) ----
  const half = info.plate.size / 2 + 0.0015, pts = [];   // [x, y, z, group]
  for (let x = -0.06; x <= 0.06; x += 0.0025) for (let z = -0.06; z <= 0.06; z += 0.0025) {
    const r = Math.max(Math.abs(x), Math.abs(z));
    if (Math.hypot(x, z) <= 0.06 && r > half) pts.push(x, 0.0002, z, r <= half + NEAR ? 0 : 1);
  }
  const ph = info.plate.size / 2 - 0.0008, py = geo.plateY + 0.0002;
  for (let x = -ph; x <= ph; x += 0.00125) for (let z = -ph; z <= ph; z += 0.00125) {
    const i = Math.floor((x - geo.x0) / geo.cell), k = Math.floor((z - geo.z0) / geo.cell);
    if (i < 0 || k < 0 || i >= geo.N || k >= geo.N || geo.plateTop[k * geo.N + i] !== 0) continue;
    if (geo.blocked(x, py + 0.0006, z)) continue;   // the trunk (or anything else) stands here
    pts.push(x, py, z, 2);
  }
  const nPts = pts.length / 4;

  // ---- light directions (physical) and which points each shadows ----
  const dirs = [], masks = [];
  for (const el of ELEVATIONS) for (let az = 0; az < 360; az += AZ_STEP) {
    const e = el * Math.PI / 180, z = az * Math.PI / 180;
    const phys = new THREE.Vector3(Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z));
    const d = phys.clone().divide(printScale).normalize();
    const m = new Uint8Array(nPts);
    for (let p = 0; p < nPts; p++) m[p] = geo.hits(pts[4 * p], pts[4 * p + 1], pts[4 * p + 2], d) ? 1 : 0;
    dirs.push({ az, el, phys }); masks.push(m);
  }
  const score = new Float32Array(dirs.length), judged = new Uint16Array(dirs.length);

  // ---- reading the camera image ----
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true });
  const lum = new Float32Array(nPts), seen = new Uint8Array(nPts), v = new THREE.Vector3(), camLocal = new THREE.Vector3(), toCam = new THREE.Vector3();
  let brightness = 0.5, last = null;
  // contrast of one group of points under one direction's mask: how much darker the shadowed ones are (NaN: too few)
  const contrast = (m, group, minIn, minOut) => {
    let si = 0, ni = 0, so = 0, no = 0;
    for (let p = 0; p < nPts; p++) if (seen[p] && (group < 0 ? pts[4 * p + 3] < 2 : pts[4 * p + 3] === group)) {
      if (m[p]) { si += lum[p]; ni++; } else { so += lum[p]; no++; }
    }
    return ni < minIn || no < minOut ? NaN : (so / no - si / ni) / (so / no + 1e-3);
  };
  // video: the <video>; camera: the three camera whose view is the video's (same aspect). Returns the best direction
  // so far { phys, az, el, contrast } (contrast: its running score), or null until some have been judged for a while;
  // .brightness is the image's mean brightness (0-1), .last the best direction of the latest frame alone.
  function estimate(video, camera) {
    const W = 256, H = Math.max(1, Math.round(W * video.videoHeight / video.videoWidth));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.drawImage(video, 0, 0, W, H);
    const img = g.getImageData(0, 0, W, H).data;
    let sum = 0; for (let i = 0; i < img.length; i += 16) sum += img[i] + img[i + 1] + img[i + 2]; brightness = sum / (img.length / 16) / 765;
    stage.updateMatrixWorld(); camera.updateMatrixWorld();
    camLocal.set(0, 0, 0).applyMatrix4(camera.matrixWorld); stage.worldToLocal(camLocal);
    let nTable = 0;
    for (let p = 0; p < nPts; p++) {
      seen[p] = 0;
      const x = pts[4 * p], y = pts[4 * p + 1], z = pts[4 * p + 2];
      v.set(x, y, z); stage.localToWorld(v); v.project(camera);
      if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98 || v.z > 1) continue;
      toCam.set(camLocal.x - x, camLocal.y - y, camLocal.z - z).normalize();
      if (geo.hits(x, y, z, toCam)) continue;                                   // behind the tree, seen from the camera
      const px = Math.floor((v.x + 1) / 2 * W), py2 = Math.floor((1 - v.y) / 2 * H), i = (py2 * W + px) * 4;
      lum[p] = (0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]) / 255; seen[p] = 1;
      if (pts[4 * p + 3] < 2) nTable++;
    }
    if (nTable < 150) return best();
    detrend();
    let top = null;
    for (let j = 0; j < dirs.length; j++) {
      const m = masks[j];
      const table = contrast(m, -1, 25, 60);                        // all the table, gradient taken out
      const near = Math.max(nz(contrast(m, 0, 8, 15)), nz(contrast(m, 2, 8, 15)));   // next to the tree
      if (isNaN(table) || near === -Infinity) continue;
      const s = Math.min(table, near);
      score[j] = judged[j] ? score[j] + KEEP * (s - score[j]) : s; judged[j] = Math.min(judged[j] + 1, 60000);
      if (!top || s > top.contrast) top = { ...dirs[j], contrast: s };
    }
    last = top;
    return best();
  }
  const nz = c => isNaN(c) ? -Infinity : c;
  // the table's brightness minus a plane fitted to it (least squares in x, z), so a gradient across it isn't a shadow;
  // the plate's points are left as they are (their group is only ever compared with itself)
  function detrend() {
    let n = 0, sx = 0, sz = 0, sl = 0, sxx = 0, sxz = 0, szz = 0, sxl = 0, szl = 0;
    for (let p = 0; p < nPts; p++) if (seen[p] && pts[4 * p + 3] < 2) {
      const x = pts[4 * p], z = pts[4 * p + 2], l = lum[p];
      n++; sx += x; sz += z; sl += l; sxx += x * x; sxz += x * z; szz += z * z; sxl += x * l; szl += z * l;
    }
    const mx = sx / n, mz = sz / n, ml = sl / n;
    const cxx = sxx / n - mx * mx, cxz = sxz / n - mx * mz, czz = szz / n - mz * mz, cxl = sxl / n - mx * ml, czl = szl / n - mz * ml;
    const det = cxx * czz - cxz * cxz; if (Math.abs(det) < 1e-12) return;
    const a = (cxl * czz - czl * cxz) / det, b = (czl * cxx - cxl * cxz) / det;
    for (let p = 0; p < nPts; p++) if (seen[p] && pts[4 * p + 3] < 2) lum[p] -= a * (pts[4 * p] - mx) + b * (pts[4 * p + 2] - mz);
  }
  function best() {
    let j0 = -1;
    for (let j = 0; j < dirs.length; j++) if (judged[j] >= SETTLE && (j0 < 0 || score[j] > score[j0])) j0 = j;
    return j0 < 0 ? null : { ...dirs[j0], contrast: score[j0] };
  }
  return { estimate, get brightness() { return brightness; }, get last() { return last; }, count: dirs.length, points: nPts };
}
