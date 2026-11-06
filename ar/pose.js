// The printed tree's pose in camera space from a WebAR.rocks.object detection.
//
// WebAR.rocks.train drew its samples with a camera at (cos θ sin φ, cos φ, sin θ sin φ) looking at the tree's centre
// (its bounding box's centre: isCenter in the training script), then rolled about its own axis. Undo that: rebuild such
// a camera from the network's yaw, pitch and roll, invert it, and look along the ray to the window's centre when it is
// off the image centre. How yaw, pitch and roll map onto θ, φ and the roll, and how much of the tree the detection
// window spans (WIN), were fitted on rendered views of the printed tree with known poses (wide phone-like camera,
// 13-25 cm, 30-70° down, rolled up to 15°, off centre): 16 of 16 tracked, position within 1.9 mm (median, 4.8 max),
// orientation within 2.2° (median, 5.7 max). Of all the sign and origin conventions tried, the next best was 14°.
import * as THREE from 'three';

export const WIN = 0.0518;   // m: measured 50.3-53.0 mm over those views (the training geometry suggests 87 mm; it isn't)

const cam = new THREE.Object3D(), look = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, -1);

// d: { positionScale: [x, y (from the bottom), sx, sy] of the video frame, yaw, pitch, roll } in radians;
// vfov: the camera's vertical field of view in degrees; aspect: video width / height.
// Writes the tree's centre into pos and its orientation into quat (both camera space: looking down -z, y up).
export function treePose(d, vfov, aspect, pos, quat) {
  const hv = Math.tan(vfov * Math.PI / 360), hh = hv * aspect;
  const D = WIN / (2 * d.positionScale[2] * hh);
  pos.set((2 * d.positionScale[0] - 1) * D * hh, (2 * d.positionScale[1] - 1) * D * hv, -D);
  const th = d.yaw + Math.PI / 2, ph = Math.PI - d.pitch;   // fitted, see above
  cam.position.set(Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph));
  cam.up.set(0, 1, 0); cam.quaternion.identity(); cam.lookAt(0, 0, 0); cam.rotateZ(d.roll);
  look.setFromUnitVectors(FWD, pos.clone().normalize());
  return quat.copy(look).multiply(cam.quaternion.invert());
}
