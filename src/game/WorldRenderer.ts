import * as THREE from 'three';
import {
  CURB_WIDTH,
  OPEN_WORLD_TERRAIN_FAR,
  OPEN_WORLD_TERRAIN_FLAT,
  ROAD_HALF_WIDTH,
  RoadFrame,
  SHOULDER_HALF_WIDTH,
  TRACK_LENGTH,
  getBiomeAt,
  getBoostPadInSlot,
  hash1,
  openWorldGroundY,
  roadFrameToLocalWorld,
  roadToLocalWorld,
  roadX,
  roadY,
  sampleRoadFrame,
  signedTrackDelta,
  worldAbsToLocal,
} from './RoadMath';
import { getPixelAtlas } from './PixelTextures';
import { getChinaAtlas } from './ChinaTextures';
import { CrossingAnimal } from './AnimalSystem';
import { BikeVisual } from './BikeModel';
import { ItemVisuals } from './ItemSystem';
import { OnFootState } from './OnFootController';
import { PlayerCharacterVisual } from './PlayerCharacterVisual';
import { BIKE_PALETTES, FallenCargo, RiderRenderState, TrafficCar } from './types';
import { VoxelWorld, VoxelWorldVisual } from './VoxelWorld';
import type { WeatherId, WeatherRenderSnapshot } from './WeatherSystem';

// Progressive road LOD slices: 12m rear (-144m..-36m) for 360° open-world turning, 3m near (-24m..+108m), 6m far (+114m..+324m)
const ROAD_SLICE_SNAP = 12.0;
const ROAD_SLICE_OFFSETS: Float32Array = (() => {
  const offs: number[] = [];
  for (let d = -144; d <= -36; d += 12) offs.push(d);
  for (let d = -24; d <= 108; d += 3) offs.push(d);
  for (let d = 114; d <= 324; d += 6) offs.push(d);
  return new Float32Array(offs);
})();
const ROAD_SLICES = ROAD_SLICE_OFFSETS.length; // 91 slices (full 360° open-world visibility!)
const MAX_PARTICLES = 120;
const MAX_PROPS_PER_POOL = 96;
const MAX_TRAFFIC_RENDER = 26;
const MAX_TRUCK_RENDER = 10;
const MAX_FALLEN_CARGO_RENDER = 20;
const MAX_ANIMAL_RENDER = 16;
const MAX_SIREN_RENDER = 12;
const MAX_POPUPS = 14;
const MAX_WEATHER_DROPS = 220;

interface QualityProfile {
  dprDesktop: number;
  dprMobile: number;
  roadSlices: number;
  propRange: number;
  maxFogFar: number;
  maxWeatherDrops: number;
  maxParticles: number;
}

const QUALITY_PROFILES: readonly QualityProfile[] = [
  // Tier 0: Low / power-saving mode for integrated GPUs & budget phones
  {
    dprDesktop: 0.78,
    dprMobile: 0.7,
    roadSlices: 72, // 216m ahead + 144m behind
    propRange: 196,
    maxFogFar: 210,
    maxWeatherDrops: 64,
    maxParticles: 48,
  },
  // Tier 1: Balanced mode for ordinary laptops & mid-range mobile devices
  {
    dprDesktop: 0.96,
    dprMobile: 0.85,
    roadSlices: 80, // 264m ahead + 144m behind
    propRange: 242,
    maxFogFar: 258,
    maxWeatherDrops: 120,
    maxParticles: 76,
  },
  // Tier 2: Crisp HD mode for fast machines
  {
    dprDesktop: 1.25,
    dprMobile: 1.0,
    roadSlices: ROAD_SLICES, // 324m ahead + 144m behind
    propRange: 285,
    maxFogFar: 345,
    maxWeatherDrops: MAX_WEATHER_DROPS,
    maxParticles: MAX_PARTICLES,
  },
];

const CARGO_DEBRIS_COLORS = [0x3b82f6, 0xc68642, 0x52b788, 0xe9c46a, 0xd62828, 0x8d99ae] as const;
const TRUCK_CARGO_TINTS = [0xffffff, 0xd8a47f, 0x80ed99] as const;
const GAS_STATION_STOPS = [420, 1620] as const;
const DINER_STOPS = [900, 2100] as const;

interface BoxPartSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  colorHex?: number;
}

function mergeBoxGeometries(parts: readonly BoxPartSpec[], withVertexColors = false): THREE.BufferGeometry {
  const boxVerts = 24;
  const boxIndices = 36;
  const totalVerts = parts.length * boxVerts;
  const totalIndices = parts.length * boxIndices;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = withVertexColors ? new Float32Array(totalVerts * 3) : null;
  const indices = new Uint16Array(totalIndices);
  const tmpColor = new THREE.Color();

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const g = new THREE.BoxGeometry(part.w, part.h, part.d);
    g.translate(part.x, part.y, part.z);

    const posArr = g.attributes.position.array as Float32Array;
    const normArr = g.attributes.normal.array as Float32Array;
    const uvArr = g.attributes.uv.array as Float32Array;
    const idxArr = g.index!.array;

    const vOff = p * boxVerts;
    positions.set(posArr, vOff * 3);
    normals.set(normArr, vOff * 3);
    uvs.set(uvArr, vOff * 2);

    if (colors) {
      tmpColor.setHex(part.colorHex ?? 0xffffff);
      for (let v = 0; v < boxVerts; v++) {
        const ci = (vOff + v) * 3;
        colors[ci] = tmpColor.r;
        colors[ci + 1] = tmpColor.g;
        colors[ci + 2] = tmpColor.b;
      }
    }

    const iOff = p * boxIndices;
    for (let k = 0; k < boxIndices; k++) {
      indices[iOff + k] = idxArr[k] + vOff;
    }

    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) {
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

export type CameraMode = 0 | 1 | 2; // 0: Arcade Chase, 1: Low Aggressive, 2: First-Person Hood

interface Particle {
  active: boolean;
  s: number;
  x: number;
  y: number;
  vs: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
}

interface HitPopup {
  sprite: THREE.Sprite;
  active: boolean;
  s: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

const CAR_COLORS = [
  0xe63946, 0x2a9d8f, 0xf4c44e, 0x3f84c7, 0xf78c4f, 0x8b5cf6, 0x46c97a, 0xe8edf2,
];

const BIOME_FOG = [
  new THREE.Color('#c8e4f5'), // 0 Coastal sky-horizon
  new THREE.Color('#b6dec9'), // 1 Pine highland
  new THREE.Color('#e8b288'), // 2 Red canyon
  new THREE.Color('#475285'), // 3 Twilight neon ridge
];

const BIOME_TERRAIN_TINT = [
  new THREE.Color('#84b565'), // sunlit coastal meadow
  new THREE.Color('#5a9e60'), // lush highland pine valley
  new THREE.Color('#d48455'), // warm terracotta canyon mesa
  new THREE.Color('#4b5d8a'), // cool indigo twilight ridge
];

interface WeatherDrop {
  rx: number;
  ry: number;
  rz: number;
  phase: number;
  speedMul: number;
}

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly fog: THREE.Fog;
  private readonly skyDome: THREE.Mesh;
  private readonly skyDomeMat: THREE.MeshBasicMaterial;
  private readonly skyDomeBlend: THREE.Mesh;
  private readonly skyDomeBlendMat: THREE.MeshBasicMaterial;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly headlightBeam: THREE.Mesh;
  private readonly headlightBeamMat: THREE.MeshBasicMaterial;
  private readonly weatherDropsInst: THREE.InstancedMesh;
  private readonly weatherDropsMat: THREE.MeshBasicMaterial;
  private readonly weatherDrops: WeatherDrop[] = [];
  private lastWeatherDropCount = 0;
  private lastSkyWeather: WeatherId = 'clear';
  private lastSkyPrev: WeatherId = 'clear';
  private lastWeatherLampBoost = false;

  // Dynamic sliding road geometries (updated in-place, 0 allocs/frame)
  private readonly roadGeo: THREE.BufferGeometry;
  private readonly roadMat: THREE.MeshLambertMaterial;
  private readonly curbLGeo: THREE.BufferGeometry;
  private readonly curbRGeo: THREE.BufferGeometry;
  private readonly terrainLGeo: THREE.BufferGeometry;
  private readonly terrainRGeo: THREE.BufferGeometry;
  private readonly hillLGeo: THREE.BufferGeometry;
  private readonly hillRGeo: THREE.BufferGeometry;
  private readonly terrainMat: THREE.MeshLambertMaterial;

  // Open-World Voxel Building + On-Foot 3D Character + Parked Bike Beacon
  private readonly voxelVisual: VoxelWorldVisual;
  private readonly charVisual: PlayerCharacterVisual;
  private readonly bikeBeaconMesh: THREE.Mesh;
  private freeCamYaw = 0;
  private freeCamYawInit = false;

  // Instanced roadside scenery pools
  private readonly trunkInst: THREE.InstancedMesh;
  private readonly pineInst: THREE.InstancedMesh;
  private readonly palmInst: THREE.InstancedMesh;
  private readonly rockInst: THREE.InstancedMesh;
  private readonly postInst: THREE.InstancedMesh;
  private readonly lampInst: THREE.InstancedMesh;
  private readonly boostInst: THREE.InstancedMesh;
  private readonly billboardBoards: THREE.Mesh[] = [];
  private readonly billboardPolesInst: THREE.InstancedMesh;
  private readonly lapArchGroup: THREE.Group;
  private readonly gasStationGroup: THREE.Group;
  private readonly dinerGroup: THREE.Group;

  // Particle pool
  private readonly particles: Particle[] = [];
  private readonly particleInst: THREE.InstancedMesh;
  private lastParticleCount = 0;

  // 3D comic hit popups
  private readonly popups: HitPopup[] = [];

  // Instanced traffic visuals (cuts up to 260 car draw calls down to 4-5!)
  private readonly carBodyInst: THREE.InstancedMesh;
  private readonly carCabinInst: THREE.InstancedMesh;
  private readonly carWheelsInst: THREE.InstancedMesh;
  private readonly carLightsInst: THREE.InstancedMesh;
  private readonly carSirenInst: THREE.InstancedMesh;
  private readonly carSirenMat: THREE.MeshBasicMaterial;
  private lastTrafficCount = 0;

  // Instanced Chinese overloaded cargo trucks (3 draw calls) + fallen cargo debris (1 draw call)
  private readonly truckCabInst: THREE.InstancedMesh;
  private readonly truckRearInst: THREE.InstancedMesh;
  private readonly truckCargoInst: THREE.InstancedMesh;
  private readonly fallenCargoInst: THREE.InstancedMesh;
  private lastTruckCount = 0;
  private lastFallenCargoCount = 0;

  // Instanced crossing animals (3 draw calls total for entire herd!)
  private readonly animalBodyInst: THREE.InstancedMesh;
  private readonly animalHeadInst: THREE.InstancedMesh;
  private readonly animalLegsInst: THREE.InstancedMesh;
  private lastAnimalCount = 0;

  // Instanced powerup & hazard visuals (0 draw calls when inactive!)
  private readonly crateInst: THREE.InstancedMesh;
  private readonly rocketInst: THREE.InstancedMesh;
  private readonly jetInst: THREE.InstancedMesh;
  private readonly bombInst: THREE.InstancedMesh;
  private readonly warningRingInst: THREE.InstancedMesh;
  private readonly interceptorInst: THREE.InstancedMesh;
  private readonly trapInst: THREE.InstancedMesh;
  private readonly bananaInst: THREE.InstancedMesh;
  private readonly sniperLaserLine: THREE.Line;
  private readonly sniperLaserPos: Float32Array;
  private readonly sniperLaserMat: THREE.LineBasicMaterial;
  private lastCrateCount = 0;
  private lastRocketCount = 0;
  private lastJetCount = 0;
  private lastBombCount = 0;
  private lastInterceptorCount = 0;
  private lastTrapCount = 0;
  private lastBananaCount = 0;

  // Rider visuals keyed by rider id (reusable Set for zero per-frame allocations)
  private readonly bikeMap = new Map<string, BikeVisual>();
  private readonly activeRiderIds = new Set<string>();

  // Camera, adaptive performance governor & presentation controls
  cameraMode: CameraMode = 0;
  pixelScale = 1; // 1 = HD crisp, 2 = chunky retro pixel grid
  private readonly isCoarsePointer: boolean;
  private readonly maxBootTier: 0 | 1 | 2;
  private qualityTier: 0 | 1 | 2;
  private effectiveDpr = 1;
  private govLastMs = 0;
  private govAccumMs = 0;
  private govFrames = 0;
  private govLowStreak = 0;
  private govHighStreak = 0;
  private lastRoadBuiltS = Number.NaN;
  private lastRoadSlicesBuilt = -1;
  private lastPropsBuiltS = Number.NaN;
  private lastPropsLampBoost = false;
  private lastPropsRange = -1;
  private lastCssW = 0;
  private lastCssH = 0;
  private lastDpr = 0;
  private lastPixelScale = 0;
  private shakeTime = 0;
  private shakeIntensity = 0;
  private currentFov = 70;
  private currentCamRoll = 0;
  private smoothFogColor = BIOME_FOG[0].clone();
  private smoothTerrainTint = BIOME_TERRAIN_TINT[0].clone();

  // Pre-allocated scratch math objects (ZERO GC per frame)
  private readonly _f: RoadFrame = {
    x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1,
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0,
    curvature: 0, tangentLen: 1, bank: 0,
  };
  private readonly _fCam: RoadFrame = {
    x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1,
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0,
    curvature: 0, tangentLen: 1, bank: 0,
  };
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _vR = new THREE.Vector3();
  private readonly _vU = new THREE.Vector3();
  private readonly _vB = new THREE.Vector3();
  private readonly _m4 = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _q2 = new THREE.Quaternion();
  private readonly _euler = new THREE.Euler();
  private readonly _scale = new THREE.Vector3();
  private readonly _dummy = new THREE.Object3D();
  private readonly _tmpColor = new THREE.Color();
  private readonly _targetFogColor = new THREE.Color();
  private readonly _targetTerrainColor = new THREE.Color();
  private readonly _flashColor = new THREE.Color('#eef6ff');

  constructor(canvas: HTMLCanvasElement) {
    this.isCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const mem =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
        : 8;
    // Ordinary/low-core laptops & mobile start at balanced tier 1; stronger machines start at tier 2
    const initialTier: 0 | 1 | 2 =
      cores <= 2 || mem <= 2 ? 0 : cores <= 4 || mem <= 4 || this.isCoarsePointer ? 1 : 2;
    this.maxBootTier = initialTier === 0 ? 1 : 2;
    this.qualityTier = initialTier;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false, // opaque backbuffer avoids full-screen compositor alpha blending!
      antialias: false, // crisp pixel-art edges + higher FPS!
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog('#9cd3f0', 112, QUALITY_PROFILES[this.qualityTier].maxFogFar);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 620);
    this.scene.add(this.camera);

    const atlas = getPixelAtlas();

    // Dual-layer pixel sky domes (lazy on-demand sky textures: only 1 allocated at boot!)
    const initialSky = atlas.getSky('clear');
    const skyGeo = new THREE.SphereGeometry(460, 20, 14);
    this.skyDomeMat = new THREE.MeshBasicMaterial({
      map: initialSky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, this.skyDomeMat);
    this.skyDome.rotation.y = Math.PI * 0.5;
    this.scene.add(this.skyDome);

    const skyBlendGeo = new THREE.SphereGeometry(452, 20, 14);
    this.skyDomeBlendMat = new THREE.MeshBasicMaterial({
      map: initialSky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.skyDomeBlend = new THREE.Mesh(skyBlendGeo, this.skyDomeBlendMat);
    this.skyDomeBlend.rotation.y = Math.PI * 0.5;
    this.skyDomeBlend.visible = false;
    this.scene.add(this.skyDomeBlend);

    // Crisp arcade lighting (smoothly modulated by WeatherSystem)
    this.hemiLight = new THREE.HemisphereLight('#b6e0ff', '#4a5b50', 1.24);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff1d4', 1.52);
    this.sunLight.position.set(18, 42, -90);
    this.scene.add(this.sunLight);

    // Sliding ribbon meshes (road, curbs, terrain shoulders)
    this.roadGeo = this.createRibbonGeometry(ROAD_SLICES);
    this.roadMat = new THREE.MeshLambertMaterial({ map: atlas.road, color: 0xffffff });
    const roadMesh = new THREE.Mesh(this.roadGeo, this.roadMat);
    roadMesh.frustumCulled = false;
    this.scene.add(roadMesh);

    // Local bike soft conical headlight beam for low-visibility weather (Storm, Fog, Snow, Sunset)
    const beamGeo = new THREE.PlaneGeometry(5.8, 26.0);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, -13.4);
    this.headlightBeamMat = new THREE.MeshBasicMaterial({
      map: atlas.headlightBeam,
      color: 0xfff5d4,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.headlightBeam = new THREE.Mesh(beamGeo, this.headlightBeamMat);
    this.headlightBeam.visible = false;
    this.scene.add(this.headlightBeam);

    // Instanced 3D weather precipitation pool (rain streaks / drifting snowflakes / fog wisps)
    const dropGeo = new THREE.BoxGeometry(1, 1, 1);
    this.weatherDropsMat = new THREE.MeshBasicMaterial({
      color: 0xcce8ff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.weatherDropsInst = new THREE.InstancedMesh(dropGeo, this.weatherDropsMat, MAX_WEATHER_DROPS);
    this.weatherDropsInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.weatherDropsInst.frustumCulled = false;
    this.weatherDropsInst.count = 0;
    this.scene.add(this.weatherDropsInst);
    for (let i = 0; i < MAX_WEATHER_DROPS; i++) {
      this.weatherDrops.push({
        rx: (Math.random() - 0.5) * 44,
        ry: Math.random() * 18,
        rz: -2 - Math.random() * 48,
        phase: Math.random() * Math.PI * 2,
        speedMul: 0.78 + Math.random() * 0.48,
      });
    }

    const curbMat = new THREE.MeshLambertMaterial({ map: atlas.curb });
    this.curbLGeo = this.createRibbonGeometry(ROAD_SLICES);
    const curbL = new THREE.Mesh(this.curbLGeo, curbMat);
    curbL.frustumCulled = false;
    this.scene.add(curbL);

    this.curbRGeo = this.createRibbonGeometry(ROAD_SLICES);
    const curbR = new THREE.Mesh(this.curbRGeo, curbMat);
    curbR.frustumCulled = false;
    this.scene.add(curbR);

    this.terrainMat = new THREE.MeshLambertMaterial({
      map: atlas.terrain,
      color: this.smoothTerrainTint,
    });
    this.terrainLGeo = this.createRibbonGeometry(ROAD_SLICES);
    const terrL = new THREE.Mesh(this.terrainLGeo, this.terrainMat);
    terrL.frustumCulled = false;
    this.scene.add(terrL);

    this.terrainRGeo = this.createRibbonGeometry(ROAD_SLICES);
    const terrR = new THREE.Mesh(this.terrainRGeo, this.terrainMat);
    terrR.frustumCulled = false;
    this.scene.add(terrR);

    // Outer distant scenic hills beyond the ±120m buildable open-world plains
    this.hillLGeo = this.createRibbonGeometry(ROAD_SLICES);
    const hillLMesh = new THREE.Mesh(this.hillLGeo, this.terrainMat);
    hillLMesh.frustumCulled = false;
    this.scene.add(hillLMesh);

    this.hillRGeo = this.createRibbonGeometry(ROAD_SLICES);
    const hillRMesh = new THREE.Mesh(this.hillRGeo, this.terrainMat);
    hillRMesh.frustumCulled = false;
    this.scene.add(hillRMesh);

    // Minecraft-style Voxel World renderer + On-Foot 3D Character + Parked Bike Beacon
    this.voxelVisual = new VoxelWorldVisual();
    this.scene.add(this.voxelVisual.group);

    this.charVisual = new PlayerCharacterVisual();
    this.charVisual.root.visible = false;
    this.scene.add(this.charVisual.root);
    this.camera.add(this.charVisual.fpHandGroup);

    const beaconGeo = new THREE.OctahedronGeometry(0.42, 0);
    this.bikeBeaconMesh = new THREE.Mesh(
      beaconGeo,
      new THREE.MeshBasicMaterial({ color: 0x00f5d4 })
    );
    this.bikeBeaconMesh.visible = false;
    this.scene.add(this.bikeBeaconMesh);

    // Instanced roadside props (single draw call per category!)
    const trunkGeo = new THREE.BoxGeometry(0.95, 5.2, 0.95);
    trunkGeo.translate(0, 2.6, 0);
    this.trunkInst = this.makeInstanced(trunkGeo, new THREE.MeshLambertMaterial({ map: atlas.bark, flatShading: true }), MAX_PROPS_PER_POOL);

    const pineGeo = new THREE.ConeGeometry(3.2, 7.6, 6);
    pineGeo.translate(0, 7.0, 0);
    this.pineInst = this.makeInstanced(pineGeo, new THREE.MeshLambertMaterial({ map: atlas.foliagePine, flatShading: true }), MAX_PROPS_PER_POOL);

    const palmGeo = new THREE.BoxGeometry(5.6, 1.4, 5.6);
    palmGeo.translate(0, 6.2, 0);
    this.palmInst = this.makeInstanced(palmGeo, new THREE.MeshLambertMaterial({ map: atlas.foliagePalm, flatShading: true }), MAX_PROPS_PER_POOL);

    const rockGeo = new THREE.BoxGeometry(6.8, 7.5, 6.4);
    rockGeo.translate(0, 3.4, 0);
    this.rockInst = this.makeInstanced(rockGeo, new THREE.MeshLambertMaterial({ map: atlas.canyonRock, flatShading: true }), MAX_PROPS_PER_POOL);

    const postGeo = new THREE.BoxGeometry(0.32, 1.25, 0.32);
    postGeo.translate(0, 0.62, 0);
    this.postInst = this.makeInstanced(postGeo, new THREE.MeshLambertMaterial({ color: 0xe9ecef, flatShading: true }), MAX_PROPS_PER_POOL * 2);

    const lampGeo = new THREE.BoxGeometry(0.38, 6.4, 0.38);
    lampGeo.translate(0, 3.2, 0);
    this.lampInst = this.makeInstanced(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffd166 }), MAX_PROPS_PER_POOL);

    const boostGeo = new THREE.PlaneGeometry(3.1, 7.2);
    boostGeo.rotateX(-Math.PI / 2);
    this.boostInst = this.makeInstanced(
      boostGeo,
      new THREE.MeshBasicMaterial({ map: atlas.boostPad, polygonOffset: true, polygonOffsetFactor: -2 }),
      20
    );

    // 8 pooled roadside billboards (poles batched in 1 InstancedMesh -> saves up to 7 draw calls!)
    const bbGeo = new THREE.PlaneGeometry(7.6, 3.8);
    bbGeo.translate(0, 5.4, 0);
    const polesGeo = mergeBoxGeometries([
      { w: 0.35, h: 6.0, d: 0.35, x: -2.6, y: 3.0, z: -0.1 },
      { w: 0.35, h: 6.0, d: 0.35, x: 2.6, y: 3.0, z: -0.1 },
    ]);
    this.billboardPolesInst = this.makeInstanced(
      polesGeo,
      new THREE.MeshLambertMaterial({ color: 0x3b4252, flatShading: true }),
      8
    );
    for (let i = 0; i < 8; i++) {
      const board = new THREE.Mesh(
        bbGeo,
        new THREE.MeshBasicMaterial({ map: atlas.billboards[i % atlas.billboards.length] })
      );
      board.visible = false;
      this.scene.add(board);
      this.billboardBoards.push(board);
    }

    // Checkered 3D Start/Finish Lap Arch placed at cyclic loop s = 0
    this.lapArchGroup = new THREE.Group();
    const archSpan = ROAD_HALF_WIDTH + 1.3;
    const archFrameGeo = mergeBoxGeometries(
      [
        { w: 0.9, h: 7.4, d: 0.9, x: -archSpan, y: 3.7, z: 0, colorHex: 0x24283b },
        { w: 0.9, h: 7.4, d: 0.9, x: archSpan, y: 3.7, z: 0, colorHex: 0x24283b },
        { w: 1.05, h: 0.55, d: 1.05, x: -archSpan, y: 7.6, z: 0, colorHex: 0x00f5d4 },
        { w: 1.05, h: 0.55, d: 1.05, x: archSpan, y: 7.6, z: 0, colorHex: 0x00f5d4 },
        { w: archSpan * 2 + 1.0, h: 0.35, d: 0.72, x: 0, y: 7.45, z: 0, colorHex: 0xffd166 },
      ],
      true
    );
    const archFrameMesh = new THREE.Mesh(
      archFrameGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    );
    this.lapArchGroup.add(archFrameMesh);

    const archBannerGeo = new THREE.PlaneGeometry(archSpan * 2 - 0.5, 2.15);
    const archBannerMat = new THREE.MeshBasicMaterial({
      map: atlas.lapArch,
      side: THREE.DoubleSide,
    });
    const archBanner = new THREE.Mesh(archBannerGeo, archBannerMat);
    archBanner.position.set(0, 6.25, 0);
    this.lapArchGroup.add(archBanner);
    this.lapArchGroup.visible = false;
    this.scene.add(this.lapArchGroup);

    const china = getChinaAtlas();

    // Chinese Roadside Gas Station ("中国加油") pooled voxel group (placed at s=420m & 1620m, x=+17.5m)
    this.gasStationGroup = this.buildGasStationGroup(china);
    this.gasStationGroup.visible = false;
    this.scene.add(this.gasStationGroup);

    // Chinese National Highway Restaurant ("国道饭店") pooled voxel group (placed at s=900m & 2100m, x=-17.5m)
    this.dinerGroup = this.buildDinerGroup(china);
    this.dinerGroup.visible = false;
    this.scene.add(this.dinerGroup);

    // Instanced traffic meshes (all cars rendered in 4-5 draw calls total)
    const carBodyGeo = new THREE.BoxGeometry(2.15, 0.85, 4.5);
    carBodyGeo.translate(0, 0.68, 0);
    this.carBodyInst = this.makeInstanced(
      carBodyGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      MAX_TRAFFIC_RENDER
    );
    this._tmpColor.setHex(0xffffff);
    this.carBodyInst.setColorAt(0, this._tmpColor);
    this.carBodyInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const carCabinGeo = new THREE.BoxGeometry(1.85, 0.68, 2.25);
    this.carCabinInst = this.makeInstanced(
      carCabinGeo,
      new THREE.MeshLambertMaterial({ map: atlas.carWindows, flatShading: true }),
      MAX_TRAFFIC_RENDER
    );

    const carWheelsGeo = mergeBoxGeometries([
      { w: 0.32, h: 0.56, d: 0.72, x: -1.02, y: 0.3, z: -1.35 },
      { w: 0.32, h: 0.56, d: 0.72, x: 1.02, y: 0.3, z: -1.35 },
      { w: 0.32, h: 0.56, d: 0.72, x: -1.02, y: 0.3, z: 1.35 },
      { w: 0.32, h: 0.56, d: 0.72, x: 1.02, y: 0.3, z: 1.35 },
    ]);
    this.carWheelsInst = this.makeInstanced(
      carWheelsGeo,
      new THREE.MeshLambertMaterial({ color: 0x161820, flatShading: true }),
      MAX_TRAFFIC_RENDER
    );

    const carLightsGeo = mergeBoxGeometries(
      [
        { w: 0.48, h: 0.22, d: 0.1, x: -0.72, y: 0.78, z: 2.26, colorHex: 0xff2a44 },
        { w: 0.48, h: 0.22, d: 0.1, x: 0.72, y: 0.78, z: 2.26, colorHex: 0xff2a44 },
        { w: 0.48, h: 0.22, d: 0.1, x: -0.72, y: 0.74, z: -2.26, colorHex: 0xfff3b0 },
        { w: 0.48, h: 0.22, d: 0.1, x: 0.72, y: 0.74, z: -2.26, colorHex: 0xfff3b0 },
      ],
      true
    );
    this.carLightsInst = this.makeInstanced(
      carLightsGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MAX_TRAFFIC_RENDER
    );

    const carSirenGeo = new THREE.BoxGeometry(0.55, 0.22, 0.28);
    this.carSirenMat = new THREE.MeshBasicMaterial({ color: 0xff1e42 });
    this.carSirenInst = this.makeInstanced(carSirenGeo, this.carSirenMat, MAX_SIREN_RENDER);

    // Chinese Overloaded Cargo Trucks (3 dedicated InstancedMeshes + 1 FallenCargo debris pool)
    const truckCabGeo = mergeBoxGeometries(
      [
        // Vivid Chinese freight blue flat-nose cab + glowing cyan windshield + headlights
        { w: 2.45, h: 2.1, d: 2.25, x: 0, y: 1.55, z: -3.25, colorHex: 0x0068b7 },
        { w: 2.15, h: 0.78, d: 0.14, x: 0, y: 1.98, z: -4.38, colorHex: 0x4cc9f0 },
        { w: 2.52, h: 0.48, d: 8.8, x: 0, y: 0.88, z: 0.0, colorHex: 0x2b2d42 },
        { w: 0.44, h: 0.24, d: 0.12, x: -0.82, y: 0.88, z: -4.42, colorHex: 0xfff3b0 },
        { w: 0.44, h: 0.24, d: 0.12, x: 0.82, y: 0.88, z: -4.42, colorHex: 0xfff3b0 },
        // 6 heavy truck tires
        { w: 0.42, h: 0.88, d: 0.92, x: -1.24, y: 0.44, z: -3.1, colorHex: 0x15171e },
        { w: 0.42, h: 0.88, d: 0.92, x: 1.24, y: 0.44, z: -3.1, colorHex: 0x15171e },
        { w: 0.42, h: 0.88, d: 0.92, x: -1.24, y: 0.44, z: 1.6, colorHex: 0x15171e },
        { w: 0.42, h: 0.88, d: 0.92, x: 1.24, y: 0.44, z: 1.6, colorHex: 0x15171e },
        { w: 0.42, h: 0.88, d: 0.92, x: -1.24, y: 0.44, z: 3.1, colorHex: 0x15171e },
        { w: 0.42, h: 0.88, d: 0.92, x: 1.24, y: 0.44, z: 3.1, colorHex: 0x15171e },
      ],
      true
    );
    this.truckCabInst = this.makeInstanced(
      truckCabGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      MAX_TRUCK_RENDER
    );

    const truckRearGeo = new THREE.BoxGeometry(2.5, 1.32, 0.22);
    truckRearGeo.translate(0, 1.5, 4.38);
    this.truckRearInst = this.makeInstanced(
      truckRearGeo,
      new THREE.MeshBasicMaterial({ map: china.truckRear }),
      MAX_TRUCK_RENDER
    );

    const truckCargoGeo = new THREE.BoxGeometry(2.62, 2.35, 6.25);
    truckCargoGeo.translate(0, 1.18, 0);
    this.truckCargoInst = this.makeInstanced(
      truckCargoGeo,
      new THREE.MeshLambertMaterial({ map: china.truckTarp, color: 0xffffff, flatShading: true }),
      MAX_TRUCK_RENDER
    );
    this._tmpColor.setHex(0xffffff);
    this.truckCargoInst.setColorAt(0, this._tmpColor);
    this.truckCargoInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const fallenCargoGeo = new THREE.BoxGeometry(0.88, 0.72, 0.88);
    this.fallenCargoInst = this.makeInstanced(
      fallenCargoGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      MAX_FALLEN_CARGO_RENDER
    );
    this.fallenCargoInst.setColorAt(0, this._tmpColor);
    this.fallenCargoInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    // Crossing animal herd InstancedMeshes (body, head, animated legs -> 3 draw calls total!)
    const animalBodyGeo = new THREE.BoxGeometry(1.0, 0.65, 0.6);
    this.animalBodyInst = this.makeInstanced(
      animalBodyGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      MAX_ANIMAL_RENDER
    );
    this.animalBodyInst.setColorAt(0, this._tmpColor);
    this.animalBodyInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const animalHeadGeo = new THREE.BoxGeometry(0.45, 0.42, 0.42);
    this.animalHeadInst = this.makeInstanced(
      animalHeadGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      MAX_ANIMAL_RENDER
    );
    this.animalHeadInst.setColorAt(0, this._tmpColor);
    this.animalHeadInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    const animalLegsGeo = mergeBoxGeometries([
      { w: 0.16, h: 0.5, d: 0.16, x: -0.32, y: 0.25, z: -0.18 },
      { w: 0.16, h: 0.5, d: 0.16, x: -0.32, y: 0.25, z: 0.18 },
      { w: 0.16, h: 0.5, d: 0.16, x: 0.32, y: 0.25, z: -0.18 },
      { w: 0.16, h: 0.5, d: 0.16, x: 0.32, y: 0.25, z: 0.18 },
    ]);
    this.animalLegsInst = this.makeInstanced(
      animalLegsGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      MAX_ANIMAL_RENDER
    );
    this.animalLegsInst.setColorAt(0, this._tmpColor);
    this.animalLegsInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    // Instanced powerup crates, projectiles, bomber jets, bombs, police interceptors & road hazards
    const crateGeo = new THREE.BoxGeometry(1.18, 1.18, 1.18);
    this.crateInst = this.makeInstanced(
      crateGeo,
      new THREE.MeshBasicMaterial({ map: atlas.crate }),
      16
    );

    const rocketGeo = mergeBoxGeometries(
      [
        { w: 0.24, h: 0.24, d: 1.05, x: 0, y: 0, z: 0, colorHex: 0xedf2f4 },
        { w: 0.3, h: 0.3, d: 0.38, x: 0, y: 0, z: -0.68, colorHex: 0xff2a54 },
        { w: 0.56, h: 0.08, d: 0.34, x: 0, y: 0, z: 0.42, colorHex: 0xffb703 },
        { w: 0.08, h: 0.56, d: 0.34, x: 0, y: 0, z: 0.42, colorHex: 0xffb703 },
      ],
      true
    );
    this.rocketInst = this.makeInstanced(
      rocketGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      8
    );

    const jetGeo = mergeBoxGeometries(
      [
        { w: 1.5, h: 0.85, d: 6.4, x: 0, y: 0, z: 0, colorHex: 0x3b4252 },
        { w: 8.6, h: 0.22, d: 2.2, x: 0, y: -0.05, z: 0.4, colorHex: 0x4c566a },
        { w: 1.2, h: 0.3, d: 1.4, x: -4.1, y: 0, z: 0.6, colorHex: 0xff0054 },
        { w: 1.2, h: 0.3, d: 1.4, x: 4.1, y: 0, z: 0.6, colorHex: 0xff0054 },
        { w: 0.26, h: 1.7, d: 1.5, x: 0, y: 0.9, z: 2.4, colorHex: 0xffd166 },
        { w: 0.9, h: 0.5, d: 1.6, x: 0, y: 0.55, z: -1.4, colorHex: 0x00f5d4 },
      ],
      true
    );
    this.jetInst = this.makeInstanced(
      jetGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      3
    );

    const bombGeo = mergeBoxGeometries(
      [
        { w: 0.42, h: 0.88, d: 0.42, x: 0, y: 0, z: 0, colorHex: 0x1b1d2e },
        { w: 0.62, h: 0.26, d: 0.14, x: 0, y: 0.48, z: 0, colorHex: 0xffd166 },
        { w: 0.14, h: 0.26, d: 0.62, x: 0, y: 0.48, z: 0, colorHex: 0xffd166 },
      ],
      true
    );
    this.bombInst = this.makeInstanced(
      bombGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      16
    );

    const ringGeo = new THREE.RingGeometry(2.05, 2.75, 16);
    ringGeo.rotateX(-Math.PI / 2);
    this.warningRingInst = this.makeInstanced(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff0054,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      16
    );

    const interceptorGeo = mergeBoxGeometries(
      [
        { w: 2.2, h: 0.86, d: 4.6, x: 0, y: 0.68, z: 0, colorHex: 0x111626 },
        { w: 2.24, h: 0.26, d: 2.2, x: 0, y: 0.72, z: 0, colorHex: 0xedf2f4 },
        { w: 1.85, h: 0.66, d: 2.2, x: 0, y: 1.38, z: 0.12, colorHex: 0x1e2c42 },
        { w: 0.6, h: 0.24, d: 0.3, x: -0.36, y: 1.82, z: 0.05, colorHex: 0xff1e42 },
        { w: 0.6, h: 0.24, d: 0.3, x: 0.36, y: 1.82, z: 0.05, colorHex: 0x00b4ff },
      ],
      true
    );
    this.interceptorInst = this.makeInstanced(
      interceptorGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      4
    );

    const trapGeo = mergeBoxGeometries(
      [
        { w: 2.7, h: 0.12, d: 0.46, x: 0, y: 0.07, z: 0, colorHex: 0x2b2d42 },
        { w: 0.18, h: 0.34, d: 0.18, x: -1.05, y: 0.24, z: 0, colorHex: 0xef233c },
        { w: 0.18, h: 0.34, d: 0.18, x: -0.52, y: 0.24, z: 0, colorHex: 0xd9e0e8 },
        { w: 0.18, h: 0.34, d: 0.18, x: 0.0, y: 0.24, z: 0, colorHex: 0xef233c },
        { w: 0.18, h: 0.34, d: 0.18, x: 0.52, y: 0.24, z: 0, colorHex: 0xd9e0e8 },
        { w: 0.18, h: 0.34, d: 0.18, x: 1.05, y: 0.24, z: 0, colorHex: 0xef233c },
      ],
      true
    );
    this.trapInst = this.makeInstanced(
      trapGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      16
    );

    const bananaGeo = mergeBoxGeometries(
      [
        { w: 0.95, h: 0.18, d: 0.32, x: 0, y: 0.12, z: 0, colorHex: 0xffe600 },
        { w: 0.32, h: 0.18, d: 0.95, x: 0, y: 0.12, z: 0, colorHex: 0xffd166 },
        { w: 0.32, h: 0.42, d: 0.32, x: 0, y: 0.32, z: 0, colorHex: 0xfff3b0 },
        { w: 0.16, h: 0.16, d: 0.16, x: 0, y: 0.56, z: 0, colorHex: 0x5c3d2e },
      ],
      true
    );
    this.bananaInst = this.makeInstanced(
      bananaGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      16
    );

    this.sniperLaserPos = new Float32Array(6);
    const laserGeo = new THREE.BufferGeometry();
    const laserAttr = new THREE.BufferAttribute(this.sniperLaserPos, 3);
    laserAttr.setUsage(THREE.DynamicDrawUsage);
    laserGeo.setAttribute('position', laserAttr);
    this.sniperLaserMat = new THREE.LineBasicMaterial({ color: 0xff0054 });
    this.sniperLaserLine = new THREE.Line(laserGeo, this.sniperLaserMat);
    this.sniperLaserLine.frustumCulled = false;
    this.sniperLaserLine.visible = false;
    this.scene.add(this.sniperLaserLine);

    // Pixel particle pool
    const pGeo = new THREE.BoxGeometry(1, 1, 1);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInst = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleInst.setColorAt(0, this._tmpColor);
    this.particleInst.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.particleInst.frustumCulled = false;
    this.particleInst.count = 0;
    this.scene.add(this.particleInst);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        s: 0, x: 0, y: 0,
        vs: 0, vx: 0, vy: 0,
        life: 0, maxLife: 0.4,
        size: 0.2,
        color: new THREE.Color(0xffffff),
        gravity: 9.8,
      });
    }

    // 3D pixel comic popups pool
    for (let i = 0; i < MAX_POPUPS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: atlas.hitWords.POW,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.popups.push({ sprite, active: false, s: 0, x: 0, y: 0, life: 0, maxLife: 0.65 });
    }

    this.applyRibbonDrawRange();
    this.resize();
  }

  private applyRibbonDrawRange(): void {
    const activeSlices = QUALITY_PROFILES[this.qualityTier].roadSlices;
    const indexCount = (activeSlices - 1) * 6;
    this.roadGeo.setDrawRange(0, indexCount);
    this.curbLGeo.setDrawRange(0, indexCount);
    this.curbRGeo.setDrawRange(0, indexCount);
    this.terrainLGeo.setDrawRange(0, indexCount);
    this.terrainRGeo.setDrawRange(0, indexCount);
    this.hillLGeo.setDrawRange(0, indexCount);
    this.hillRGeo.setDrawRange(0, indexCount);
  }

  private setQualityTier(next: 0 | 1 | 2): void {
    if (next === this.qualityTier) return;
    this.qualityTier = next;
    this.applyRibbonDrawRange();
    this.lastRoadSlicesBuilt = -1;
    this.lastPropsRange = -1;
    this.resize();
  }

  private updatePerfGovernor(): void {
    const now = performance.now();
    if (this.govLastMs === 0) {
      this.govLastMs = now;
      return;
    }
    const delta = now - this.govLastMs;
    this.govLastMs = now;
    if (delta <= 0 || delta > 250) return;

    this.govAccumMs += delta;
    this.govFrames++;
    if (this.govAccumMs < 1600) return;

    const avgFps = (this.govFrames * 1000) / this.govAccumMs;
    this.govAccumMs = 0;
    this.govFrames = 0;

    if (avgFps < 44) {
      this.govLowStreak++;
      this.govHighStreak = 0;
      if (this.govLowStreak >= 2 && this.qualityTier > 0) {
        this.govLowStreak = 0;
        this.setQualityTier((this.qualityTier - 1) as 0 | 1 | 2);
      }
    } else if (avgFps >= 55) {
      this.govHighStreak++;
      this.govLowStreak = 0;
      if (this.govHighStreak >= 3 && this.qualityTier < this.maxBootTier) {
        this.govHighStreak = 0;
        this.setQualityTier((this.qualityTier + 1) as 0 | 1 | 2);
      }
    } else {
      this.govLowStreak = 0;
      this.govHighStreak = 0;
    }
  }

  getPerfState(): { qualityTier: 0 | 1 | 2; effectiveDpr: number } {
    return {
      qualityTier: this.qualityTier,
      effectiveDpr: Number(this.effectiveDpr.toFixed(2)),
    };
  }

  private makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.count = 0;
    this.scene.add(inst);
    return inst;
  }

  private buildGasStationGroup(china: ReturnType<typeof getChinaAtlas>): THREE.Group {
    const g = new THREE.Group();
    const structGeo = mergeBoxGeometries(
      [
        // Iconic red cantilevered canopy roof
        { w: 10.6, h: 1.25, d: 15.0, x: 0, y: 5.55, z: 0, colorHex: 0xd62828 },
        { w: 10.8, h: 0.25, d: 15.2, x: 0, y: 4.92, z: 0, colorHex: 0xf8f9fa },
        // Warm glowing ceiling light strips
        { w: 6.4, h: 0.14, d: 11.0, x: -0.6, y: 4.84, z: 0, colorHex: 0xfff3b0 },
        // 4 crisp white steel support pillars
        { w: 0.55, h: 5.0, d: 0.55, x: -3.2, y: 2.5, z: -4.6, colorHex: 0xedf2f4 },
        { w: 0.55, h: 5.0, d: 0.55, x: 2.2, y: 2.5, z: -4.6, colorHex: 0xedf2f4 },
        { w: 0.55, h: 5.0, d: 0.55, x: -3.2, y: 2.5, z: 4.6, colorHex: 0xedf2f4 },
        { w: 0.55, h: 5.0, d: 0.55, x: 2.2, y: 2.5, z: 4.6, colorHex: 0xedf2f4 },
        // 2 red-white fuel dispenser islands
        { w: 1.15, h: 1.85, d: 2.2, x: -1.6, y: 0.92, z: -2.6, colorHex: 0xe63946 },
        { w: 1.18, h: 0.72, d: 1.9, x: -1.6, y: 1.48, z: -2.6, colorHex: 0xf8f9fa },
        { w: 1.15, h: 1.85, d: 2.2, x: -1.6, y: 0.92, z: 2.6, colorHex: 0xe63946 },
        { w: 1.18, h: 0.72, d: 1.9, x: -1.6, y: 1.48, z: 2.6, colorHex: 0xf8f9fa },
        // Concrete apron slab
        { w: 11.4, h: 0.14, d: 16.2, x: 0, y: 0.05, z: 0, colorHex: 0x6c757d },
      ],
      true
    );
    g.add(new THREE.Mesh(structGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

    // Road-facing & approach-facing "中国加油 92# 95#" signboards
    const signMat = new THREE.MeshBasicMaterial({ map: china.gasSign, side: THREE.DoubleSide });
    const frontSign = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 2.2), signMat);
    frontSign.position.set(0, 5.65, 7.62);
    g.add(frontSign);
    const sideSign = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 2.1), signMat);
    sideSign.position.set(-5.42, 5.65, 0);
    sideSign.rotation.y = -Math.PI / 2;
    g.add(sideSign);

    // 24H convenience store booth behind pumps
    const store = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 4.0, 11.2),
      new THREE.MeshLambertMaterial({ map: china.gasStore, flatShading: true })
    );
    store.position.set(5.4, 2.0, 0);
    g.add(store);

    return g;
  }

  private buildDinerGroup(china: ReturnType<typeof getChinaAtlas>): THREE.Group {
    const g = new THREE.Group();

    // White ceramic-tiled national highway restaurant building
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(8.0, 4.6, 13.6),
      new THREE.MeshLambertMaterial({ map: china.dinerFacade, flatShading: true })
    );
    building.position.set(-2.4, 2.3, 0);
    g.add(building);

    // Blue roadside awning, outdoor tables/stools, and roof frame
    const propsGeo = mergeBoxGeometries(
      [
        { w: 4.2, h: 0.34, d: 13.8, x: 3.4, y: 3.55, z: 0, colorHex: 0x1d4ed8 },
        { w: 0.25, h: 3.5, d: 0.25, x: 5.2, y: 1.75, z: -6.2, colorHex: 0x94a3b8 },
        { w: 0.25, h: 3.5, d: 0.25, x: 5.2, y: 1.75, z: 6.2, colorHex: 0x94a3b8 },
        // Roadside plastic dining tables & crimson stools
        { w: 1.4, h: 0.82, d: 1.4, x: 3.4, y: 0.42, z: -3.2, colorHex: 0xf8f9fa },
        { w: 0.45, h: 0.5, d: 0.45, x: 2.3, y: 0.25, z: -3.2, colorHex: 0xe63946 },
        { w: 0.45, h: 0.5, d: 0.45, x: 4.5, y: 0.25, z: -3.2, colorHex: 0xe63946 },
        { w: 1.4, h: 0.82, d: 1.4, x: 3.4, y: 0.42, z: 3.2, colorHex: 0xf8f9fa },
        { w: 0.45, h: 0.5, d: 0.45, x: 2.3, y: 0.25, z: 3.2, colorHex: 0xe63946 },
        { w: 0.45, h: 0.5, d: 0.45, x: 4.5, y: 0.25, z: 3.2, colorHex: 0xe63946 },
        // Concrete patio
        { w: 12.8, h: 0.14, d: 15.2, x: 0.4, y: 0.05, z: 0, colorHex: 0x7a7d85 },
      ],
      true
    );
    g.add(new THREE.Mesh(propsGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

    // Bold crimson/gold rooftop signboard ("国道饭店 · 司机之家")
    const signMat = new THREE.MeshBasicMaterial({ map: china.dinerSign, side: THREE.DoubleSide });
    const frontSign = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 2.7), signMat);
    frontSign.position.set(0.2, 6.0, 6.7);
    g.add(frontSign);
    const sideSign = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 2.7), signMat);
    sideSign.position.set(1.72, 6.0, 0);
    sideSign.rotation.y = Math.PI / 2;
    g.add(sideSign);

    // 4 glowing red pixel lanterns hanging under the blue awning
    const lanternGeo = mergeBoxGeometries([
      { w: 0.52, h: 0.68, d: 0.52, x: 5.0, y: 3.05, z: -4.8 },
      { w: 0.52, h: 0.68, d: 0.52, x: 5.0, y: 3.05, z: -1.6 },
      { w: 0.52, h: 0.68, d: 0.52, x: 5.0, y: 3.05, z: 1.6 },
      { w: 0.52, h: 0.68, d: 0.52, x: 5.0, y: 3.05, z: 4.8 },
    ]);
    g.add(new THREE.Mesh(lanternGeo, new THREE.MeshBasicMaterial({ map: china.lantern })));

    return g;
  }

  private createRibbonGeometry(slices: number): THREE.BufferGeometry {
    const vertCount = slices * 2;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint16Array((slices - 1) * 6);

    for (let i = 0; i < slices; i++) {
      normals[i * 6 + 1] = 1;
      normals[i * 6 + 4] = 1;
      uvs[i * 4] = 0;
      uvs[i * 4 + 2] = 1;
    }

    let idx = 0;
    for (let i = 0; i < slices - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[idx++] = a;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = d;
      indices[idx++] = c;
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const uvAttr = new THREE.BufferAttribute(uvs, 2);
    uvAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', uvAttr);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  private getTargetDpr(): number {
    const profile = QUALITY_PROFILES[this.qualityTier];
    const cap = this.isCoarsePointer ? profile.dprMobile : profile.dprDesktop;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  resize(): void {
    const dom = this.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || dom.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || dom.clientHeight || window.innerHeight));
    const dpr = this.getTargetDpr();
    const effectiveRatio = this.pixelScale === 1 ? dpr : Math.min(dpr, 1 / this.pixelScale);

    this.lastCssW = w;
    this.lastCssH = h;
    this.lastDpr = dpr;
    this.lastPixelScale = this.pixelScale;
    this.effectiveDpr = effectiveRatio;

    this.renderer.setPixelRatio(effectiveRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getViewportMetrics(): { cssW: number; cssH: number; bufW: number; bufH: number; camAspect: number; aspectDiff: number } {
    const dom = this.renderer.domElement;
    const cssW = Math.max(1, dom.clientWidth || this.lastCssW || window.innerWidth);
    const cssH = Math.max(1, dom.clientHeight || this.lastCssH || window.innerHeight);
    const bufW = dom.width;
    const bufH = dom.height;
    const camAspect = this.camera.aspect;
    const cssAspect = cssW / cssH;
    return {
      cssW,
      cssH,
      bufW,
      bufH,
      camAspect: Number(camAspect.toFixed(4)),
      aspectDiff: Number(Math.abs(cssAspect - camAspect).toFixed(6)),
    };
  }

  setPixelScale(scale: number): void {
    this.pixelScale = scale;
    this.resize();
  }

  triggerShake(intensity: number, duration = 0.24): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  spawnParticles(
    s: number,
    x: number,
    y: number,
    count: number,
    colorHex: number,
    speedSpread: number,
    size = 0.16,
    life = 0.42,
    gravity = 12,
    baseVs = 0
  ): void {
    const cap = QUALITY_PROFILES[this.qualityTier].maxParticles;
    const scaledCount = this.qualityTier === 2 ? count : Math.max(2, Math.ceil(count * (this.qualityTier === 1 ? 0.7 : 0.45)));
    let spawned = 0;
    for (let i = 0; i < cap && spawned < scaledCount; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.s = s + (Math.random() - 0.5) * 0.4;
        p.x = x + (Math.random() - 0.5) * 0.4;
        p.y = y + Math.random() * 0.35;
        p.vs = baseVs + (Math.random() - 0.5) * speedSpread;
        p.vx = (Math.random() - 0.5) * speedSpread;
        p.vy = Math.random() * speedSpread * 0.8 + 1.2;
        p.life = life * (0.65 + Math.random() * 0.55);
        p.maxLife = p.life;
        p.size = size * (0.7 + Math.random() * 0.7);
        p.color.setHex(colorHex);
        p.gravity = gravity;
        spawned++;
      }
    }
  }

  spawnHitPopup(kind: string, s: number, x: number, y: number): void {
    const atlas = getPixelAtlas();
    const tex = atlas.hitWords[kind] ?? atlas.hitWords.POW;
    for (const p of this.popups) {
      if (!p.active) {
        p.active = true;
        p.s = s;
        p.x = x;
        p.y = y;
        p.life = 0.72;
        p.maxLife = 0.72;
        (p.sprite.material as THREE.SpriteMaterial).map = tex;
        (p.sprite.material as THREE.SpriteMaterial).opacity = 1;
        p.sprite.scale.set(2.4, 1.2, 1);
        p.sprite.visible = true;
        return;
      }
    }
  }

  renderFrame(
    local: RiderRenderState,
    allRiders: RiderRenderState[],
    traffic: TrafficCar[],
    dt: number,
    timeSec: number,
    itemVisuals?: ItemVisuals,
    fallenCargo?: readonly FallenCargo[],
    animals?: readonly CrossingAnimal[],
    weather?: WeatherRenderSnapshot,
    voxels?: VoxelWorld,
    onFoot?: OnFootState
  ): void {
    // Adaptive performance governor (auto-tunes DPR, horizon & particle caps for smooth FPS on ordinary machines)
    this.updatePerfGovernor();

    // Self-healing zero-stretch guard: ensures camera.aspect & WebGL buffer ALWAYS match actual CSS canvas box
    const dom = this.renderer.domElement;
    const cw = dom.clientWidth;
    const ch = dom.clientHeight;
    const dpr = this.getTargetDpr();
    if (
      cw > 0 &&
      ch > 0 &&
      (cw !== this.lastCssW ||
        ch !== this.lastCssH ||
        dpr !== this.lastDpr ||
        this.pixelScale !== this.lastPixelScale)
    ) {
      this.resize();
    }

    const originS = onFoot?.active ? onFoot.ws : local.s;
    const originX = roadX(originS);
    const originY = roadY(originS);

    // Smooth biome + weather atmosphere blending
    const biome = getBiomeAt(originS);
    if (weather) {
      this.applyWeatherAtmosphere(biome, weather, dt);
    } else {
      this.smoothFogColor.lerp(BIOME_FOG[biome], Math.min(1, dt * 1.4));
      this.fog.color.copy(this.smoothFogColor);
      this.smoothTerrainTint.lerp(BIOME_TERRAIN_TINT[biome], Math.min(1, dt * 1.4));
      this.terrainMat.color.copy(this.smoothTerrainTint);
    }

    // 1. Update sliding road & open-world terrain ribbons
    this.updateRoadRibbons(originS, originX, originY);

    // 2. Update deterministic instanced roadside props + boost pads + Chinese landmarks
    this.updateProps(originS, originX, originY, timeSec);
    this.updateRoadsideLandmarks(originS, originX, originY);

    // 2b. Update Minecraft-style voxel world blocks & aim highlight
    if (voxels) {
      this.voxelVisual.update(
        voxels,
        originS,
        originX,
        originY,
        onFoot?.aimHit ?? null,
        onFoot?.selectedBlock ?? 3,
        Boolean(onFoot?.active)
      );
    }

    // 3. Update traffic car meshes (sedans/police + Chinese overloaded cargo trucks)
    this.updateTrafficVisuals(traffic, originS, originX, originY, timeSec);

    // 4. Update instanced powerups, fallen truck cargo & crossing animals
    if (itemVisuals) {
      this.updateItemVisuals(itemVisuals, originS, originX, originY, timeSec);
    }
    if (fallenCargo) {
      this.updateFallenCargoVisuals(fallenCargo, originS, originX, originY, timeSec);
    }
    if (animals) {
      this.updateAnimalVisuals(animals, originS, originX, originY);
    }

    // 5. Sync & update all motorcycle visuals (local + remote players + bots + delivery riders)
    this.updateRiders(allRiders, originS, originX, originY, timeSec);

    // 5b. Sync on-foot 3D character visual & parked bike beacon
    if (onFoot?.active) {
      this.charVisual.setAvatar(local.avatarIdx);
      this.charVisual.setHeldBlock(onFoot.selectedBlock);
      this.charVisual.updateAnimation(
        onFoot.walkPhase,
        onFoot.moveSpeed,
        onFoot.swingTimer,
        timeSec,
        onFoot.firstPerson
      );
      if (onFoot.firstPerson) {
        this.charVisual.root.visible = false;
      } else {
        this.charVisual.root.visible = true;
        worldAbsToLocal(onFoot.wx, onFoot.wy, onFoot.ws, originS, originX, originY, this._v1);
        this.charVisual.root.position.copy(this._v1);
        this.charVisual.root.rotation.set(0, onFoot.yaw, 0);
      }

      if (onFoot.distToBike > 5.0) {
        this.bikeBeaconMesh.visible = true;
        const bobY = 2.6 + Math.sin(timeSec * 4.5) * 0.3;
        worldAbsToLocal(
          onFoot.parkedBike.wx,
          onFoot.parkedBike.wy + bobY,
          onFoot.parkedBike.ws,
          originS,
          originX,
          originY,
          this._v1
        );
        this.bikeBeaconMesh.position.copy(this._v1);
        this.bikeBeaconMesh.rotation.y = timeSec * 2.5;
      } else {
        this.bikeBeaconMesh.visible = false;
      }
    } else {
      this.charVisual.root.visible = false;
      this.charVisual.fpHandGroup.visible = false;
      this.bikeBeaconMesh.visible = false;
    }

    // 6. Update particles & 3D hit popups
    this.updateParticles(dt, originS, originX, originY);
    this.updatePopups(dt, originS, originX, originY);

    // 7. Update arcade / open-world / on-foot camera
    this.updateCamera(local, originS, originX, originY, dt, onFoot);

    // 8. Update local bike headlight beam & 3D weather precipitation
    if (weather) {
      this.updateHeadlightBeam(local, originS, originX, originY, weather);
      this.updateWeatherPrecipitation(weather, onFoot?.active ? onFoot.moveSpeed : local.speed, dt, timeSec);
    }

    // Keep sky domes centered on camera
    this.skyDome.position.copy(this.camera.position);
    if (this.skyDomeBlend.visible) {
      this.skyDomeBlend.position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private applyWeatherAtmosphere(biome: number, w: WeatherRenderSnapshot, dt: number): void {
    const atlas = getPixelAtlas();
    const rate = Math.min(1, dt * 2.2);

    // Crossfade sky dome textures cleanly with 0 extra draw calls when steady (lazy sky allocation!)
    if (w.transition < 0.999) {
      if (this.lastSkyPrev !== w.prev || this.lastSkyWeather !== w.current) {
        this.lastSkyPrev = w.prev;
        this.lastSkyWeather = w.current;
        this.skyDomeMat.map = atlas.getSky(w.prev);
        this.skyDomeMat.needsUpdate = true;
        this.skyDomeBlendMat.map = atlas.getSky(w.current);
        this.skyDomeBlendMat.needsUpdate = true;
      }
      this.skyDomeBlend.visible = true;
      this.skyDomeBlendMat.opacity = w.transition;
    } else {
      const targetSky = atlas.getSky(w.current);
      if (this.lastSkyWeather !== w.current || this.skyDomeMat.map !== targetSky) {
        this.lastSkyWeather = w.current;
        this.lastSkyPrev = w.current;
        this.skyDomeMat.map = targetSky;
        this.skyDomeMat.needsUpdate = true;
      }
      if (this.skyDomeBlend.visible) {
        this.skyDomeBlend.visible = false;
      }
    }

    // Lightning flash briefly brightens sky dome & lighting in storm
    const flash = w.lightningFlash;
    if (flash > 0.01) {
      this._tmpColor.setRGB(1 + flash * 0.85, 1 + flash * 0.92, 1 + flash * 1.15);
      this.skyDomeMat.color.copy(this._tmpColor);
    } else {
      this.skyDomeMat.color.setHex(0xffffff);
    }

    // Fog color & visibility depth (smoothly capped to match active quality tier horizon)
    const tierFogMax = QUALITY_PROFILES[this.qualityTier].maxFogFar;
    this._targetFogColor.copy(w.fogColor).lerp(BIOME_FOG[biome], w.fogBlendBiome);
    if (flash > 0.01) {
      this._targetFogColor.lerp(this._flashColor, flash * 0.55);
    }
    this.smoothFogColor.lerp(this._targetFogColor, rate);
    this.fog.color.copy(this.smoothFogColor);
    this.fog.near = Math.min(w.fogNear, tierFogMax * 0.42);
    this.fog.far = Math.min(w.fogFar, tierFogMax);

    // Terrain & wet/frosted road color grading
    this._targetTerrainColor.copy(BIOME_TERRAIN_TINT[biome]).lerp(w.terrainTint, w.terrainBlend);
    this.smoothTerrainTint.lerp(this._targetTerrainColor, rate);
    this.terrainMat.color.copy(this.smoothTerrainTint);
    this.roadMat.color.copy(w.roadTint);

    // Directional sunlight + hemisphere ambient lighting
    this.sunLight.color.copy(w.sunColor);
    this.sunLight.intensity = w.sunIntensity + flash * 1.75;
    this.hemiLight.color.copy(w.hemiSky);
    this.hemiLight.groundColor.copy(w.hemiGround);
    this.hemiLight.intensity = w.hemiIntensity + flash * 0.95;

    this.lastWeatherLampBoost = w.lampBoost;
  }

  private updateHeadlightBeam(
    local: RiderRenderState,
    originS: number,
    originX: number,
    originY: number,
    w: WeatherRenderSnapshot
  ): void {
    const op = local.crashed || local.onFoot ? 0 : w.headlightOpacity * 0.62;
    if (op <= 0.015) {
      if (this.headlightBeam.visible) {
        this.headlightBeam.visible = false;
      }
      return;
    }
    this.headlightBeam.visible = true;
    this.headlightBeamMat.opacity = op;
    if (local.freeRoam && local.worldX !== undefined && local.worldY !== undefined && local.worldS !== undefined) {
      worldAbsToLocal(local.worldX, local.worldY + 0.14, local.worldS, originS, originX, originY, this._v1);
      this.headlightBeam.position.copy(this._v1);
      this._euler.set(0, local.heading ?? 0, 0);
      this.headlightBeam.quaternion.setFromEuler(this._euler);
      return;
    }
    sampleRoadFrame(local.s, this._f);
    roadFrameToLocalWorld(this._f, local.s, local.x, 0.14 + local.y * 0.25, originS, originX, originY, this._v1);
    this.headlightBeam.position.copy(this._v1);
    this.setRoadBasisQuaternion(this._f, this.headlightBeam.quaternion);
  }

  private updateWeatherPrecipitation(
    w: WeatherRenderSnapshot,
    playerSpeed: number,
    dt: number,
    timeSec: number
  ): void {
    const rain = w.rainIntensity;
    const snow = w.snowIntensity;
    const fogWisp = w.fogWispIntensity;

    const mode =
      rain >= snow && rain >= fogWisp && rain > 0.04
        ? 1
        : snow >= fogWisp && snow > 0.04
          ? 2
          : fogWisp > 0.04
            ? 3
            : 0;

    if (mode === 0) {
      if (this.lastWeatherDropCount > 0) {
        this.weatherDropsInst.count = 0;
        this.lastWeatherDropCount = 0;
      }
      return;
    }

    const maxDrops = QUALITY_PROFILES[this.qualityTier].maxWeatherDrops;
    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const d = this._dummy;
    const windTilt = w.windX * 0.045;
    let count = 0;

    if (mode === 1) {
      // Heavy slanted 3D rain streaks rushing past camera
      count = Math.max(12, Math.floor(maxDrops * rain));
      this.weatherDropsMat.color.setHex(0xc8e8ff);
      this.weatherDropsMat.opacity = 0.68 * rain;
      const fallVy = 34.0;
      const streakZ = Math.max(16, playerSpeed * 0.72 + 12);
      const streakTiltX = 0.28 + Math.min(0.45, playerSpeed * 0.008);

      for (let i = 0; i < count; i++) {
        const drop = this.weatherDrops[i];
        drop.ry -= fallVy * drop.speedMul * dt;
        drop.rx += w.windX * 1.4 * dt;
        drop.rz += streakZ * drop.speedMul * dt;

        if (drop.ry < -1.5) drop.ry += 19.5;
        if (drop.rz > 2.5) drop.rz -= 50;
        if (drop.rx < -22) drop.rx += 44;
        else if (drop.rx > 22) drop.rx -= 44;

        d.position.set(camX + drop.rx, camY + drop.ry - 3.5, camZ + drop.rz);
        d.rotation.set(streakTiltX, 0, -windTilt);
        d.scale.set(0.052, 1.8, 0.052);
        d.updateMatrix();
        this.weatherDropsInst.setMatrixAt(i, d.matrix);
      }
    } else if (mode === 2) {
      // Crisp drifting pixel snowflakes
      count = Math.max(12, Math.floor(Math.min(180, maxDrops) * snow));
      this.weatherDropsMat.color.setHex(0xf4f9ff);
      this.weatherDropsMat.opacity = 0.85 * snow;
      const forwardZ = Math.max(10, playerSpeed * 0.45 + 6);

      for (let i = 0; i < count; i++) {
        const drop = this.weatherDrops[i];
        drop.ry -= (4.8 + drop.speedMul * 2.4) * dt;
        drop.rx += (w.windX * 1.1 + Math.sin(timeSec * 2.4 + drop.phase) * 2.2) * dt;
        drop.rz += forwardZ * drop.speedMul * dt;

        if (drop.ry < -1.5) drop.ry += 18.5;
        if (drop.rz > 2.5) drop.rz -= 48;
        if (drop.rx < -22) drop.rx += 44;
        else if (drop.rx > 22) drop.rx -= 44;

        const sz = 0.14 + (i % 3) * 0.04;
        d.position.set(camX + drop.rx, camY + drop.ry - 3.0, camZ + drop.rz);
        d.rotation.set(timeSec * 1.5 + drop.phase, timeSec * 1.1 + drop.phase, 0);
        d.scale.set(sz, sz, sz);
        d.updateMatrix();
        this.weatherDropsInst.setMatrixAt(i, d.matrix);
      }
    } else {
      // Low rolling mist puffs drifting across shoulders in fog
      count = Math.max(8, Math.floor(38 * fogWisp));
      this.weatherDropsMat.color.setHex(0xd9e6f0);
      this.weatherDropsMat.opacity = 0.14 * fogWisp;
      const forwardZ = Math.max(8, playerSpeed * 0.36 + 4);

      for (let i = 0; i < count; i++) {
        const drop = this.weatherDrops[i];
        drop.rx += Math.sin(timeSec * 0.6 + drop.phase) * 1.4 * dt;
        drop.rz += forwardZ * drop.speedMul * dt;

        if (drop.rz > 2.0) {
          drop.rz -= 58;
          drop.rx = (Math.random() - 0.5) * 34;
        }
        if (drop.rx < -20) drop.rx += 40;
        else if (drop.rx > 20) drop.rx -= 40;

        d.position.set(camX + drop.rx, camY - 1.1 + (i % 4) * 0.65, camZ + drop.rz - 6);
        d.rotation.set(0, 0, 0);
        d.scale.set(5.2, 1.35, 2.4);
        d.updateMatrix();
        this.weatherDropsInst.setMatrixAt(i, d.matrix);
      }
    }

    this.weatherDropsInst.count = count;
    this.weatherDropsInst.instanceMatrix.needsUpdate = true;
    this.lastWeatherDropCount = count;
  }

  private updateRoadRibbons(originS: number, originX: number, originY: number): void {
    const activeSlices = QUALITY_PROFILES[this.qualityTier].roadSlices;
    if (
      Math.abs(originS - this.lastRoadBuiltS) < 0.015 &&
      this.lastRoadSlicesBuilt === activeSlices
    ) {
      return;
    }
    this.lastRoadBuiltS = originS;
    this.lastRoadSlicesBuilt = activeSlices;

    const baseS = Math.floor(originS / ROAD_SLICE_SNAP) * ROAD_SLICE_SNAP;
    const uvBaseRoad = Math.floor(originS / 12.0) * 12.0;
    const uvBaseCurb = Math.floor(originS / 4.0) * 4.0;

    const rPos = this.roadGeo.attributes.position as THREE.BufferAttribute;
    const rUv = this.roadGeo.attributes.uv as THREE.BufferAttribute;
    const clPos = this.curbLGeo.attributes.position as THREE.BufferAttribute;
    const clUv = this.curbLGeo.attributes.uv as THREE.BufferAttribute;
    const crPos = this.curbRGeo.attributes.position as THREE.BufferAttribute;
    const crUv = this.curbRGeo.attributes.uv as THREE.BufferAttribute;
    const tlPos = this.terrainLGeo.attributes.position as THREE.BufferAttribute;
    const tlUv = this.terrainLGeo.attributes.uv as THREE.BufferAttribute;
    const trPos = this.terrainRGeo.attributes.position as THREE.BufferAttribute;
    const trUv = this.terrainRGeo.attributes.uv as THREE.BufferAttribute;
    const hlPos = this.hillLGeo.attributes.position as THREE.BufferAttribute;
    const hlUv = this.hillLGeo.attributes.uv as THREE.BufferAttribute;
    const hrPos = this.hillRGeo.attributes.position as THREE.BufferAttribute;
    const hrUv = this.hillRGeo.attributes.uv as THREE.BufferAttribute;

    const rArr = rPos.array as Float32Array;
    const rUvArr = rUv.array as Float32Array;
    const clArr = clPos.array as Float32Array;
    const clUvArr = clUv.array as Float32Array;
    const crArr = crPos.array as Float32Array;
    const crUvArr = crUv.array as Float32Array;
    const tlArr = tlPos.array as Float32Array;
    const tlUvArr = tlUv.array as Float32Array;
    const trArr = trPos.array as Float32Array;
    const trUvArr = trUv.array as Float32Array;
    const hlArr = hlPos.array as Float32Array;
    const hlUvArr = hlUv.array as Float32Array;
    const hrArr = hrPos.array as Float32Array;
    const hrUvArr = hrUv.array as Float32Array;

    const f = this._f;
    const curbOuter = ROAD_HALF_WIDTH + CURB_WIDTH;
    const flatFar = OPEN_WORLD_TERRAIN_FLAT;
    const hillFar = OPEN_WORLD_TERRAIN_FAR;

    for (let i = 0; i < activeSlices; i++) {
      const s = baseS + ROAD_SLICE_OFFSETS[i];
      sampleRoadFrame(s, f);
      const cx = f.x - originX;
      const cy = f.y - originY;
      const cz = -(s - originS);

      const vi = i * 6;
      const ui = i * 4;
      const vRoad = (s - uvBaseRoad) / 12.0;
      const vCurb = (s - uvBaseCurb) / 4.0;
      const vTerr = (s - uvBaseRoad) / 10.0;

      // Asphalt surface: [-ROAD_HALF_WIDTH, +ROAD_HALF_WIDTH]
      rArr[vi] = cx - f.rx * ROAD_HALF_WIDTH;
      rArr[vi + 1] = cy - f.ry * ROAD_HALF_WIDTH;
      rArr[vi + 2] = cz - f.rz * ROAD_HALF_WIDTH;
      rArr[vi + 3] = cx + f.rx * ROAD_HALF_WIDTH;
      rArr[vi + 4] = cy + f.ry * ROAD_HALF_WIDTH;
      rArr[vi + 5] = cz + f.rz * ROAD_HALF_WIDTH;
      rUvArr[ui + 1] = vRoad;
      rUvArr[ui + 3] = vRoad;

      // Left curb
      clArr[vi] = cx - f.rx * curbOuter;
      clArr[vi + 1] = cy - f.ry * curbOuter + 0.04;
      clArr[vi + 2] = cz - f.rz * curbOuter;
      clArr[vi + 3] = cx - f.rx * ROAD_HALF_WIDTH;
      clArr[vi + 4] = cy - f.ry * ROAD_HALF_WIDTH + 0.02;
      clArr[vi + 5] = cz - f.rz * ROAD_HALF_WIDTH;
      clUvArr[ui + 1] = vCurb;
      clUvArr[ui + 3] = vCurb;

      // Right curb
      crArr[vi] = cx + f.rx * ROAD_HALF_WIDTH;
      crArr[vi + 1] = cy + f.ry * ROAD_HALF_WIDTH + 0.02;
      crArr[vi + 2] = cz + f.rz * ROAD_HALF_WIDTH;
      crArr[vi + 3] = cx + f.rx * curbOuter;
      crArr[vi + 4] = cy + f.ry * curbOuter + 0.04;
      crArr[vi + 5] = cz + f.rz * curbOuter;
      crUvArr[ui + 1] = vCurb;
      crUvArr[ui + 3] = vCurb;

      // Wide fold-free buildable open-world plains (±120m along Euclidean X) matching openWorldGroundY()
      tlArr[vi] = cx - flatFar;
      tlArr[vi + 1] = cy - 0.02;
      tlArr[vi + 2] = cz;
      tlArr[vi + 3] = cx - f.rx * curbOuter;
      tlArr[vi + 4] = cy - f.ry * curbOuter - 0.02;
      tlArr[vi + 5] = cz - f.rz * curbOuter;
      tlUvArr[ui] = 0;
      tlUvArr[ui + 1] = vTerr;
      tlUvArr[ui + 2] = 12.0;
      tlUvArr[ui + 3] = vTerr;

      trArr[vi] = cx + f.rx * curbOuter;
      trArr[vi + 1] = cy + f.ry * curbOuter - 0.02;
      trArr[vi + 2] = cz + f.rz * curbOuter;
      trArr[vi + 3] = cx + flatFar;
      trArr[vi + 4] = cy - 0.02;
      trArr[vi + 5] = cz;
      trUvArr[ui] = 0;
      trUvArr[ui + 1] = vTerr;
      trUvArr[ui + 2] = 12.0;
      trUvArr[ui + 3] = vTerr;

      // Distant scenic hills beyond ±120m (strictly periodic over 2400m circuit)
      const hillPhase = (s * Math.PI * 2) / TRACK_LENGTH;
      const hillL = Math.sin(hillPhase * 6) * 5.0 + 4.0;
      const hillR = Math.cos(hillPhase * 5) * 5.0 + 2.5;

      hlArr[vi] = cx - hillFar;
      hlArr[vi + 1] = cy - 0.02 + hillL;
      hlArr[vi + 2] = cz;
      hlArr[vi + 3] = cx - flatFar;
      hlArr[vi + 4] = cy - 0.02;
      hlArr[vi + 5] = cz;
      hlUvArr[ui] = 0;
      hlUvArr[ui + 1] = vTerr;
      hlUvArr[ui + 2] = 8.0;
      hlUvArr[ui + 3] = vTerr;

      hrArr[vi] = cx + flatFar;
      hrArr[vi + 1] = cy - 0.02;
      hrArr[vi + 2] = cz;
      hrArr[vi + 3] = cx + hillFar;
      hrArr[vi + 4] = cy - 0.02 + hillR;
      hrArr[vi + 5] = cz;
      hrUvArr[ui] = 0;
      hrUvArr[ui + 1] = vTerr;
      hrUvArr[ui + 2] = 8.0;
      hrUvArr[ui + 3] = vTerr;
    }

    rPos.needsUpdate = true;
    rUv.needsUpdate = true;
    clPos.needsUpdate = true;
    clUv.needsUpdate = true;
    crPos.needsUpdate = true;
    crUv.needsUpdate = true;
    tlPos.needsUpdate = true;
    tlUv.needsUpdate = true;
    trPos.needsUpdate = true;
    trUv.needsUpdate = true;
    hlPos.needsUpdate = true;
    hlUv.needsUpdate = true;
    hrPos.needsUpdate = true;
    hrUv.needsUpdate = true;
  }

  private updateProps(originS: number, originX: number, originY: number, timeSec: number): void {
    const propRange = QUALITY_PROFILES[this.qualityTier].propRange;
    const d = this._dummy;
    const pos = this._v1;
    const f = this._f;

    const propsDirty =
      Math.abs(originS - this.lastPropsBuiltS) >= 0.04 ||
      this.lastPropsLampBoost !== this.lastWeatherLampBoost ||
      this.lastPropsRange !== propRange;

    if (propsDirty) {
      this.lastPropsBuiltS = originS;
      this.lastPropsLampBoost = this.lastWeatherLampBoost;
      this.lastPropsRange = propRange;

      const slotStep = 12.0;
      const minSlot = Math.floor((originS - 96) / slotStep);
      const maxSlot = Math.floor((originS + propRange) / slotStep);

      let trunkC = 0;
      let pineC = 0;
      let palmC = 0;
      let rockC = 0;
      let postC = 0;
      let lampC = 0;
      let bbIdx = 0;

      for (let slot = minSlot; slot <= maxSlot; slot++) {
        const s = slot * slotStep;
        const wSlot = ((slot % 200) + 200) % 200; // 2400 / 12 = 200 exact slots per lap
        const biome = getBiomeAt(s);
        sampleRoadFrame(s, f);
        const yaw = Math.atan2(-f.tx, -f.tz);

        // Open roadside shoulder posts (wider gaps so players can ride off-road anywhere!)
        for (let side = -1; side <= 1; side += 2) {
          const isCraftOutpostZone = side > 0 && wSlot >= 2 && wSlot <= 6;
          if (!isCraftOutpostZone && postC < MAX_PROPS_PER_POOL * 2 && wSlot % 4 === 0) {
            roadFrameToLocalWorld(f, s, side * (SHOULDER_HALF_WIDTH - 0.4), 0, originS, originX, originY, pos);
            d.position.copy(pos);
            d.rotation.set(0, yaw, 0);
            d.scale.set(1, 1, 1);
            d.updateMatrix();
            this.postInst.setMatrixAt(postC++, d.matrix);
          }

          const h = hash1(wSlot * 37 + (side > 0 ? 101 : 211));
          const h2 = hash1(wSlot * 71 + (side > 0 ? 19 : 83));
          const dist = SHOULDER_HALF_WIDTH + 6.5 + h2 * 44.0;

          // Street lamps in twilight biome, low-visibility weather, or periodic highway lamps
          if (
            lampC < MAX_PROPS_PER_POOL &&
            ((biome === 3 && wSlot % 2 === 0) ||
              (this.lastWeatherLampBoost && wSlot % 3 === 0) ||
              wSlot % 6 === 0)
          ) {
            if ((wSlot + (side > 0 ? 1 : 0)) % 2 === 0) {
              roadFrameToLocalWorld(f, s, side * (SHOULDER_HALF_WIDTH + 0.8), 0, originS, originX, originY, pos);
              d.position.copy(pos);
              d.rotation.set(0, yaw, 0);
              d.scale.set(1, 1, 1);
              d.updateMatrix();
              this.lampInst.setMatrixAt(lampC++, d.matrix);
            }
          }

          // Biome-specific trees & canyon mesas spread across the wide open-world meadow
          if (!isCraftOutpostZone && h < 0.62) {
            const sc = 0.85 + h2 * 0.65;
            const wx = f.x + side * dist;
            worldAbsToLocal(wx, f.y - 0.12, s, originS, originX, originY, pos);
            d.position.copy(pos);
            d.rotation.set(0, h * 6.28, 0);
            d.scale.set(sc, sc, sc);
            d.updateMatrix();

            if (biome === 2 && h < 0.46 && rockC < MAX_PROPS_PER_POOL) {
              d.scale.set(sc * 1.4, sc * (1.2 + h * 1.8), sc * 1.2);
              d.updateMatrix();
              this.rockInst.setMatrixAt(rockC++, d.matrix);
            } else if (biome === 0 && trunkC < MAX_PROPS_PER_POOL && palmC < MAX_PROPS_PER_POOL) {
              this.trunkInst.setMatrixAt(trunkC++, d.matrix);
              this.palmInst.setMatrixAt(palmC++, d.matrix);
            } else if (trunkC < MAX_PROPS_PER_POOL && pineC < MAX_PROPS_PER_POOL) {
              this.trunkInst.setMatrixAt(trunkC++, d.matrix);
              this.pineInst.setMatrixAt(pineC++, d.matrix);
            }
          } else if (!isCraftOutpostZone && h > 0.84 && rockC < MAX_PROPS_PER_POOL) {
            const wx = f.x + side * (dist + 18);
            worldAbsToLocal(wx, f.y - 0.12, s, originS, originX, originY, pos);
            d.position.copy(pos);
            d.rotation.set(0, h2 * 6.28, 0);
            d.scale.set(0.8 + h2, 0.7 + h2 * 1.3, 0.8 + h2);
            d.updateMatrix();
            this.rockInst.setMatrixAt(rockC++, d.matrix);
          }
        }

        // Retro arcade billboards every 9 slots (boards pooled + poles instanced in 1 draw call!)
        if (wSlot > 2 && wSlot % 9 === 3 && bbIdx < this.billboardBoards.length) {
          const side = wSlot % 18 === 3 ? -1 : 1;
          roadFrameToLocalWorld(f, s, side * (SHOULDER_HALF_WIDTH + 3.6), 0, originS, originX, originY, pos);
          const bbRotY = yaw - side * 0.22;
          const bb = this.billboardBoards[bbIdx];
          bb.visible = true;
          bb.position.copy(pos);
          bb.rotation.set(0, bbRotY, 0);

          d.position.copy(pos);
          d.rotation.set(0, bbRotY, 0);
          d.scale.set(1, 1, 1);
          d.updateMatrix();
          this.billboardPolesInst.setMatrixAt(bbIdx, d.matrix);
          bbIdx++;
        }
      }

      // Checkered Start/Finish Overhead Lap Arch at cyclic s = 0
      const archDs = signedTrackDelta(0, originS);
      if (archDs >= -32 && archDs <= propRange + 24) {
        sampleRoadFrame(0, f);
        roadFrameToLocalWorld(f, 0, 0, 0, originS, originX, originY, pos);
        this.lapArchGroup.visible = true;
        this.lapArchGroup.position.copy(pos);
        this.setRoadBasisQuaternion(f, this.lapArchGroup.quaternion);
      } else if (this.lapArchGroup.visible) {
        this.lapArchGroup.visible = false;
      }

      for (let i = bbIdx; i < this.billboardBoards.length; i++) {
        this.billboardBoards[i].visible = false;
      }
      this.billboardPolesInst.count = bbIdx;
      this.billboardPolesInst.instanceMatrix.needsUpdate = true;

      this.trunkInst.count = trunkC;
      this.pineInst.count = pineC;
      this.palmInst.count = palmC;
      this.rockInst.count = rockC;
      this.postInst.count = postC;
      this.lampInst.count = lampC;
      this.trunkInst.instanceMatrix.needsUpdate = true;
      this.pineInst.instanceMatrix.needsUpdate = true;
      this.palmInst.instanceMatrix.needsUpdate = true;
      this.rockInst.instanceMatrix.needsUpdate = true;
      this.postInst.instanceMatrix.needsUpdate = true;
      this.lampInst.instanceMatrix.needsUpdate = true;
    }

    // Boost pads along the road
    let boostC = 0;
    const minB = Math.floor((originS - 24) / 24);
    const maxB = Math.floor((originS + propRange) / 24);
    for (let bi = minB; bi <= maxB && boostC < 20; bi++) {
      const pad = getBoostPadInSlot(bi);
      if (!pad) continue;
      sampleRoadFrame(pad.s, f);
      roadFrameToLocalWorld(f, pad.s, pad.x, 0.06, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      const pulse = 1.0 + 0.05 * Math.sin(timeSec * 12 + bi);
      this._scale.set(pulse, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.boostInst.setMatrixAt(boostC++, this._m4);
    }
    this.boostInst.count = boostC;
    if (boostC > 0 || this.boostInst.count > 0) {
      this.boostInst.instanceMatrix.needsUpdate = true;
    }
  }

  private setRoadBasisQuaternion(f: RoadFrame, outQ: THREE.Quaternion): void {
    this._vR.set(f.rx, f.ry, f.rz);
    this._vU.set(f.ux, f.uy, f.uz);
    this._vB.set(-f.tx, -f.ty, -f.tz);
    this._m4.makeBasis(this._vR, this._vU, this._vB);
    outQ.setFromRotationMatrix(this._m4);
  }

  private updateTrafficVisuals(
    traffic: TrafficCar[],
    originS: number,
    originX: number,
    originY: number,
    timeSec: number
  ): void {
    const f = this._f;
    const pos = this._v1;
    const subPos = this._v2;
    let used = 0;
    let trucks = 0;
    let sirens = 0;
    const sirenToggle = Math.floor(timeSec * 9) % 2 === 0;
    const sirenX = sirenToggle ? -0.34 : 0.34;
    this.carSirenMat.color.setHex(sirenToggle ? 0xff1e42 : 0x00b4ff);

    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const ds = signedTrackDelta(car.s, originS);
      if (ds < -32 || ds > 295) continue;

      sampleRoadFrame(car.s, f);
      roadFrameToLocalWorld(f, car.s, car.x + car.bumpOffset, 0, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);

      // Apply dynamic spinout fishtail & blast tilt when affected by items
      const spinT = car.spinTimer ?? 0;
      const tilt = car.hitTilt ?? 0;
      if (spinT > 0 || tilt !== 0) {
        const yawSpin = spinT > 0 ? Math.sin(spinT * 7.5) * 0.65 : 0;
        this._euler.set(0, yawSpin, tilt);
        this._q2.setFromEuler(this._euler);
        this._q.multiply(this._q2);
      }

      if (car.type === 4) {
        if (trucks >= MAX_TRUCK_RENDER) continue;
        this._scale.set(1, 1, 1);
        this._m4.compose(pos, this._q, this._scale);
        this.truckCabInst.setMatrixAt(trucks, this._m4);
        this.truckRearInst.setMatrixAt(trucks, this._m4);

        subPos.set(0, 1.12, 0.92).applyQuaternion(this._q).add(pos);
        this._scale.set(1, car.cargoDropped ? 0.45 : 1.0, 1);
        this._m4.compose(subPos, this._q, this._scale);
        this.truckCargoInst.setMatrixAt(trucks, this._m4);
        this._tmpColor.setHex(TRUCK_CARGO_TINTS[(car.cargoStyle ?? 0) % TRUCK_CARGO_TINTS.length]);
        this.truckCargoInst.setColorAt(trucks, this._tmpColor);
        trucks++;
        continue;
      }

      if (used >= MAX_TRAFFIC_RENDER) continue;

      // Shared base matrix for body, merged 4-wheels, and merged 4-lights
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.carBodyInst.setMatrixAt(used, this._m4);
      this.carWheelsInst.setMatrixAt(used, this._m4);
      this.carLightsInst.setMatrixAt(used, this._m4);

      const isPolice = car.type === 3;
      this._tmpColor.setHex(isPolice ? 0x1a1e2e : CAR_COLORS[car.colorIdx % CAR_COLORS.length]);
      this.carBodyInst.setColorAt(used, this._tmpColor);

      // Cabin with pickup scale support
      subPos.set(0, 1.38, 0.12).applyQuaternion(this._q).add(pos);
      if (car.type === 2) {
        this._scale.set(1, 0.85, 0.72);
      } else {
        this._scale.set(1, 1, 1);
      }
      this._m4.compose(subPos, this._q, this._scale);
      this.carCabinInst.setMatrixAt(used, this._m4);

      // Flashing police roof siren (alternates left red / right blue)
      if (isPolice && sirens < MAX_SIREN_RENDER) {
        subPos.set(sirenX, 1.82, 0.05).applyQuaternion(this._q).add(pos);
        this._scale.set(1, 1, 1);
        this._m4.compose(subPos, this._q, this._scale);
        this.carSirenInst.setMatrixAt(sirens++, this._m4);
      }

      used++;
    }

    this.carBodyInst.count = used;
    this.carCabinInst.count = used;
    this.carWheelsInst.count = used;
    this.carLightsInst.count = used;
    this.carSirenInst.count = sirens;

    if (used > 0 || this.lastTrafficCount > 0) {
      this.carBodyInst.instanceMatrix.needsUpdate = true;
      if (this.carBodyInst.instanceColor) {
        this.carBodyInst.instanceColor.needsUpdate = true;
      }
      this.carCabinInst.instanceMatrix.needsUpdate = true;
      this.carWheelsInst.instanceMatrix.needsUpdate = true;
      this.carLightsInst.instanceMatrix.needsUpdate = true;
      this.carSirenInst.instanceMatrix.needsUpdate = true;
      this.lastTrafficCount = used;
    }

    this.truckCabInst.count = trucks;
    this.truckRearInst.count = trucks;
    this.truckCargoInst.count = trucks;
    if (trucks > 0 || this.lastTruckCount > 0) {
      this.truckCabInst.instanceMatrix.needsUpdate = true;
      this.truckRearInst.instanceMatrix.needsUpdate = true;
      this.truckCargoInst.instanceMatrix.needsUpdate = true;
      if (this.truckCargoInst.instanceColor) {
        this.truckCargoInst.instanceColor.needsUpdate = true;
      }
      this.lastTruckCount = trucks;
    }
  }

  private updateRoadsideLandmarks(originS: number, originX: number, originY: number): void {
    const f = this._f;
    const pos = this._v1;

    // Nearest Chinese Gas Station ("中国加油") at cyclic s = 420m or 1620m, right side x = +17.5m
    let gasVisible = false;
    for (let i = 0; i < GAS_STATION_STOPS.length; i++) {
      const stopS = GAS_STATION_STOPS[i];
      const ds = signedTrackDelta(stopS, originS);
      if (ds >= -45 && ds <= 320) {
        sampleRoadFrame(stopS, f);
        roadFrameToLocalWorld(f, stopS, 17.5, 0, originS, originX, originY, pos);
        this.gasStationGroup.position.copy(pos);
        this.setRoadBasisQuaternion(f, this.gasStationGroup.quaternion);
        gasVisible = true;
        break;
      }
    }
    this.gasStationGroup.visible = gasVisible;

    // Nearest National Highway Restaurant ("国道饭店") at cyclic s = 900m or 2100m, left side x = -17.5m
    let dinerVisible = false;
    for (let i = 0; i < DINER_STOPS.length; i++) {
      const stopS = DINER_STOPS[i];
      const ds = signedTrackDelta(stopS, originS);
      if (ds >= -45 && ds <= 320) {
        sampleRoadFrame(stopS, f);
        roadFrameToLocalWorld(f, stopS, -17.5, 0, originS, originX, originY, pos);
        this.dinerGroup.position.copy(pos);
        this.setRoadBasisQuaternion(f, this.dinerGroup.quaternion);
        dinerVisible = true;
        break;
      }
    }
    this.dinerGroup.visible = dinerVisible;
  }

  private updateFallenCargoVisuals(
    cargo: readonly FallenCargo[],
    originS: number,
    originX: number,
    originY: number,
    timeSec: number
  ): void {
    const d = this._dummy;
    const pos = this._v1;
    let count = 0;

    for (let i = 0; i < cargo.length && count < MAX_FALLEN_CARGO_RENDER; i++) {
      const c = cargo[i];
      if (!c.active) continue;
      const ds = signedTrackDelta(c.s, originS);
      if (ds < -26 || ds > 260) continue;
      roadToLocalWorld(c.s, c.x, c.y, originS, originX, originY, pos);
      d.position.copy(pos);
      const tumble = c.y > 0.36 ? timeSec * 7 + i : i * 0.7;
      d.rotation.set(tumble, tumble * 0.8, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.fallenCargoInst.setMatrixAt(count, d.matrix);
      this._tmpColor.setHex(CARGO_DEBRIS_COLORS[c.colorIdx % CARGO_DEBRIS_COLORS.length]);
      this.fallenCargoInst.setColorAt(count, this._tmpColor);
      count++;
    }

    this.fallenCargoInst.count = count;
    if (count > 0 || this.lastFallenCargoCount > 0) {
      this.fallenCargoInst.instanceMatrix.needsUpdate = true;
      if (this.fallenCargoInst.instanceColor) {
        this.fallenCargoInst.instanceColor.needsUpdate = true;
      }
      this.lastFallenCargoCount = count;
    }
  }

  private updateAnimalVisuals(
    animals: readonly CrossingAnimal[],
    originS: number,
    originX: number,
    originY: number
  ): void {
    const f = this._f;
    const pos = this._v1;
    const subPos = this._v2;
    let count = 0;

    for (let i = 0; i < animals.length && count < MAX_ANIMAL_RENDER; i++) {
      const a = animals[i];
      if (!a.active) continue;
      const ds = signedTrackDelta(a.s, originS);
      if (ds < -28 || ds > 260) continue;

      sampleRoadFrame(a.s, f);
      const bob = Math.abs(Math.sin(a.phase)) * 0.14 * a.size;
      roadFrameToLocalWorld(f, a.s, a.x, bob, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);

      // Face left (-X) or right (+X) along crossing direction
      this._euler.set(0, a.dir > 0 ? 0 : Math.PI, Math.sin(a.phase) * 0.08);
      this._q2.setFromEuler(this._euler);
      this._q.multiply(this._q2);

      let bodyHex = 0xf1faee;
      let headHex = 0x22242e;
      let legHex = 0x22242e;
      let sx = 1.0;
      let sy = 1.0;
      let sz = 1.0;
      if (a.species === 'cow') {
        bodyHex = 0xf1faee;
        headHex = 0x1d1e2c;
        legHex = 0x1d1e2c;
        sx = 1.45;
        sy = 1.15;
        sz = 1.15;
      } else if (a.species === 'sheep') {
        bodyHex = 0xf8f9fa;
        headHex = 0x3d405b;
        legHex = 0x3d405b;
        sx = 0.96;
        sy = 0.88;
        sz = 0.95;
      } else if (a.species === 'dog') {
        bodyHex = 0xe09f3e;
        headHex = 0xc97d20;
        legHex = 0x9e5a14;
        sx = 0.9;
        sy = 0.65;
        sz = 0.68;
      } else if (a.species === 'boar') {
        bodyHex = 0x4a3728;
        headHex = 0x2f2118;
        legHex = 0x231710;
        sx = 1.1;
        sy = 0.82;
        sz = 0.92;
      } else {
        // white goose!
        bodyHex = 0xffffff;
        headHex = 0xff9f1c;
        legHex = 0xff9f1c;
        sx = 0.62;
        sy = 0.66;
        sz = 0.68;
      }

      const sc = a.size;

      // Body
      subPos.set(0, 0.72 * sy * sc, 0).applyQuaternion(this._q).add(pos);
      this._scale.set(sx * sc, sy * sc, sz * sc);
      this._m4.compose(subPos, this._q, this._scale);
      this.animalBodyInst.setMatrixAt(count, this._m4);
      this._tmpColor.setHex(bodyHex);
      this.animalBodyInst.setColorAt(count, this._tmpColor);

      // Head (in front along +X local after facing dir)
      subPos.set(0.62 * sx * sc, 0.96 * sy * sc, 0).applyQuaternion(this._q).add(pos);
      this._scale.set(sx * 0.85 * sc, sy * 0.9 * sc, sz * 0.85 * sc);
      this._m4.compose(subPos, this._q, this._scale);
      this.animalHeadInst.setMatrixAt(count, this._m4);
      this._tmpColor.setHex(headHex);
      this.animalHeadInst.setColorAt(count, this._tmpColor);

      // Legs
      this._scale.set(sx * sc, sy * sc, sz * sc);
      this._m4.compose(pos, this._q, this._scale);
      this.animalLegsInst.setMatrixAt(count, this._m4);
      this._tmpColor.setHex(legHex);
      this.animalLegsInst.setColorAt(count, this._tmpColor);

      count++;
    }

    this.animalBodyInst.count = count;
    this.animalHeadInst.count = count;
    this.animalLegsInst.count = count;
    if (count > 0 || this.lastAnimalCount > 0) {
      this.animalBodyInst.instanceMatrix.needsUpdate = true;
      this.animalHeadInst.instanceMatrix.needsUpdate = true;
      this.animalLegsInst.instanceMatrix.needsUpdate = true;
      if (this.animalBodyInst.instanceColor) this.animalBodyInst.instanceColor.needsUpdate = true;
      if (this.animalHeadInst.instanceColor) this.animalHeadInst.instanceColor.needsUpdate = true;
      if (this.animalLegsInst.instanceColor) this.animalLegsInst.instanceColor.needsUpdate = true;
      this.lastAnimalCount = count;
    }
  }

  private updateItemVisuals(
    vis: ItemVisuals,
    originS: number,
    originX: number,
    originY: number,
    timeSec: number
  ): void {
    const f = this._f;
    const pos = this._v1;
    const d = this._dummy;

    // 1. Rotating glowing '?' mystery crates
    let crateC = 0;
    for (let i = 0; i < vis.crates.length && crateC < 16; i++) {
      const c = vis.crates[i];
      const ds = signedTrackDelta(c.s, originS);
      if (ds < -20 || ds > 260) continue;
      sampleRoadFrame(c.s, f);
      const bobY = 0.98 + 0.22 * Math.sin(timeSec * 4.5 + c.slot);
      roadFrameToLocalWorld(f, c.s, c.x, bobY, originS, originX, originY, pos);
      d.position.copy(pos);
      d.rotation.set(0.35 * Math.sin(timeSec * 2.5 + c.slot), timeSec * 2.6 + c.slot, 0.2);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.crateInst.setMatrixAt(crateC++, d.matrix);
    }
    this.crateInst.count = crateC;
    if (crateC > 0 || this.lastCrateCount > 0) {
      this.crateInst.instanceMatrix.needsUpdate = true;
      this.lastCrateCount = crateC;
    }

    // 2. Homing RPG rockets
    let rocketC = 0;
    for (let i = 0; i < vis.rockets.length && rocketC < 8; i++) {
      const r = vis.rockets[i];
      if (!r.active) continue;
      sampleRoadFrame(r.s, f);
      roadFrameToLocalWorld(f, r.s, r.x, r.y, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.rocketInst.setMatrixAt(rocketC++, this._m4);
    }
    this.rocketInst.count = rocketC;
    if (rocketC > 0 || this.lastRocketCount > 0) {
      this.rocketInst.instanceMatrix.needsUpdate = true;
      this.lastRocketCount = rocketC;
    }

    // 3. Overhead pixel bomber jets
    let jetC = 0;
    for (let i = 0; i < vis.jets.length && jetC < 3; i++) {
      const j = vis.jets[i];
      if (!j.active) continue;
      sampleRoadFrame(j.s, f);
      roadFrameToLocalWorld(f, j.s, j.x, j.y, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.jetInst.setMatrixAt(jetC++, this._m4);
    }
    this.jetInst.count = jetC;
    if (jetC > 0 || this.lastJetCount > 0) {
      this.jetInst.instanceMatrix.needsUpdate = true;
      this.lastJetCount = jetC;
    }

    // 4. Falling airstrike bombs + pulsing red ground warning rings
    let bombC = 0;
    for (let i = 0; i < vis.bombs.length && bombC < 16; i++) {
      const b = vis.bombs[i];
      if (!b.active) continue;
      sampleRoadFrame(b.s, f);
      roadFrameToLocalWorld(f, b.s, b.x, b.y, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.bombInst.setMatrixAt(bombC, this._m4);

      roadFrameToLocalWorld(f, b.s, b.x, 0.08, originS, originX, originY, pos);
      const pulse = 0.72 + 0.42 * (b.fuse / Math.max(0.1, b.maxFuse)) + 0.1 * Math.sin(timeSec * 28);
      this._scale.set(pulse, 1, pulse);
      this._m4.compose(pos, this._q, this._scale);
      this.warningRingInst.setMatrixAt(bombC, this._m4);
      bombC++;
    }
    this.bombInst.count = bombC;
    this.warningRingInst.count = bombC;
    if (bombC > 0 || this.lastBombCount > 0) {
      this.bombInst.instanceMatrix.needsUpdate = true;
      this.warningRingInst.instanceMatrix.needsUpdate = true;
      this.lastBombCount = bombC;
    }

    // 5. Interceptor police cruisers
    let copC = 0;
    for (let i = 0; i < vis.interceptors.length && copC < 4; i++) {
      const cop = vis.interceptors[i];
      if (!cop.active) continue;
      const ds = signedTrackDelta(cop.s, originS);
      if (ds < -35 || ds > 290) continue;
      sampleRoadFrame(cop.s, f);
      roadFrameToLocalWorld(f, cop.s, cop.x, 0, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.interceptorInst.setMatrixAt(copC++, this._m4);
    }
    this.interceptorInst.count = copC;
    if (copC > 0 || this.lastInterceptorCount > 0) {
      this.interceptorInst.instanceMatrix.needsUpdate = true;
      this.lastInterceptorCount = copC;
    }

    // 6. Road spike traps & banana peels
    let trapC = 0;
    let bananaC = 0;
    for (let i = 0; i < vis.hazards.length; i++) {
      const h = vis.hazards[i];
      if (!h.active) continue;
      const ds = signedTrackDelta(h.s, originS);
      if (ds < -24 || ds > 260) continue;
      sampleRoadFrame(h.s, f);
      roadFrameToLocalWorld(f, h.s, h.x, 0.04, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      this._scale.set(1, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      if (h.kind === 'trap' && trapC < 16) {
        this.trapInst.setMatrixAt(trapC++, this._m4);
      } else if (h.kind === 'banana' && bananaC < 16) {
        this.bananaInst.setMatrixAt(bananaC++, this._m4);
      }
    }
    this.trapInst.count = trapC;
    if (trapC > 0 || this.lastTrapCount > 0) {
      this.trapInst.instanceMatrix.needsUpdate = true;
      this.lastTrapCount = trapC;
    }
    this.bananaInst.count = bananaC;
    if (bananaC > 0 || this.lastBananaCount > 0) {
      this.bananaInst.instanceMatrix.needsUpdate = true;
      this.lastBananaCount = bananaC;
    }

    // 7. Sniper aiming laser beam
    const laser = vis.sniperLaser;
    if (laser.active) {
      roadToLocalWorld(laser.fromS, laser.fromX, laser.fromY, originS, originX, originY, pos);
      this.sniperLaserPos[0] = pos.x;
      this.sniperLaserPos[1] = pos.y;
      this.sniperLaserPos[2] = pos.z;
      roadToLocalWorld(laser.toS, laser.toX, laser.toY, originS, originX, originY, pos);
      this.sniperLaserPos[3] = pos.x;
      this.sniperLaserPos[4] = pos.y;
      this.sniperLaserPos[5] = pos.z;
      this.sniperLaserMat.color.setHex(laser.progress > 0.72 ? 0xff0054 : 0x00f5d4);
      (this.sniperLaserLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.sniperLaserLine.visible = true;
    } else if (this.sniperLaserLine.visible) {
      this.sniperLaserLine.visible = false;
    }
  }

  private updateRiders(
    riders: RiderRenderState[],
    originS: number,
    originX: number,
    originY: number,
    timeSec: number
  ): void {
    const activeIds = this.activeRiderIds;
    activeIds.clear();
    const f = this._f;
    const pos = this._v1;

    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      activeIds.add(r.id);
      let vis = this.bikeMap.get(r.id);
      if (!vis) {
        const palIdx = Math.abs(r.colorIdx);
        vis = new BikeVisual(BIKE_PALETTES[palIdx % BIKE_PALETTES.length], !r.isLocal);
        vis.setPalette(palIdx, r.isBot, r.deliveryRole ?? null, r.avatarIdx);
        this.scene.add(vis.root);
        this.bikeMap.set(r.id, vis);
      }

      const ds = signedTrackDelta(r.s, originS);
      if (ds < -140 || ds > 320) {
        vis.root.visible = false;
        continue;
      }
      vis.root.visible = true;
      vis.setDistanceLod(Math.abs(ds));
      if (r.freeRoam && r.worldX !== undefined && r.worldY !== undefined && r.worldS !== undefined) {
        worldAbsToLocal(r.worldX, r.worldY, r.worldS, originS, originX, originY, pos);
        vis.root.position.copy(pos);
        this._euler.set(0, r.heading ?? 0, 0);
        vis.root.quaternion.setFromEuler(this._euler);
      } else {
        sampleRoadFrame(r.s, f);
        roadFrameToLocalWorld(f, r.s, r.x, 0, originS, originX, originY, pos);
        vis.root.position.copy(pos);
        this.setRoadBasisQuaternion(f, vis.root.quaternion);
      }
      vis.updateVisuals(r, timeSec);
    }

    // Cleanup disconnected riders
    for (const [id, vis] of this.bikeMap) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.root);
        vis.dispose();
        this.bikeMap.delete(id);
      }
    }
  }

  private updateParticles(dt: number, originS: number, originX: number, originY: number): void {
    let count = 0;
    const d = this._dummy;
    const pos = this._v1;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.s += p.vs * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= p.gravity * dt;
      if (p.y < 0.08) {
        p.y = 0.08;
        p.vy *= -0.35;
      }

      const t = p.life / p.maxLife;
      const sz = p.size * (0.35 + 0.65 * t);
      roadToLocalWorld(p.s, p.x, p.y, originS, originX, originY, pos);
      d.position.copy(pos);
      d.rotation.set(p.life * 6, p.life * 8, 0);
      d.scale.set(sz, sz, sz);
      d.updateMatrix();
      this.particleInst.setMatrixAt(count, d.matrix);
      this.particleInst.setColorAt(count, p.color);
      count++;
    }

    if (count === 0 && this.lastParticleCount === 0) return;

    this.lastParticleCount = count;
    this.particleInst.count = count;
    this.particleInst.instanceMatrix.needsUpdate = true;
    if (this.particleInst.instanceColor) {
      this.particleInst.instanceColor.needsUpdate = true;
    }
  }

  private updatePopups(dt: number, originS: number, originX: number, originY: number): void {
    const pos = this._v1;
    for (const p of this.popups) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.y += dt * 2.2;
      const t = 1 - p.life / p.maxLife;
      const pop = t < 0.18 ? 0.6 + (t / 0.18) * 0.75 : 1.35 - t * 0.25;
      p.sprite.scale.set(2.3 * pop, 1.15 * pop, 1);
      (p.sprite.material as THREE.SpriteMaterial).opacity = t > 0.65 ? (1 - t) / 0.35 : 1;
      roadToLocalWorld(p.s, p.x, p.y, originS, originX, originY, pos);
      p.sprite.position.copy(pos);
    }
  }

  private updateCamera(
    local: RiderRenderState,
    originS: number,
    originX: number,
    originY: number,
    dt: number,
    onFoot?: OnFootState
  ): void {
    const portraitBoost = this.camera.aspect < 0.85 ? Math.min(18, (0.85 - this.camera.aspect) * 42) : 0;

    // MODE A: On-Foot Minecraft-Style 1st / 3rd Person Camera
    if (onFoot?.active) {
      this.freeCamYawInit = false;
      const targetFov = (onFoot.firstPerson ? 74 : 70) + portraitBoost;
      this.currentFov += (targetFov - this.currentFov) * Math.min(1, dt * 10);
      if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();
      }
      this.currentCamRoll += (0 - this.currentCamRoll) * Math.min(1, dt * 12);

      const cp = Math.cos(onFoot.pitch);
      const lookX = -Math.sin(onFoot.yaw) * cp;
      const lookY = Math.sin(onFoot.pitch);
      const lookS = Math.cos(onFoot.yaw) * cp;
      const eyeWy = onFoot.wy + 1.54;

      if (onFoot.firstPerson) {
        worldAbsToLocal(onFoot.wx, eyeWy, onFoot.ws, originS, originX, originY, this._v1);
        this._v2.set(this._v1.x + lookX * 10, this._v1.y + lookY * 10, this._v1.z - lookS * 10);
      } else {
        const backDist = 4.3;
        const camWx = onFoot.wx - lookX * backDist;
        const camWs = onFoot.ws - lookS * backDist;
        const groundAtCam = openWorldGroundY(camWx, camWs);
        const camWy = Math.max(groundAtCam + 0.55, eyeWy - lookY * backDist + 0.65);
        worldAbsToLocal(camWx, camWy, camWs, originS, originX, originY, this._v1);
        worldAbsToLocal(
          onFoot.wx + lookX * 10,
          eyeWy + lookY * 10,
          onFoot.ws + lookS * 10,
          originS,
          originX,
          originY,
          this._v2
        );
      }

      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const mag = this.shakeIntensity * Math.max(0, this.shakeTime / 0.24);
        this._v1.x += (Math.random() - 0.5) * mag * 0.6;
        this._v1.y += (Math.random() - 0.5) * mag * 0.6;
      }

      this.camera.position.copy(this._v1);
      this.camera.lookAt(this._v2);
      return;
    }

    // MODE B: Open-World 360° Free-Roam Motorcycle Camera
    if (local.freeRoam && local.worldX !== undefined && local.worldY !== undefined && local.worldS !== undefined) {
      const heading = local.heading ?? 0;
      if (!this.freeCamYawInit) {
        this.freeCamYaw = heading;
        this.freeCamYawInit = true;
      } else {
        let diff = (heading - this.freeCamYaw) % (Math.PI * 2);
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        this.freeCamYaw += diff * Math.min(1, dt * 6.5);
      }

      const speedNorm = Math.min(1, Math.abs(local.speed) / 56);
      const targetFov =
        (this.cameraMode === 2 ? 78 : 69) +
        portraitBoost +
        speedNorm * 11 +
        (local.nitroActive ? 8 : 0);
      this.currentFov += (targetFov - this.currentFov) * Math.min(1, dt * 8);
      if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();
      }

      const camYaw = this.cameraMode === 2 ? heading : this.freeCamYaw;
      const fwdX = -Math.sin(camYaw);
      const fwdS = Math.cos(camYaw);

      const backDist = this.cameraMode === 2 ? -0.3 : this.cameraMode === 1 ? 4.2 : 5.6;
      const camH = this.cameraMode === 2 ? 1.48 : this.cameraMode === 1 ? 1.75 : 2.6;
      const camWx = local.worldX - fwdX * backDist;
      const camWs = local.worldS - fwdS * backDist;
      const camWy = Math.max(openWorldGroundY(camWx, camWs) + 0.6, local.worldY + camH);

      worldAbsToLocal(camWx, camWy, camWs, originS, originX, originY, this._v1);
      worldAbsToLocal(
        local.worldX + fwdX * 14,
        local.worldY + 1.15,
        local.worldS + fwdS * 14,
        originS,
        originX,
        originY,
        this._v2
      );

      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const mag = this.shakeIntensity * Math.max(0, this.shakeTime / 0.24);
        this._v1.x += (Math.random() - 0.5) * mag;
        this._v1.y += (Math.random() - 0.5) * mag * 0.8;
      }

      this.camera.position.copy(this._v1);
      this.camera.lookAt(this._v2);
      const targetRoll = -local.lean * (this.cameraMode === 2 ? 0.3 : 0.12);
      this.currentCamRoll += (targetRoll - this.currentCamRoll) * Math.min(1, dt * 10);
      this.camera.rotateZ(this.currentCamRoll);
      return;
    }

    // MODE C: Classic Highway Arcade Camera
    this.freeCamYawInit = false;
    const speedNorm = Math.min(1, local.speed / 64);
    const targetFov =
      (this.cameraMode === 2 ? 78 : 68) +
      portraitBoost +
      speedNorm * 14 +
      (local.nitroActive ? 9 : 0);
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, dt * 8);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    let backDist = 5.4;
    let camHeight = 2.45;
    let lookAhead = 15.0;
    let lookHeight = 1.15;

    if (this.cameraMode === 1) {
      backDist = 4.0;
      camHeight = 1.65;
      lookAhead = 18.0;
      lookHeight = 1.0;
    } else if (this.cameraMode === 2) {
      backDist = -0.35;
      camHeight = 1.48 + local.y;
      lookAhead = 22.0;
      lookHeight = 1.1 + local.y * 0.5;
    }

    const camS = local.s - backDist;
    sampleRoadFrame(camS, this._fCam);
    const camLat = local.x * (this.cameraMode === 2 ? 1.0 : 0.84);
    roadFrameToLocalWorld(
      this._fCam,
      camS,
      camLat,
      camHeight + (this.cameraMode === 2 ? 0 : local.y * 0.35),
      originS,
      originX,
      originY,
      this._v1
    );

    // Camera shake on impact / nitro roar
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const mag = this.shakeIntensity * Math.max(0, this.shakeTime / 0.24);
      this._v1.x += (Math.random() - 0.5) * mag;
      this._v1.y += (Math.random() - 0.5) * mag * 0.8;
    } else if (local.nitroActive) {
      this._v1.x += (Math.random() - 0.5) * 0.05;
      this._v1.y += (Math.random() - 0.5) * 0.04;
    }

    const targetS = local.s + lookAhead;
    roadToLocalWorld(targetS, local.x * 0.68, lookHeight, originS, originX, originY, this._v2);

    this.camera.position.copy(this._v1);
    this.camera.lookAt(this._v2);

    // Subtle dynamic arcade banking roll into turns
    const targetRoll = -local.lean * (this.cameraMode === 2 ? 0.36 : 0.14);
    this.currentCamRoll += (targetRoll - this.currentCamRoll) * Math.min(1, dt * 10);
    this.camera.rotateZ(this.currentCamRoll);
  }
}
