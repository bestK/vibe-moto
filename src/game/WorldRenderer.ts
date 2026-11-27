import * as THREE from 'three';
import {
  CURB_WIDTH,
  ROAD_HALF_WIDTH,
  RoadFrame,
  SHOULDER_HALF_WIDTH,
  getBiomeAt,
  getBoostPadInSlot,
  hash1,
  roadToLocalWorld,
  roadX,
  roadY,
  sampleRoadFrame,
} from './RoadMath';
import { getPixelAtlas } from './PixelTextures';
import { BikeVisual } from './BikeModel';
import { RiderRenderState, TrafficCar } from './types';

const ROAD_SLICES = 116;
const SLICE_STEP = 3.0; // covers -30m behind to +318m ahead
const MAX_PARTICLES = 260;
const MAX_PROPS_PER_POOL = 96;
const MAX_TRAFFIC_RENDER = 26;
const MAX_POPUPS = 14;

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

interface CarVisual {
  group: THREE.Group;
  bodyMat: THREE.MeshLambertMaterial;
  cabin: THREE.Mesh;
  sirenRed: THREE.Mesh;
  sirenBlue: THREE.Mesh;
}

const CAR_COLORS = [
  0xd62828, 0x2a9d8f, 0xe9c46a, 0x457b9d, 0xf4a261, 0x7209b7, 0x52b788, 0xe5e5e5,
];

const BIOME_FOG = [
  new THREE.Color('#ff9b6a'), // 0 Coastal sunset
  new THREE.Color('#d98a6c'), // 1 Pine highland
  new THREE.Color('#e07a5f'), // 2 Red canyon
  new THREE.Color('#352a5c'), // 3 Twilight neon
];

const BIOME_TERRAIN_TINT = [
  new THREE.Color('#c2a878'), // warm sandy coast
  new THREE.Color('#5a8f49'), // lush highland pine
  new THREE.Color('#b85d3b'), // red canyon mesa
  new THREE.Color('#354066'), // twilight ridge
];

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly fog: THREE.Fog;
  private readonly skyDome: THREE.Mesh;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;

  // Dynamic sliding road geometries (updated in-place, 0 allocs/frame)
  private readonly roadGeo: THREE.BufferGeometry;
  private readonly curbLGeo: THREE.BufferGeometry;
  private readonly curbRGeo: THREE.BufferGeometry;
  private readonly terrainLGeo: THREE.BufferGeometry;
  private readonly terrainRGeo: THREE.BufferGeometry;
  private readonly terrainMat: THREE.MeshLambertMaterial;

  // Instanced roadside scenery pools
  private readonly trunkInst: THREE.InstancedMesh;
  private readonly pineInst: THREE.InstancedMesh;
  private readonly palmInst: THREE.InstancedMesh;
  private readonly rockInst: THREE.InstancedMesh;
  private readonly postInst: THREE.InstancedMesh;
  private readonly lampInst: THREE.InstancedMesh;
  private readonly boostInst: THREE.InstancedMesh;
  private readonly billboardMeshes: THREE.Mesh[] = [];

  // Particle pool
  private readonly particles: Particle[] = [];
  private readonly particleInst: THREE.InstancedMesh;

  // 3D comic hit popups
  private readonly popups: HitPopup[] = [];

  // Traffic visual pool
  private readonly carPool: CarVisual[] = [];

  // Rider visuals keyed by rider id
  private readonly bikeMap = new Map<string, BikeVisual>();

  // Camera & presentation controls
  cameraMode: CameraMode = 0;
  pixelScale = 1; // 1 = HD crisp, 2 = chunky retro pixel grid
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
  private readonly _scale = new THREE.Vector3();
  private readonly _dummy = new THREE.Object3D();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // crisp pixel-art edges + higher FPS!
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog('#ff9b6a', 95, 315);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.25, 620);

    const atlas = getPixelAtlas();

    // Crisp sunset sky dome
    const skyGeo = new THREE.SphereGeometry(460, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: atlas.sky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.rotation.y = Math.PI * 0.5; // place retro sun directly ahead (-Z)
    this.scene.add(this.skyDome);

    // Punchy arcade golden-hour lighting
    this.hemiLight = new THREE.HemisphereLight('#ffe5b4', '#384163', 1.15);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#ffd89b', 1.55);
    this.sunLight.position.set(18, 42, -90);
    this.scene.add(this.sunLight);

    // Sliding ribbon meshes (road, curbs, terrain shoulders)
    this.roadGeo = this.createRibbonGeometry(ROAD_SLICES);
    const roadMesh = new THREE.Mesh(
      this.roadGeo,
      new THREE.MeshLambertMaterial({ map: atlas.road })
    );
    roadMesh.frustumCulled = false;
    this.scene.add(roadMesh);

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

    // 8 pooled roadside billboards (2 per texture style)
    const bbGeo = new THREE.PlaneGeometry(7.6, 3.8);
    const poleGeo = new THREE.BoxGeometry(0.35, 6.0, 0.35);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3b4252 });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const board = new THREE.Mesh(
        bbGeo,
        new THREE.MeshBasicMaterial({ map: atlas.billboards[i % atlas.billboards.length] })
      );
      board.position.y = 5.4;
      g.add(board);
      const pL = new THREE.Mesh(poleGeo, poleMat);
      pL.position.set(-2.6, 3.0, -0.1);
      g.add(pL);
      const pR = new THREE.Mesh(poleGeo, poleMat);
      pR.position.set(2.6, 3.0, -0.1);
      g.add(pR);
      g.visible = false;
      this.scene.add(g);
      this.billboardMeshes.push(g as unknown as THREE.Mesh);
    }

    // Traffic car pool
    this.initTrafficPool();

    // Pixel particle pool
    const pGeo = new THREE.BoxGeometry(1, 1, 1);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInst = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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

    this.resize();
  }

  private makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.count = 0;
    this.scene.add(inst);
    return inst;
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

  private initTrafficPool(): void {
    const atlas = getPixelAtlas();
    const bodyGeo = new THREE.BoxGeometry(2.15, 0.85, 4.5);
    const cabinGeo = new THREE.BoxGeometry(1.85, 0.68, 2.25);
    const wheelGeo = new THREE.BoxGeometry(0.32, 0.56, 0.72);
    const lightGeo = new THREE.BoxGeometry(0.48, 0.22, 0.1);
    const sirenGeo = new THREE.BoxGeometry(0.55, 0.22, 0.28);

    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x161820, flatShading: true });
    const winMat = new THREE.MeshLambertMaterial({ map: atlas.carWindows, flatShading: true });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a44 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff1e42 });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x00b4ff });

    for (let i = 0; i < MAX_TRAFFIC_RENDER; i++) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: CAR_COLORS[i % CAR_COLORS.length], flatShading: true });

      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.68;
      g.add(body);

      const cabin = new THREE.Mesh(cabinGeo, winMat);
      cabin.position.set(0, 1.38, 0.12);
      g.add(cabin);

      const wPos = [
        [-1.02, 0.3, -1.35],
        [1.02, 0.3, -1.35],
        [-1.02, 0.3, 1.35],
        [1.02, 0.3, 1.35],
      ];
      for (const [wx, wy, wz] of wPos) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(wx, wy, wz);
        g.add(w);
      }

      const tlL = new THREE.Mesh(lightGeo, tailMat);
      tlL.position.set(-0.72, 0.78, 2.26);
      g.add(tlL);
      const tlR = new THREE.Mesh(lightGeo, tailMat);
      tlR.position.set(0.72, 0.78, 2.26);
      g.add(tlR);

      const hlL = new THREE.Mesh(lightGeo, headMat);
      hlL.position.set(-0.72, 0.74, -2.26);
      g.add(hlL);
      const hlR = new THREE.Mesh(lightGeo, headMat);
      hlR.position.set(0.72, 0.74, -2.26);
      g.add(hlR);

      const sirenRed = new THREE.Mesh(sirenGeo, redMat);
      sirenRed.position.set(-0.34, 1.82, 0.05);
      sirenRed.visible = false;
      g.add(sirenRed);

      const sirenBlue = new THREE.Mesh(sirenGeo, blueMat);
      sirenBlue.position.set(0.34, 1.82, 0.05);
      sirenBlue.visible = false;
      g.add(sirenBlue);

      g.visible = false;
      this.scene.add(g);
      this.carPool.push({ group: g, bodyMat, cabin, sirenRed, sirenBlue });
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const effectiveRatio = this.pixelScale === 1 ? dpr : 1 / this.pixelScale;
    this.renderer.setPixelRatio(effectiveRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
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
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
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

  spawnHitPopup(kind: 'POW' | 'SMACK' | 'BONK' | 'KO' | 'BOOST', s: number, x: number, y: number): void {
    const atlas = getPixelAtlas();
    for (const p of this.popups) {
      if (!p.active) {
        p.active = true;
        p.s = s;
        p.x = x;
        p.y = y;
        p.life = 0.72;
        p.maxLife = 0.72;
        (p.sprite.material as THREE.SpriteMaterial).map = atlas.hitWords[kind];
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
    timeSec: number
  ): void {
    const originS = local.s;
    const originX = roadX(originS);
    const originY = roadY(originS);

    // Smooth biome atmosphere blending
    const biome = getBiomeAt(originS);
    this.smoothFogColor.lerp(BIOME_FOG[biome], Math.min(1, dt * 1.4));
    this.fog.color.copy(this.smoothFogColor);
    this.smoothTerrainTint.lerp(BIOME_TERRAIN_TINT[biome], Math.min(1, dt * 1.4));
    this.terrainMat.color.copy(this.smoothTerrainTint);

    // 1. Update sliding road & terrain ribbons
    this.updateRoadRibbons(originS, originX, originY);

    // 2. Update deterministic instanced roadside props + boost pads
    this.updateProps(originS, originX, originY, timeSec);

    // 3. Update traffic car meshes
    this.updateTrafficVisuals(traffic, originS, originX, originY, timeSec);

    // 4. Sync & update all motorcycle visuals (local + remote players + bots)
    this.updateRiders(allRiders, originS, originX, originY, timeSec);

    // 5. Update particles & 3D hit popups
    this.updateParticles(dt, originS, originX, originY);
    this.updatePopups(dt, originS, originX, originY);

    // 6. Update arcade camera
    this.updateCamera(local, originS, originX, originY, dt);

    // Keep sky dome centered on camera
    this.skyDome.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);
  }

  private updateRoadRibbons(originS: number, originX: number, originY: number): void {
    const baseS = Math.floor(originS / SLICE_STEP) * SLICE_STEP - 30.0;
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

    const f = this._f;
    const curbOuter = ROAD_HALF_WIDTH + CURB_WIDTH;
    const terrainFar = 92.0;

    for (let i = 0; i < ROAD_SLICES; i++) {
      const s = baseS + i * SLICE_STEP;
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

      // Scenic terrain skirts (rolling roadside hillside / coast drop)
      const hillL = Math.sin(s * 0.017) * 5.0 + 3.0;
      const hillR = Math.cos(s * 0.014) * 5.0 - 1.5;

      tlArr[vi] = cx - f.rx * terrainFar;
      tlArr[vi + 1] = cy - f.ry * terrainFar + hillL;
      tlArr[vi + 2] = cz - f.rz * terrainFar;
      tlArr[vi + 3] = cx - f.rx * curbOuter;
      tlArr[vi + 4] = cy - f.ry * curbOuter - 0.02;
      tlArr[vi + 5] = cz - f.rz * curbOuter;
      tlUvArr[ui] = 0;
      tlUvArr[ui + 1] = vTerr;
      tlUvArr[ui + 2] = 6.0;
      tlUvArr[ui + 3] = vTerr;

      trArr[vi] = cx + f.rx * curbOuter;
      trArr[vi + 1] = cy + f.ry * curbOuter - 0.02;
      trArr[vi + 2] = cz + f.rz * curbOuter;
      trArr[vi + 3] = cx + f.rx * terrainFar;
      trArr[vi + 4] = cy + f.ry * terrainFar + hillR;
      trArr[vi + 5] = cz + f.rz * terrainFar;
      trUvArr[ui] = 0;
      trUvArr[ui + 1] = vTerr;
      trUvArr[ui + 2] = 6.0;
      trUvArr[ui + 3] = vTerr;
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
  }

  private updateProps(originS: number, originX: number, originY: number, timeSec: number): void {
    const slotStep = 12.0;
    const minSlot = Math.floor((originS - 18) / slotStep);
    const maxSlot = Math.floor((originS + 285) / slotStep);

    let trunkC = 0;
    let pineC = 0;
    let palmC = 0;
    let rockC = 0;
    let postC = 0;
    let lampC = 0;
    let bbIdx = 0;

    const d = this._dummy;
    const pos = this._v1;
    const f = this._f;

    for (let slot = minSlot; slot <= maxSlot; slot++) {
      const s = slot * slotStep;
      const biome = getBiomeAt(s);
      sampleRoadFrame(s, f);
      const yaw = Math.atan2(-f.tx, -f.tz);

      // Guard posts every slot along outer shoulder
      for (let side = -1; side <= 1; side += 2) {
        if (postC < MAX_PROPS_PER_POOL * 2 && (slot % 2 === 0)) {
          roadToLocalWorld(s, side * (SHOULDER_HALF_WIDTH - 0.4), 0, originS, originX, originY, pos);
          d.position.copy(pos);
          d.rotation.set(0, yaw, 0);
          d.scale.set(1, 1, 1);
          d.updateMatrix();
          this.postInst.setMatrixAt(postC++, d.matrix);
        }

        const h = hash1(slot * 37 + (side > 0 ? 101 : 211));
        const h2 = hash1(slot * 71 + (side > 0 ? 19 : 83));
        const dist = SHOULDER_HALF_WIDTH + 3.2 + h2 * 18.0;

        // Street lamps in twilight biome or periodic highway lamps
        if (lampC < MAX_PROPS_PER_POOL && ((biome === 3 && slot % 2 === 0) || slot % 6 === 0)) {
          if ((slot + (side > 0 ? 1 : 0)) % 2 === 0) {
            roadToLocalWorld(s, side * (SHOULDER_HALF_WIDTH + 0.8), 0, originS, originX, originY, pos);
            d.position.copy(pos);
            d.rotation.set(0, yaw, 0);
            d.scale.set(1, 1, 1);
            d.updateMatrix();
            this.lampInst.setMatrixAt(lampC++, d.matrix);
          }
        }

        // Biome-specific trees & canyon mesas
        if (h < 0.62) {
          const sc = 0.85 + h2 * 0.65;
          roadToLocalWorld(s, side * dist, -0.3, originS, originX, originY, pos);
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
        } else if (h > 0.84 && rockC < MAX_PROPS_PER_POOL) {
          roadToLocalWorld(s, side * (dist + 6), -0.4, originS, originX, originY, pos);
          d.position.copy(pos);
          d.rotation.set(0, h2 * 6.28, 0);
          d.scale.set(0.8 + h2, 0.7 + h2 * 1.3, 0.8 + h2);
          d.updateMatrix();
          this.rockInst.setMatrixAt(rockC++, d.matrix);
        }
      }

      // Retro arcade billboards every 9 slots
      if (slot > 0 && slot % 9 === 3 && bbIdx < this.billboardMeshes.length) {
        const side = (slot % 18 === 3) ? -1 : 1;
        roadToLocalWorld(s, side * (SHOULDER_HALF_WIDTH + 3.6), 0, originS, originX, originY, pos);
        const bb = this.billboardMeshes[bbIdx++];
        bb.visible = true;
        bb.position.copy(pos);
        bb.rotation.set(0, yaw - side * 0.22, 0);
      }
    }

    for (let i = bbIdx; i < this.billboardMeshes.length; i++) {
      this.billboardMeshes[i].visible = false;
    }

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

    // Boost pads along the road
    let boostC = 0;
    const minB = Math.floor((originS - 24) / 24);
    const maxB = Math.floor((originS + 280) / 24);
    for (let bi = minB; bi <= maxB && boostC < 20; bi++) {
      const pad = getBoostPadInSlot(bi);
      if (!pad) continue;
      sampleRoadFrame(pad.s, f);
      roadToLocalWorld(pad.s, pad.x, 0.06, originS, originX, originY, pos);
      this.setRoadBasisQuaternion(f, this._q);
      const pulse = 1.0 + 0.05 * Math.sin(timeSec * 12 + bi);
      this._scale.set(pulse, 1, 1);
      this._m4.compose(pos, this._q, this._scale);
      this.boostInst.setMatrixAt(boostC++, this._m4);
    }
    this.boostInst.count = boostC;
    this.boostInst.instanceMatrix.needsUpdate = true;
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
    let used = 0;
    const sirenToggle = Math.floor(timeSec * 9) % 2 === 0;

    for (let i = 0; i < traffic.length && used < MAX_TRAFFIC_RENDER; i++) {
      const car = traffic[i];
      const ds = car.s - originS;
      if (ds < -26 || ds > 295) continue;

      const vis = this.carPool[used++];
      vis.group.visible = true;
      sampleRoadFrame(car.s, f);
      roadToLocalWorld(car.s, car.x + car.bumpOffset, 0, originS, originX, originY, pos);
      vis.group.position.copy(pos);
      this.setRoadBasisQuaternion(f, vis.group.quaternion);

      const isPolice = car.type === 3;
      vis.bodyMat.color.setHex(isPolice ? 0x1a1e2e : CAR_COLORS[car.colorIdx % CAR_COLORS.length]);
      vis.cabin.scale.set(1, car.type === 2 ? 0.85 : 1, car.type === 2 ? 0.72 : 1);
      vis.sirenRed.visible = isPolice && sirenToggle;
      vis.sirenBlue.visible = isPolice && !sirenToggle;
    }

    for (let i = used; i < MAX_TRAFFIC_RENDER; i++) {
      this.carPool[i].group.visible = false;
    }
  }

  private updateRiders(
    riders: RiderRenderState[],
    originS: number,
    originX: number,
    originY: number,
    timeSec: number
  ): void {
    const activeIds = new Set<string>();
    const f = this._f;
    const pos = this._v1;

    for (const r of riders) {
      activeIds.add(r.id);
      let vis = this.bikeMap.get(r.id);
      if (!vis) {
        const palIdx = Math.abs(r.colorIdx);
        vis = new BikeVisual(
          {
            name: r.name,
            primary: '#e63946',
            secondary: '#1d1e2c',
            jacket: '#232533',
            helmet: '#f1faee',
            visor: '#00f5d4',
            accent: '#ffb703',
          },
          !r.isLocal
        );
        vis.setPalette(palIdx, r.isBot);
        this.scene.add(vis.root);
        this.bikeMap.set(r.id, vis);
      }

      const ds = r.s - originS;
      if (ds < -45 || ds > 320) {
        vis.root.visible = false;
        continue;
      }
      vis.root.visible = true;
      sampleRoadFrame(r.s, f);
      roadToLocalWorld(r.s, r.x, 0, originS, originX, originY, pos);
      vis.root.position.copy(pos);
      this.setRoadBasisQuaternion(f, vis.root.quaternion);
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
    dt: number
  ): void {
    const speedNorm = Math.min(1, local.speed / 64);
    const targetFov = (this.cameraMode === 2 ? 78 : 68) + speedNorm * 14 + (local.nitroActive ? 9 : 0);
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
    roadToLocalWorld(camS, camLat, camHeight + (this.cameraMode === 2 ? 0 : local.y * 0.35), originS, originX, originY, this._v1);

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
