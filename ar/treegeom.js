// What the design tree looks like to the AR code: which heights of every grid cell are solid, whether a ray gets past
// the tree, and the coloured squares on top of the plate. Design coordinates (the stage's own): metres, the plate's
// bottom at y = 0, centred; cells as in info.grid. Built from the tree's horizontal faces (SakuraQR exports one quad,
// two triangles, per cube face, so each such face covers one cell).
import * as THREE from 'three';

export function treeGeometry(tree, info) {
  const N = info.grid.cols, cell = info.cell, x0 = info.grid.origin[0], z0 = info.grid.origin[1];
  const faces = Array.from({ length: N * N }, () => []);
  const plateTop = new Int8Array(N * N).fill(-1);   // colour of the plate's exposed top: 0 light, 1 dark, -1 none
  let plateY = 0;
  const toTree = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(tree.matrixWorld).invert();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  tree.traverse(o => {
    if (!o.isMesh) return;
    toTree.multiplyMatrices(inv, o.matrixWorld);
    const dark = /blossom/.test(o.material.name || ''), isPlate = /plate/.test(o.name) || /plate/.test(o.parent && o.parent.name || '');
    const p = o.geometry.getAttribute('position'), idx = o.geometry.index;
    const v = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
    for (let t = 0; t < (idx ? idx.count : p.count) / 3; t += 2) {
      a.fromBufferAttribute(p, v(t, 0)).applyMatrix4(toTree); b.fromBufferAttribute(p, v(t, 1)).applyMatrix4(toTree); c.fromBufferAttribute(p, v(t, 2)).applyMatrix4(toTree);
      n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
      if (Math.abs(n.y) < 0.9) continue;
      const y = (a.y + b.y + c.y) / 3;
      const i = Math.floor(((a.x + b.x + c.x) / 3 - x0) / cell), k = Math.floor(((a.z + b.z + c.z) / 3 - z0) / cell);
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      faces[k * N + i].push([y, n.y > 0 ? 1 : -1]);
      if (isPlate && n.y > 0) { plateTop[k * N + i] = dark ? 1 : 0; plateY = y; }
    }
  });
  const solid = faces.map(f => {   // [bottom, top, bottom, top, ...]
    f.sort((u, w) => u[0] - w[0]); const out = []; let depth = 0;
    for (const [y, s] of f) { if (s < 0) { if (depth++ === 0) out.push(y); } else if (depth > 0 && --depth === 0) out.push(y); }
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
  // from (x, y, z) along the unit direction d: does it run into the tree before rising above it (or leaving the grid)?
  const STEP = 0.0004, span = N * cell;
  const hits = (x, y, z, d) => {
    for (let t = STEP; t < 3 * span; t += STEP) {
      const yy = y + d.y * t; if (yy > top || yy < -0.001) return false;
      if (blocked(x + d.x * t, yy, z + d.z * t)) return true;
    }
    return false;
  };
  return { N, cell, x0, z0, top, plateTop, plateY, blocked, hits };
}
