// Training script for WebAR.rocks.train: detect and track the printed SakuraQR tree (tree.glb).
// Adapted from trainingScripts/Object3DLighter_0.js. Open it with
//   http://localhost:8000/trainer.html?code=SakuraTree_0.js
// See ar/train/README.md in mq-sakura-anim.

const settings = {
  debug: false, // true: one sample per step and every sample positive, to check the rendered images before training
  // your own photos of the places you will use the AR in (desk, shelf, table), without the tree in them,
  // converted to trainingData/images/sakuraBg/bg_<i>.png (power-of-two sizes). 0 if you have none yet.
  photosCount: 0
};
//settings.debug = true;


// THE TREE
// tree.glb is in metres: the plate's bottom at y = 0, centred on the origin, +Y up, 41 x 41 x 27 mm as printed (the
// 1.5 mm design squeezed: across x 0.8775, height x 0.8177; see printScale in its extras).
// isCenter moves its bounding box's centre, (0, 13.5 mm, 0), to the origin, so the tracked pose is that point:
// in the AR page, move the tree (and the animation's stage) down by half its height to sit on the detected plate.
// scale makes the tree about as large as the lighter of the example script (bounding sphere about 1.6 units: the tree's
// is 64 mm across, x 25), for
// which distance, FOV and lighting are tuned. Samples with part of the plate cut off are intended: the detection
// window is shifted and scaled at random (dxMax, dyMax, dsMax) and the network learns to correct it.

const objects = [
  {
    label: 'SAKURA',
    distance: 3,  // camera - tree distance for a 40° FoV (scaled with the random FoV). The tree must be fully visible
    trainingSets: [
      {
        meshes: ['trainingData/models3D/sakura/tree.glb'],
        envMapMats: 'ALL', // random environment reflections on every material
        // printed colours under any white balance, matte to glossy (full-colour resin; PLA, matte to silk, too): jitter
        // colour and sheen around the printed colours
        // (from each material's own colour, kept in userData, so the jitter does not add up over samples)
        materialsTweakers: {
          'blossom': (mat) => tweak_filament(mat, 0.04),
          'highlight': (mat) => tweak_filament(mat, 0.03),
          'wood': (mat) => tweak_filament(mat, 0.05)
        },
        scale: 25,
        thetaOffset: 0,
        thetaRange: [-180, 180], // any side of the tree
        probability: 1,
        isCenter: true
      }
    ]
  }
];

function tweak_filament(mat, hueJitter){
  if (!mat.userData.baseColor){
    mat.userData.baseColor = mat.color.clone();
  }
  const hsl = {h: 0, s: 0, l: 0};
  mat.userData.baseColor.getHSL(hsl);
  mat.color.setHSL(
    (hsl.h + (Math.random() * 2 - 1) * hueJitter + 1) % 1,
    Math.min(1, Math.max(0, hsl.s * (0.8 + 0.4 * Math.random()))),
    Math.min(1, Math.max(0, hsl.l * (0.85 + 0.3 * Math.random())))
  );
  mat.metalness = 0.1 * Math.random();
  mat.roughness = 0.35 + 0.65 * Math.random(); // silk PLA is shinier than matte PLA
  mat.envMapIntensity = 0.3 + 1.5 * Math.random();
}


// THE NEURAL NETWORK: as in the lighter script, so its trained weights can be loaded as a starting point (OPEN)

const layers = [];
const activationConv = 'arctan2';
const activation = 'gelu';

layers.push({
  preprocessing: 'inputMix0',
  varianceMin: 0.05,
  gain: 1.1,
  blurKernelSizePx: 7,
  sizeSqrt: 128 });

layers.push({sizeSqrt: 128, connectivityUp: 'conv', sparsitySqrt: 8,
  kernelsCountSqrt: 4, activation: activationConv});

layers.push({connectivityUp: 'conv',
  sizeSqrt: 32, sparsitySqrt: 16,
  kernelsCountSqrt: 4,
  maxPooling: null,
  activation: activation});

layers.push({sizeSqrt: 16,
  connectivityUp: 'full', shiftRGBAMode: 2, activation: activation});

layers.push({sizeSqrt: 16,
  connectivityUp: 'full', shiftRGBAMode: 2, activation: activation});

layers.push({sizeSqrt: 16,
  connectivityUp: 'full', shiftRGBAMode: 2, activation: activation});

layers.push({connectivityUp: 'full', clampOutput: "mask",
  sizeSqrt: ObjectDetectionTrainer.compute_outputSize(objects.length), activation: 'copy'});


const inputAspectRatio = 1;

// camera:
const rotZMax = 30;   // phone roll in degrees
const dxMax = 0.3;    // max translation along X, relative to the viewport width
const dyMax = 0.15;   // max translation along Y, relative to the viewport height
const dsMax = 0.3;    // max scale delta
// The tree stands on a table: the camera is anywhere from straight above (0°) to level with the plate (90°),
// never below it. 5°: straight above, yaw and roll are the same rotation.
const phiRange = [5, 85];

const net = new NeuronNetwork({
  exportData: {},
  layers: layers
});


// IMAGE PIPELINES

const backgroundSets = [
  {
    imagePath: 'trainingData/images/random/',
    imagePrefix: 'output_',
    count: 2,
    scaleRange: [0.03, 0.2],
    scalePow: 2,
    probability: (settings.photosCount) ? 0.4 : 1
  }
];
if (settings.photosCount){
  backgroundSets.push({
    imagePath: 'trainingData/images/sakuraBg/',
    imagePrefix: 'bg_',
    count: settings.photosCount,
    scaleRange: [0.3, 1], // photos: from the whole photo to a close-up of part of it
    scalePow: 1,
    probability: 0.6
  });
}

// before the tree is drawn: the background
const preprocessingPipeline = new ImageTransformPipeline([
  {
    passType: 'drawBackgroundImage',
    options: {imageSets: backgroundSets}
  },{
    passType: 'shiftLuminosity',
    options: {
      luminosityShiftRange: [0.5, 1.5]
    }
  }, {
    passType: 'distortElastic',
    probability: 0.4,
    options: {
      n: 4,
      radiusRange: [30, 100],
      displacement: 4
    }
  }, {
    passType: 'blur',
    probability: 0.5,
    options: {
      radiusRange: [1, 8]
    }
  },{
    passType: 'shiftGamma',
    options: {
      gammaShiftRange: [-0.4, 0.4]
    }
  },
  {
    passType: 'invertColors',
    probability: 0.3
  }]);

// after the tree is drawn: the phone camera's exposure, white balance and focus
const postprocessingPipeline = new ImageTransformPipeline([
  {
    passType: 'shiftGamma',
    options: {
      gammaShiftRange: [-0.4, 0.4]
    }
  },
  {
    passType: 'shiftLuminosity',
    options: {
      luminosityShiftRange: [0.5, 1.5]
    }
  },
  {
    passType: 'shiftHue',
    options: {
      angleMaxRad: 3.14/6.0
    }
  },
  {
    passType: 'blur',
    probability: 0.2,
    options: {
      radiusRange: [0.5, 3]
    }
  }]);

const randomTextures = [
  {image: 'trainingData/images/random/output_*.png', n: 2, scaleRange: [0.03, 0.3], scalePow: 2},
];

const problem = new Problem({
  provider: 'ObjectDetectionTrainer',
  preprocessing: preprocessingPipeline,
  postprocessing: postprocessingPipeline,
  options: {
    objects: objects,

    phiRange: phiRange,
    translationScalingFactors: [dxMax, dyMax, dsMax],
    translationScalingFactorsDistributions: ['uniform', 'uniform', 'uniform'],
    rotZ: {max: rotZMax, nSigmas: 4},

    width: 512,
    aspectRatio: inputAspectRatio,
    isSharedContext: true,
    FOV: [3, 10],

    pointLightNumberRange: [1, 2],
    ambientLightIntensityRange: [0.3, 2],
    updatePointLightsPeriod: (settings.debug) ? 10 : 100,
    pointLightMaxIntensity: 1,
    envMaps: true,
    noiseTextures: randomTextures,

    positiveProbability: (settings.debug) ? 1 : 0.7,
    detectedObjScoreMin: 0.5,

    splitYawComponents: true,
    outputYaw: true,
    outputPitch: true,
    outputRoll: true
  }
});


const trainer = new Trainer({
  network: net,
  problem: problem,

  testsCount: 5000,
  testMinibatchsInterval: 10000,
  cost: 'quadratic',

  SGDLearningRate: 0.05,
  SGDLearningRatePeriod: 1000000,
  SGDMomentum: 0.7,

  stopAfterMinibatchsCount: 0,
  minibatchSize: (settings.debug) ? 1 : 200,
  display: true,
  updateLiveDisplayMinibatchsInterval: (settings.debug) ? 1 : 100,
  delayBetweenMinibatchs: (settings.debug) ? 500 : 5,
  l2Decay: 0.0000002
});

trainer.start();
