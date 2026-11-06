// The printed tree's pose in camera space from a WebAR.rocks.object detection.
//
// WebAR.rocks.train drew its samples with a camera at (cos θ sin φ, cos φ, sin θ sin φ) looking at the tree's centre
// (its bounding box's centre: isCenter in the training script), then rolled about its own axis; the detection window
// spanned 2·3·tan 20° training units with the tree scaled 25×, i.e. WIN metres. The network gives back
// yaw = 90° − θ, pitch = φ and the roll (checked on rendered views of the printed tree, ar/README.md). Undo that:
// rebuild that camera, invert it, and look along the ray to the window's centre when it is off the image centre.
import * as THREE from 'three';

export const WIN = 2 * 3 * Math.tan(20 * Math.PI / 180) / 25;   // 0.087355 m

const cam = new THREE.Object3D(), look = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, -1);

// d: { positionScale: [x, y (from the bottom), sx, sy] of the video frame, yaw, pitch, roll } in radians;
// vfov: the camera's vertical field of view in degrees; aspect: video width / height.
// Writes the tree's centre into pos and its orientation into quat (both camera space: looking down -z, y up).
export function treePose(d, vfov, aspect, pos, quat) {
  const hv = Math.tan(vfov * Math.PI / 360), hh = hv * aspect;
  const D = WIN / (2 * d.positionScale[2] * hh);
  pos.set((2 * d.positionScale[0] - 1) * D * hh, (2 * d.positionScale[1] - 1) * D * hv, -D);
  const th = Math.PI / 2 - d.yaw, ph = d.pitch;
  cam.position.set(Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph));
  cam.up.set(0, 1, 0); cam.quaternion.identity(); cam.lookAt(0, 0, 0); cam.rotateZ(d.roll);
  look.setFromUnitVectors(FWD, pos.clone().normalize());
  return quat.copy(look).multiply(cam.quaternion.invert());
}
