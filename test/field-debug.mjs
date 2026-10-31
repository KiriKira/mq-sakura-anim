// Prints scene.js's collision grid and walking loop for tree.glb as text: node test/field-debug.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { _internals } from '../scene.js';
const buf = fs.readFileSync(new URL('../tree.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const tree = gltf.scene.getObjectByName('SakuraQR');
const info = tree.userData.sakuraqr;
const f = _internals.buildField(THREE, tree, info);
const pt = info.plate.top / info.cell;
// per cube: lowest solid above the plate (clearance), '.' = clear to the sky
let rows = [];
for (let r = 0; r < info.grid.rows; r++) {
  let line = '';
  for (let c = 0; c < info.grid.cols; c++) {
    const x = f.x0 + c + 0.5, z = f.z0 + r + 0.5;
    const runs = f.col(x, z);
    let s = '?';
    if (runs.length >= 2 && runs[0] < 0.01 && Math.abs(runs[1] - pt) < 0.01) s = runs.length > 2 ? Math.min(35, Math.floor(runs[2])).toString(36) : '.';
    else if (runs.length >= 2 && runs[0] < 0.01) s = '#';
    line += s;
  }
  rows.push(line);
}
console.log(rows.join('\n'));
const sp = _internals.spawnPoints(f, info, pt);
console.log('spawn top', sp.top.length / 3, 'under', sp.under.length / 3);
for (const R of [1.95]) {
  const p = _internals.buildPath(THREE, f, info, pt, R, 5.4);
  console.log('R', R, p ? 'length ' + p.length.toFixed(1) : 'no path');
}
