// AR mode of the main page: the animation (scene.js) on the printed tree, through the phone's camera.
//  - WebAR.rocks.object finds the tree in every frame with the network trained on it (ar/nn/NN_SAKURA.json);
//    ar/pose.js turns that into the tree's pose in camera space; ar/refine.js then lines the code printed on the
//    plate up with the image (to about half a millimetre and a degree, where the network alone is good to 2 mm, 2°).
//  - The printed tree is the design (tree.glb) squeezed to 41 x 41 x 27 mm, so a copy of the design tree and its own
//    scene.js go in one group scaled like the print, centred on the tree's bounding box: nothing in scene.js changes.
//  - The design tree writes depth only, so the real tree hides what goes behind it; another copy of it and the table
//    take the animation's shadows (not the tree's own: the real tree has one).
//  - The light comes from where the real tree's shadow on the table says it does (ar/light.js); with no clear shadow
//    (soft light), the animation's shadows go faint. The image's brightness sets how bright the lights are.
// Loaded by index.html the first time the viewer switches to AR, with the WebAR.rocks runtime and the network.
import * as THREE from 'three';
import { treePose } from './pose.js';
import { createLightEstimator } from './light.js';
import { createRefiner } from './refine.js';

const PRINT = new THREE.Vector3(41 / 46.722, 27 / 33.02, 41 / 46.722);   // the print: across x 0.8775, height x 0.8177
// as the WebAR.rocks.train player template uses networks from the trainer
const NN_OPTIONS = { notHereFactor: 0.0, paramsPerLabel: { SAKURA: { thresholdDetect: 1.0 } } };
const DETECT = { isKeepTracking: true, isSkipConfirmation: false, thresholdDetectFactor: 1.2, thresholdDetectFactorUnstitch: 0.5, trackingFactors: [0.6, 0.6, 0.6] };
const SCAN = { nScaleLevels: 3, overlapFactors: [3, 3, 3], scale0Factor: 0.5 };
const HARD = 0.08;   // shadow score (ar/light.js) above which the light counts as hard

const loadScript = src => new Promise((ok, ko) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('无法加载 ' + src)); document.head.append(s);
});

// tree: a fresh copy of the design tree (not in any scene; its materials are replaced here); setup: scene.js's;
// video, nnCanvas, wrap: the page's elements; debug, fov (along the image's long side, degrees), refine: options;
// tip(text): shows a hint ('' hides it).
export async function createAR({ renderer, tree, info, setup, showLength, video, nnCanvas, wrap, debug = false, fov = 63, refine = true, tip }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.005, 5);   // at the origin, looking down -z: camera space is world space

  // anchor: the tree's bounding-box centre, posed every frame; stage: the design tree and the animation, scaled like the print
  const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor);
  const stage = new THREE.Group(); stage.name = 'stage-ar'; anchor.add(stage);
  stage.scale.copy(PRINT);

  const hemi = new THREE.HemisphereLight('#fff6f2', '#b9a8a4', 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(0.05, 0.11, 0.07).multiplyScalar(3);   // as in the 3D view, relative to the tree
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.11, right: 0.11, top: 0.11, bottom: -0.11, near: 0.05, far: 0.9 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.0002;
  anchor.add(sun, sun.target);

  stage.add(tree);
  const box = new THREE.Box3().setFromObject(tree);
  stage.position.set(0, -box.getCenter(new THREE.Vector3()).y * PRINT.y, 0);   // the anchor is the print's bounding-box centre
  stage.updateMatrixWorld(true);
  // what the tree looks like to the light estimator and the refiner: read off its own materials (which squares of the
  // plate's code are dark), so before they are replaced below
  const light = createLightEstimator({ tree, info, printScale: PRINT, stage });
  const refiner = refine ? createRefiner({ tree, info, stage }) : null;

  // the real tree hides what is behind it: the design tree writes depth only, before everything else
  const hideMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const debugMat = new THREE.MeshBasicMaterial({ color: '#40e0a0', transparent: true, opacity: 0.45, depthWrite: true });
  tree.traverse(o => { if (o.isMesh) { o.material = debug ? debugMat : hideMat; o.renderOrder = -1; o.castShadow = false; o.receiveShadow = false; } });
  const anim = await setup({ THREE, stage, tree, info, mode: 'ar', showLength });
  stage.traverse(o => { if (o.isMesh && !tree.getObjectById(o.id)) o.castShadow = true; });   // the animation casts shadows

  // shadows on the real tree and on the table (shadow-only materials, drawn just in front of the depth they match);
  // added after setup() so that scene.js only ever sees the one tree
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.28, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const treeShadow = tree.clone(); treeShadow.name = 'tree-shadow';
  treeShadow.traverse(o => { if (o.isMesh) { o.material = shadowMat; o.receiveShadow = true; o.castShadow = false; o.renderOrder = 0; } });
  const table = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), new THREE.ShadowMaterial({ opacity: 0.22 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.00005; table.receiveShadow = true;
  stage.add(treeShadow, table);

  // ---- layout: video and 3D layer share the video's shape, covering the screen (cropped like object-fit: cover) ---
  function layout() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const k = Math.max(innerWidth / vw, innerHeight / vh);
    Object.assign(wrap.style, { width: vw * k + 'px', height: vh * k + 'px' });
    renderer.setSize(vw * k, vh * k, false);
    camera.aspect = vw / vh;
    const tl = Math.tan(fov * Math.PI / 360);   // the field of view is given along the long side; three wants the vertical one
    camera.fov = 2 * Math.atan(vw >= vh ? tl / camera.aspect : tl) * 180 / Math.PI;
    camera.updateProjectionMatrix();
  }

  // ---- camera on and off; the runtime and the network load once, on the first start --------------------------------
  // The camera's resolution is asked for by its short side (720, 1080, 2160); the camera gives the nearest it has.
  // More pixels look sharper on a phone's screen (720p is enlarged about 2x there) and cost the runtime a bigger
  // texture to upload every frame; the network itself and the second pass work on fixed-size crops either way.
  let stream = null, ready = false, running = false, quality = 1080;
  const constraints = q => ({ facingMode: { ideal: 'environment' }, width: { ideal: Math.round(q * 16 / 9) }, height: { ideal: q } });
  async function open() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints(quality) });
    video.srcObject = stream;
    await video.play();
    await new Promise(ok => video.videoWidth ? ok() : video.addEventListener('loadedmetadata', ok, { once: true }));
    layout();
  }
  async function start(q) {
    if (q) quality = q;
    tip('正在打开相机…');
    await open();
    if (!ready) {
      tip('正在加载识别模型（第一次约 5 MB）…');
      if (!window.WEBARROCKSOBJECT) await loadScript('ar/lib/WebARRocksObject.js');
      await new Promise((ok, ko) => WEBARROCKSOBJECT.init({ canvas: nnCanvas, video, isDebugRender: debug,
        callbackReady: e => e ? ko(new Error(e)) : ok() }));
      await new Promise((ok, ko) => WEBARROCKSOBJECT.set_NN('ar/nn/NN_SAKURA.json', e => e ? ko(new Error(e)) : ok(), NN_OPTIONS));
      WEBARROCKSOBJECT.set_scanSettings(SCAN);
      ready = true;
    } else newSize();   // (the image may have another size than last time)
    running = true; found = false; seen = -1e9; anchor.visible = false;
    tip(LOOK);
  }
  // another resolution while running: ask the camera for it (or, if it won't change on the fly, open it again), then
  // let the runtime know the image's size changed. Resolves with the size the camera actually gives.
  async function setQuality(q) {
    quality = q;
    if (!running || !stream) return size();
    const track = stream.getVideoTracks()[0], before = size();
    let changed = false;
    running = false;   // no detection while the image changes under the runtime
    try {
      const resized = new Promise(ok => { video.addEventListener('resize', ok, { once: true }); setTimeout(ok, 1500); });
      await track.applyConstraints(constraints(q));
      await resized;
      changed = size() !== before || !!(track.getSettings && Math.min(track.getSettings().width || 0, track.getSettings().height || 0) === q);
    } catch (e) { /* not on the fly: open it again below */ }
    if (!changed) { stream.getTracks().forEach(t => t.stop()); await open(); }
    layout();
    newSize();
    WEBARROCKSOBJECT.reset_state();
    running = true; found = false; seen = -1e9; lastRefined = -1e9;
    return size();
  }
  const size = () => `${video.videoWidth}×${video.videoHeight}`;
  // the runtime reads the image's size in set_source, but only set_videoCrop updates what depends on it
  const newSize = () => { WEBARROCKSOBJECT.set_source(video); WEBARROCKSOBJECT.set_videoCrop(null); };
  function stop() {
    running = false;
    if (anim.setViewer) anim.setViewer(null);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.srcObject = null;
    anchor.visible = false;
    tip('');
  }

  // ---- every frame: find the tree, follow it smoothly, animate, draw -----------------------------------------------
  const LOOK = '把镜头对准樱花树，离它 15–25 厘米';
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), UP = new THREE.Vector3(), eyeAt = new THREE.Vector3();
  const refPos = new THREE.Vector3(), refQuat = new THREE.Quaternion();
  let lastRefined = -1e9, ref = null, refWhy = '', refHist = [];
  // the sun: towards the light the real shadow shows (tree space), held while the shadow is out of view;
  // hard while a shadow stands out, soft (faint shadows) when none does
  const sunDir = new THREE.Vector3(0.05, 0.11, 0.07).normalize();
  let lastLight = 0, est = null, softness = 0;
  function relight(e) {
    est = e;
    const k = THREE.MathUtils.clamp(light.brightness / 0.45, 0.6, 1.3);   // the scene's exposure
    const hard = !!(e && e.contrast > HARD);
    if (hard) sunDir.lerp(e.phys, 0.2).normalize();   // turns over a second or two
    softness += ((hard ? 0 : 1) - softness) * 0.3;
    sun.position.copy(sunDir).multiplyScalar(0.3);
    sun.intensity = 2.2 * k * (1 - 0.45 * softness);
    hemi.intensity = 1.6 * k * (1 + 0.35 * softness);
    shadowMat.opacity = 0.28 * (1 - 0.6 * softness);
    table.material.opacity = 0.22 * (1 - 0.6 * softness);
  }
  let seen = -1e9, found = false, fps = 0, hud = '';
  function frame(now, dt, elapsed, showTime) {
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    let d = null, have = false;
    if (running && video.readyState >= 2) {
      d = WEBARROCKSOBJECT.detect(0, null, DETECT);
      if (d.label) { treePose(d, camera.fov, camera.aspect, pos, quat); have = isFinite(pos.x + pos.y + pos.z + quat.x + quat.y + quat.z + quat.w); }
      // the second pass: start from the last refined pose while the network agrees with it (or briefly without the
      // network), else from the network's
      ref = null;
      if (refiner && (have || now - lastRefined < 1000)) {
        const fromLast = now - lastRefined < 250 && (!have || (refPos.distanceTo(pos) < 0.008 && refQuat.angleTo(quat) < 0.14));
        const r = refiner.refine(video, video.videoWidth, video.videoHeight, camera.fov, camera.aspect, fromLast ? refPos : pos, fromLast ? refQuat : quat);
        if (r.ok) { refPos.copy(r.pos); refQuat.copy(r.quat); lastRefined = now; pos.copy(r.pos); quat.copy(r.quat); have = true; ref = r; }
        else refWhy = r.used < 50 ? `${r.used} edges` : r.used >= 50 && r.moved < 0.008 && r.turned < 8 ? `rms ${r.rms.toFixed(1)} px` : `moved ${(r.moved * 1000).toFixed(1)} mm ${r.turned.toFixed(1)}°`;
        refHist.push(r.ok ? 1 : 0); if (refHist.length > 60) refHist.shift();
      }
    }
    if (have) {
      if (!found || now - seen > 600) { anchor.position.copy(pos); anchor.quaternion.copy(quat); }   // (re)found: jump there
      else {   // follow, smoothing out the jitter between frames (less when refined: it is precise)
        const k = 1 - Math.exp(-dt * (ref ? 30 : 14));
        anchor.position.lerp(pos, k); anchor.quaternion.slerp(quat, k);
      }
      seen = now; found = true;
    }
    const visible = running && now - seen < 700;   // keep it a moment through short dropouts
    if (visible !== anchor.visible) { anchor.visible = visible; if (running) tip(visible ? '' : LOOK); }
    // the sky stays above the tree: the hemisphere light points along the tree's up
    hemi.position.copy(UP.set(0, 1, 0).applyQuaternion(anchor.quaternion));
    if (visible && now - lastLight > 300) { lastLight = now; relight(light.estimate(video, camera)); }
    // where the phone is, for the show: the three stop to watch the whale on the phone's side of the tree, as the 3D
    // view's camera shot frames them (scene.js setViewer); held while the tree is out of sight
    if (have && anim.setViewer) { stage.updateMatrixWorld(true); anim.setViewer(stage.worldToLocal(eyeAt.set(0, 0, 0))); }
    anim.update(dt, elapsed, showTime);
    renderer.render(scene, camera);
    if (debug && d) hud = `fps ${fps.toFixed(0)}  ${d.label ? 'tree' : '—'}  score ${d.detectScore.toFixed(2)}  ` +
      (refiner ? `refined ${Math.round(100 * refHist.reduce((a, b) => a + b, 0) / Math.max(1, refHist.length))}% (${refiner.samples} samples): ` + (ref ? `${ref.used} edges, ${ref.rms.toFixed(2)} px` : `no (${refWhy})`) : 'refine off') + '\n' +
      `distance ${(-anchor.position.z * 100).toFixed(1)} cm  yaw ${(d.yaw * 57.3).toFixed(0)}°  pitch ${(d.pitch * 57.3).toFixed(0)}°  roll ${(d.roll * 57.3).toFixed(0)}°\n` +
      `video ${video.videoWidth}×${video.videoHeight}  fov ${camera.fov.toFixed(1)}° (vertical)\n` +
      `light ${est ? `az ${est.az}° el ${est.el}° contrast ${est.contrast.toFixed(2)}${est.contrast > HARD ? '' : ' (soft)'}` : '—'}  brightness ${light.brightness.toFixed(2)}`;
  }

  return { scene, camera, stage, anim, start, stop, setQuality, layout, frame, get quality() { return quality; }, get hud() { return hud; }, get tracking() { return anchor.visible; } };
}
