import {
  openWorldGroundY,
  signedTrackDelta,
} from './RoadMath';
import { BlockType, VoxelRaycastHit, VoxelWorld } from './VoxelWorld';
import { StaticObstacle, collectNearbyStaticObstacles } from './WorldObstacles';

export interface OnFootInput {
  forward: number; // -1..1
  strafe: number; // -1..1 (right positive)
  jump: boolean;
  sprint: boolean;
  lookYawDelta: number;
  lookPitchDelta: number;
}

export interface ParkedBikeState {
  wx: number;
  wy: number;
  ws: number;
  yaw: number;
}

export type OnFootCameraMode = 0 | 1 | 2; // 0: First Person, 1: Third Person Rear, 2: Third Person Front/Selfie

export interface OnFootState {
  active: boolean;
  wx: number;
  wy: number;
  ws: number;
  vx: number;
  vy: number;
  vs: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  walkPhase: number;
  moveSpeed: number;
  swingTimer: number; // > 0 when breaking/placing block
  firstPerson: boolean;
  cameraMode: OnFootCameraMode;
  selectedBlock: BlockType;
  aimHit: VoxelRaycastHit | null;
  parkedBike: ParkedBikeState;
  distToBike: number;
}

const WALK_SPEED = 6.4;
const SPRINT_SPEED = 9.8;
const JUMP_VEL = 8.75; // clears 1m voxel blocks effortlessly (~1.59m peak)
const GRAVITY = 24.0;
const PLAYER_HALF_W = 0.34;
const PLAYER_HEIGHT = 1.72;
const EYE_HEIGHT = 1.54;
const BUILD_REACH = 10.5;
const FOOTSTEP_STEP_RAD = Math.PI;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class OnFootController {
  readonly state: OnFootState = {
    active: false,
    wx: 0,
    wy: 0,
    ws: 20,
    vx: 0,
    vy: 0,
    vs: 0,
    yaw: 0,
    pitch: -0.1,
    grounded: true,
    walkPhase: 0,
    moveSpeed: 0,
    swingTimer: 0,
    firstPerson: true,
    cameraMode: 0,
    selectedBlock: 3, // Oak planks default
    aimHit: null,
    parkedBike: { wx: 0, wy: 0, ws: 20, yaw: 0 },
    distToBike: 0,
  };

  private prevJump = false;
  private stepAccum = 0;
  private readonly _nearbyObs: StaticObstacle[] = [];

  private overlapsStaticObstacles(
    wx: number,
    wy: number,
    ws: number,
    halfW: number,
    height: number
  ): boolean {
    const obs = this._nearbyObs;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (wy + 0.08 >= o.wy + o.height || wy + height <= o.wy) continue;
      const effHalfX = o.kind === 'pole' ? o.halfX * 0.72 : o.halfX;
      const effHalfZ = o.kind === 'pole' ? o.halfZ * 0.72 : o.halfZ;
      if (
        Math.abs(wx - o.wx) < effHalfX + halfW &&
        Math.abs(signedTrackDelta(ws, o.ws)) < effHalfZ + halfW
      ) {
        return true;
      }
    }
    return false;
  }

  private pushOutOfStaticObstacles(): void {
    const st = this.state;
    const obs = this._nearbyObs;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (st.wy + 0.08 >= o.wy + o.height || st.wy + PLAYER_HEIGHT <= o.wy) continue;
      const effHalfX = o.kind === 'pole' ? o.halfX * 0.72 : o.halfX;
      const effHalfZ = o.kind === 'pole' ? o.halfZ * 0.72 : o.halfZ;
      const dx = st.wx - o.wx;
      const ds = signedTrackDelta(st.ws, o.ws);
      const penX = effHalfX + PLAYER_HALF_W - Math.abs(dx);
      const penS = effHalfZ + PLAYER_HALF_W - Math.abs(ds);
      if (penX > 0 && penS > 0) {
        if (penX < penS) {
          st.wx += (dx >= 0 ? 1 : -1) * (penX + 0.01);
          st.vx = 0;
        } else {
          st.ws += (ds >= 0 ? 1 : -1) * (penS + 0.01);
          st.vs = 0;
        }
      }
    }
  }

  dismountFromBike(
    bikeWx: number,
    bikeWy: number,
    bikeWs: number,
    bikeYaw: number,
    voxels: VoxelWorld
  ): void {
    const st = this.state;
    st.active = true;
    st.parkedBike.wx = bikeWx;
    st.parkedBike.wy = bikeWy;
    st.parkedBike.ws = bikeWs;
    st.parkedBike.yaw = bikeYaw;

    collectNearbyStaticObstacles(bikeWx, bikeWs, 12, this._nearbyObs);

    // Step off to the left side of the bike if clear, else right side
    const leftX = -Math.cos(bikeYaw);
    const leftS = -Math.sin(bikeYaw);
    let spawnWx = bikeWx + leftX * 1.45;
    let spawnWs = bikeWs + leftS * 1.45;
    let spawnWy = Math.max(
      openWorldGroundY(spawnWx, spawnWs),
      voxels.getSupportHeight(spawnWx, spawnWs, PLAYER_HALF_W, PLAYER_HALF_W, bikeWy + 1.1)
    );

    if (
      voxels.overlapsBox(spawnWx, spawnWy, spawnWs, PLAYER_HALF_W, PLAYER_HEIGHT, PLAYER_HALF_W) ||
      this.overlapsStaticObstacles(spawnWx, spawnWy, spawnWs, PLAYER_HALF_W, PLAYER_HEIGHT)
    ) {
      spawnWx = bikeWx - leftX * 1.45;
      spawnWs = bikeWs - leftS * 1.45;
      spawnWy = Math.max(
        openWorldGroundY(spawnWx, spawnWs),
        voxels.getSupportHeight(spawnWx, spawnWs, PLAYER_HALF_W, PLAYER_HALF_W, bikeWy + 1.1)
      );
    }

    st.wx = spawnWx;
    st.wy = spawnWy;
    st.ws = spawnWs;
    st.vx = 0;
    st.vy = 0;
    st.vs = 0;
    st.yaw = bikeYaw;
    st.pitch = -0.28;
    st.grounded = true;
    st.walkPhase = 0;
    st.moveSpeed = 0;
    st.swingTimer = 0;
    st.distToBike = 1.45;
    this.prevJump = false;
    this.stepAccum = 0;
  }

  mountBike(): ParkedBikeState {
    const st = this.state;
    st.active = false;
    st.aimHit = null;
    return { ...st.parkedBike };
  }

  summonBikeNearPlayer(voxels: VoxelWorld): ParkedBikeState {
    const st = this.state;
    const fwdX = -Math.sin(st.yaw);
    const fwdS = Math.cos(st.yaw);
    const bx = st.wx + fwdX * 2.2;
    const bs = st.ws + fwdS * 2.2;
    const by = Math.max(
      openWorldGroundY(bx, bs),
      voxels.getSupportHeight(bx, bs, 0.45, 0.85, st.wy + 1.2)
    );
    st.parkedBike.wx = bx;
    st.parkedBike.wy = by;
    st.parkedBike.ws = bs;
    st.parkedBike.yaw = st.yaw;
    st.distToBike = 2.2;
    return { ...st.parkedBike };
  }

  selectBlock(type: BlockType): void {
    this.state.selectedBlock = type;
  }

  cycleBlock(delta: number): BlockType {
    const idx = ((this.state.selectedBlock - 1 + delta) % 10 + 10) % 10;
    this.state.selectedBlock = (idx + 1) as BlockType;
    return this.state.selectedBlock;
  }

  cycleCameraMode(): 0 | 1 | 2 {
    const next = (((this.state.cameraMode + 1) % 3) as 0 | 1 | 2);
    this.state.cameraMode = next;
    this.state.firstPerson = next === 0;
    return next;
  }

  setCameraMode(mode: OnFootCameraMode): void {
    this.state.cameraMode = mode;
    this.state.firstPerson = mode === 0;
  }

  togglePerspective(): boolean {
    const next: OnFootCameraMode = this.state.cameraMode === 0 ? 1 : 0;
    this.state.cameraMode = next;
    this.state.firstPerson = next === 0;
    return this.state.firstPerson;
  }

  teleportTo(wx: number, ws: number, voxels: VoxelWorld): void {
    if (!Number.isFinite(wx) || !Number.isFinite(ws)) return;
    const st = this.state;
    const groundY = openWorldGroundY(wx, ws);
    let safeY = Math.max(
      groundY,
      voxels.getSupportHeight(wx, ws, PLAYER_HALF_W, PLAYER_HALF_W, groundY + 64)
    );
    let guard = 0;
    while (
      guard < 32 &&
      voxels.overlapsBox(wx, safeY + 0.05, ws, PLAYER_HALF_W, PLAYER_HEIGHT - 0.05, PLAYER_HALF_W)
    ) {
      safeY += 1.0;
      guard++;
    }

    st.wx = wx;
    st.wy = safeY;
    st.ws = ws;
    st.vx = 0;
    st.vy = 0;
    st.vs = 0;
    st.grounded = true;
    st.moveSpeed = 0;
    st.swingTimer = 0;
    st.aimHit = null;
    this.prevJump = false;
    this.stepAccum = 0;

    // Move parked bike cleanly beside the player on safe ground
    const rightX = Math.cos(st.yaw);
    const rightS = Math.sin(st.yaw);
    const bx = wx + rightX * 2.1;
    const bs = ws + rightS * 2.1;
    const bikeGround = openWorldGroundY(bx, bs);
    let by = Math.max(
      bikeGround,
      voxels.getSupportHeight(bx, bs, 0.45, 0.85, bikeGround + 64)
    );
    let bGuard = 0;
    while (bGuard < 32 && voxels.overlapsBox(bx, by + 0.05, bs, 0.45, 1.4, 0.45)) {
      by += 1.0;
      bGuard++;
    }
    st.parkedBike.wx = bx;
    st.parkedBike.wy = by;
    st.parkedBike.ws = bs;
    st.parkedBike.yaw = st.yaw;
    st.distToBike = Math.hypot(st.wx - bx, st.wy - by, signedTrackDelta(st.ws, bs));
  }

  triggerSwing(): void {
    this.state.swingTimer = 0.24;
  }

  getEyePosition(): { wx: number; wy: number; ws: number } {
    return {
      wx: this.state.wx,
      wy: this.state.wy + EYE_HEIGHT,
      ws: this.state.ws,
    };
  }

  getLookDirection(): { dx: number; dy: number; ds: number } {
    const cp = Math.cos(this.state.pitch);
    return {
      dx: -Math.sin(this.state.yaw) * cp,
      dy: Math.sin(this.state.pitch),
      ds: Math.cos(this.state.yaw) * cp,
    };
  }

  /**
   * Checks whether placing a voxel at (gx, gy, gz) would intersect the player's body.
   */
  wouldIntersectPlayer(gx: number, gy: number, gz: number): boolean {
    const st = this.state;
    const ds = signedTrackDelta(gz + 0.5, st.ws);
    if (Math.abs(ds) >= 0.5 + PLAYER_HALF_W) return false;
    if (gx + 1 <= st.wx - PLAYER_HALF_W || gx >= st.wx + PLAYER_HALF_W) return false;
    if (gy + 1 <= st.wy + 0.05 || gy >= st.wy + PLAYER_HEIGHT - 0.05) return false;
    return true;
  }

  update(
    dt: number,
    input: OnFootInput,
    voxels: VoxelWorld,
    onFootstep?: () => void
  ): void {
    const st = this.state;
    if (!st.active) return;

    const step = dt > 0.05 ? 0.05 : dt < 0.0001 ? 0.0001 : dt;

    // 1. Update look orientation
    st.yaw += input.lookYawDelta;
    st.pitch = clamp(st.pitch + input.lookPitchDelta, -1.36, 1.36);

    if (st.swingTimer > 0) {
      st.swingTimer = Math.max(0, st.swingTimer - step);
    }

    // 2. Horizontal movement relative to camera yaw
    const fwdX = -Math.sin(st.yaw);
    const fwdS = Math.cos(st.yaw);
    const rightX = Math.cos(st.yaw);
    const rightS = Math.sin(st.yaw);

    let moveX = fwdX * input.forward + rightX * input.strafe;
    let moveS = fwdS * input.forward + rightS * input.strafe;
    const moveLen = Math.hypot(moveX, moveS);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveS /= moveLen;
    }

    const maxSpd = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    const accel = st.grounded ? 18.0 : 6.0;
    const targetVx = moveX * maxSpd;
    const targetVs = moveS * maxSpd;

    st.vx += (targetVx - st.vx) * Math.min(1, step * accel);
    st.vs += (targetVs - st.vs) * Math.min(1, step * accel);
    if (moveLen < 0.02 && st.grounded) {
      const damp = Math.exp(-14.0 * step);
      st.vx *= damp;
      st.vs *= damp;
    }

    // 3. Jump
    if (input.jump && st.grounded && !this.prevJump) {
      st.vy = JUMP_VEL;
      st.grounded = false;
    }
    this.prevJump = input.jump;

    // 4. Gravity
    st.vy -= GRAVITY * step;
    if (st.vy < -32) st.vy = -32;

    // 5. Axis-separated AABB collision resolution (X -> S -> Y) against voxels + static world obstacles
    collectNearbyStaticObstacles(st.wx, st.ws, 16, this._nearbyObs);

    const nextWx = st.wx + st.vx * step;
    if (
      !voxels.overlapsBox(nextWx, st.wy + 0.08, st.ws, PLAYER_HALF_W, PLAYER_HEIGHT - 0.08, PLAYER_HALF_W) &&
      !this.overlapsStaticObstacles(nextWx, st.wy, st.ws, PLAYER_HALF_W, PLAYER_HEIGHT)
    ) {
      st.wx = nextWx;
    } else {
      st.vx = 0;
    }

    const nextWs = st.ws + st.vs * step;
    if (
      !voxels.overlapsBox(st.wx, st.wy + 0.08, nextWs, PLAYER_HALF_W, PLAYER_HEIGHT - 0.08, PLAYER_HALF_W) &&
      !this.overlapsStaticObstacles(st.wx, st.wy, nextWs, PLAYER_HALF_W, PLAYER_HEIGHT)
    ) {
      st.ws = nextWs;
    } else {
      st.vs = 0;
    }

    // Safety push-out if already overlapping a static obstacle (e.g. after dismount/teleport)
    this.pushOutOfStaticObstacles();

    // Infinite open world: zero lateral walls!
    // Vertical resolution (blocks + static obstacle tops + natural open-world ground)
    const prevWy = st.wy;
    let nextWy = st.wy + st.vy * step;
    const groundY = openWorldGroundY(st.wx, st.ws);

    if (st.vy > 0) {
      // Head bump check against ceiling blocks
      if (voxels.overlapsBox(st.wx, nextWy, st.ws, PLAYER_HALF_W, PLAYER_HEIGHT, PLAYER_HALF_W)) {
        const ceilingY = Math.floor(nextWy + PLAYER_HEIGHT);
        nextWy = Math.max(prevWy, ceilingY - PLAYER_HEIGHT - 0.01);
        st.vy = 0;
      }
      st.grounded = false;
    } else {
      let staticSupport = groundY;
      for (let i = 0; i < this._nearbyObs.length; i++) {
        const o = this._nearbyObs[i];
        const effHalfX = o.kind === 'pole' ? o.halfX * 0.72 : o.halfX;
        const effHalfZ = o.kind === 'pole' ? o.halfZ * 0.72 : o.halfZ;
        if (
          Math.abs(st.wx - o.wx) < effHalfX + PLAYER_HALF_W - 0.02 &&
          Math.abs(signedTrackDelta(st.ws, o.ws)) < effHalfZ + PLAYER_HALF_W - 0.02
        ) {
          const top = o.wy + o.height;
          if (top > staticSupport && top <= prevWy + 0.22) {
            staticSupport = top;
          }
        }
      }
      const supportY = Math.max(
        staticSupport,
        voxels.getSupportHeight(st.wx, st.ws, PLAYER_HALF_W, PLAYER_HALF_W, prevWy + 0.22)
      );
      if (nextWy <= supportY + 0.002) {
        nextWy = supportY;
        st.vy = 0;
        st.grounded = true;
      } else {
        st.grounded = false;
      }
    }

    // Never sink below ground when walking up slopes
    if (nextWy < groundY) {
      nextWy = groundY;
      st.vy = 0;
      st.grounded = true;
    }
    st.wy = nextWy;

    // 6. Walking animation phase & subtle footsteps
    st.moveSpeed = Math.hypot(st.vx, st.vs);
    if (st.grounded && st.moveSpeed > 0.45) {
      const dPhase = st.moveSpeed * step * 1.65;
      st.walkPhase += dPhase;
      this.stepAccum += dPhase;
      if (this.stepAccum >= FOOTSTEP_STEP_RAD) {
        this.stepAccum -= FOOTSTEP_STEP_RAD;
        onFootstep?.();
      }
    } else {
      this.stepAccum = 0;
    }

    // 7. Distance to parked bike
    const dBikeX = st.wx - st.parkedBike.wx;
    const dBikeS = signedTrackDelta(st.ws, st.parkedBike.ws);
    const dBikeY = st.wy - st.parkedBike.wy;
    st.distToBike = Math.hypot(dBikeX, dBikeY, dBikeS);

    // 8. Raycast for Minecraft block highlight / placement target
    const eye = this.getEyePosition();
    const dir = this.getLookDirection();
    st.aimHit = voxels.raycast(eye.wx, eye.wy, eye.ws, dir.dx, dir.dy, dir.ds, BUILD_REACH);
  }
}
