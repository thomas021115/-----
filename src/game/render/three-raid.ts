import * as THREE from 'three';
import type { DuckThreeRaidBridge } from '../types';

type Rect = { x: number; y: number; w: number; h: number; buildingIndex?: number | null; visualKind?: string | null };
type PointEntity = {
  x: number;
  y: number;
  angle?: number;
  dead?: boolean;
  hp?: number;
  maxHp?: number;
  variant?: number;
  kind?: string;
  alertTimer?: number;
  opened?: boolean;
  rare?: boolean;
  containsQuest?: boolean;
  vx?: number;
  vy?: number;
  owner?: string;
  weaponId?: string;
  r?: number;
  z?: number;
  id?: string;
  radius?: number;
  age?: number;
  life?: number;
  type?: string;
  scale?: number;
  vision?: number;
};
type Building = Rect & { locked?: boolean; visualHeight?: number; roofStyle?: number };
type RaidMap = {
  id: string;
  palette: Record<string, string>;
  world: { w: number; h: number };
  extraction: Rect & { active?: boolean };
  extractions?: Array<Rect & { active?: boolean }>;
  roads: Rect[];
  waterZones: Array<{ x: number; y: number; rx: number; ry: number }>;
  walls?: Rect[];
  buildings?: Building[];
  buildingSpecs?: Building[];
  bushes?: Array<[number, number, number]>;
  vehicles?: Array<PointEntity & { w: number; h: number; horizontal?: boolean; type?: number }>;
  rocks?: Array<PointEntity & { r: number }>;
  coverProps?: Array<PointEntity & { w: number; h: number; type?: number }>;
  grassPatches?: PointEntity[];
  fences?: Array<PointEntity & { w: number; h: number; horizontal?: boolean; type?: number }>;
  streetLights?: Array<PointEntity & { horizontal?: boolean; type?: number }>;
  lockedRooms?: Array<{ unlocked?: boolean; door: Rect }>;
};
type GrenadeAim = { target: { x: number; y: number }; power: number } | null;
type RaidSnapshot = {
  map: RaidMap;
  camera: { x: number; y: number };
  player: PointEntity;
  enemies: PointEntity[];
  crates: PointEntity[];
  corpses: PointEntity[];
  groundItems: PointEntity[];
  bullets: PointEntity[];
  thrownGrenades: PointEntity[];
  smokeClouds: PointEntity[];
  explosionEffects: PointEntity[];
  muzzleFlashes: PointEntity[];
  particles: PointEntity[];
  grenadeAim: GrenadeAim;
  gameTime: number;
  screenShake: number;
};

const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const CAMERA_HEIGHT = 1050;
const CAMERA_TRAIL = 760;
const CAMERA_LOOK_AHEAD = 125;
const tempMatrix = new THREE.Matrix4();
const tempColor = new THREE.Color();

function color(value: string | undefined, fallback: number): THREE.ColorRepresentation {
  return value?.startsWith('#') ? value : fallback;
}

function shadow(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function makeDuck(bodyColor: number, vestColor: number): THREE.Group {
  const group = new THREE.Group();
  const feather = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.82 });
  const vest = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.72, metalness: 0.08 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf2a23a, roughness: 0.76 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17201e, roughness: 0.62, metalness: 0.18 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 9), feather);
  body.scale.set(1.12, 1.18, 0.86);
  body.position.y = 23;
  const armor = new THREE.Mesh(new THREE.BoxGeometry(25, 20, 31), vest);
  armor.position.set(-2, 22, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(13, 12, 9), feather);
  head.position.set(16, 43, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(8, 18, 4), orange);
  beak.rotation.z = -Math.PI / 2;
  beak.rotation.y = Math.PI / 4;
  beak.position.set(31, 40, 0);
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(50, 5, 6), dark);
  rifle.position.set(18, 25, -18);
  group.add(body, armor, head, beak, rifle);

  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(13, 3, 10), orange);
    foot.position.set(-4, 2, side * 10);
    group.add(foot);
  }
  shadow(group);
  return group;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

class ThreeRaidRenderer implements DuckThreeRaidBridge {
  ready = false;
  active = false;
  renderer = 'unavailable';
  cameraMode = 'Perspective 2.5D';
  visualMode = 'GrassMud + FauxFloors + AdditiveTracers';
  revision = THREE.REVISION;
  objectCount = 0;
  frameCount = 0;
  reason?: string;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(41, VIEW_WIDTH / VIEW_HEIGHT, 1, 4200);
  private readonly webgl: THREE.WebGLRenderer;
  private readonly staticRoot = new THREE.Group();
  private readonly dynamicRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly actorPool: THREE.Group[] = [];
  private readonly enemyVisionPool: THREE.Mesh[] = [];
  private readonly cratePool: THREE.Group[] = [];
  private readonly bulletPool: THREE.Group[] = [];
  private readonly grenadePool: THREE.Mesh[] = [];
  private readonly smokePool: THREE.Mesh[] = [];
  private readonly explosionPool: THREE.Mesh[] = [];
  private readonly flashPool: THREE.Mesh[] = [];
  private readonly particlePool: THREE.Mesh[] = [];
  private readonly corpsePool: THREE.Mesh[] = [];
  private readonly itemPool: THREE.Mesh[] = [];
  private readonly grenadeAim = new THREE.Group();
  private readonly aimDots: THREE.Mesh[] = [];
  private readonly extraction = new THREE.Group();
  private mapReference: RaidMap | null = null;
  private mapStateKey = '';
  private readonly extractionRings: THREE.Mesh[] = [];
  private readonly roofEntries: Array<{
    mesh: THREE.Mesh;
    area: Building;
    opacity: number;
    wallMaterial: THREE.MeshStandardMaterial;
    facadeMaterials: Array<{ material: THREE.MeshStandardMaterial; opacity: number }>;
  }> = [];
  private lastCameraCenter = new THREE.Vector2();

  constructor(private readonly container: HTMLElement, private readonly stage: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.webgl.setSize(VIEW_WIDTH, VIEW_HEIGHT, false);
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.28;
    this.webgl.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.webgl.domElement);

    this.scene.background = new THREE.Color(0xb8d5dd);
    this.scene.fog = new THREE.Fog(0xb8d5dd, 1750, 3400);
    this.scene.add(this.staticRoot, this.dynamicRoot);
    this.configureLights();
    this.createAimGuide();
    this.dynamicRoot.add(this.grenadeAim, this.extraction);
    this.positionCamera(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, 0, 0, true);
    this.webgl.render(this.scene, this.camera);
    this.renderer = this.webgl.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL';
    this.ready = true;
  }

  private configureLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xf0f8ff, 0x61705d, 3.25));
    const sun = new THREE.DirectionalLight(0xfff1cf, 4.65);
    sun.position.set(-900, 1600, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -850;
    sun.shadow.camera.right = 850;
    sun.shadow.camera.top = 750;
    sun.shadow.camera.bottom = -750;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 2600;
    sun.shadow.bias = -0.00018;
    this.scene.add(sun);
  }

  private createAimGuide(): void {
    const dotGeometry = new THREE.SphereGeometry(4, 8, 6);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xf7f0d0 });
    for (let index = 0; index < 14; index += 1) {
      const dot = new THREE.Mesh(dotGeometry, index === 13
        ? new THREE.MeshBasicMaterial({ color: 0xffc94d })
        : dotMaterial);
      this.aimDots.push(dot);
      this.grenadeAim.add(dot);
    }
    this.grenadeAim.visible = false;
  }

  private positionCamera(centerX: number, centerY: number, angle: number, shake: number, snap = false): void {
    const targetX = centerX + Math.cos(angle) * CAMERA_LOOK_AHEAD;
    const targetY = centerY + Math.sin(angle) * CAMERA_LOOK_AHEAD;
    if (snap) this.lastCameraCenter.set(targetX, targetY);
    else this.lastCameraCenter.lerp(new THREE.Vector2(targetX, targetY), 0.12);
    const jitterX = shake ? Math.sin(performance.now() * 0.071) * shake : 0;
    const jitterY = shake ? Math.cos(performance.now() * 0.083) * shake : 0;
    const focusX = this.lastCameraCenter.x + jitterX;
    const focusY = this.lastCameraCenter.y + jitterY;
    this.camera.position.set(focusX, CAMERA_HEIGHT, focusY + CAMERA_TRAIL);
    this.camera.lookAt(focusX, 18, focusY);
    this.camera.updateMatrixWorld();
  }

  private mapKey(map: RaidMap): string {
    const locks = map.lockedRooms?.map((room) => room.unlocked ? '1' : '0').join('') ?? '';
    return `${map.id}:${map.walls?.length ?? 0}:${map.bushes?.length ?? 0}:${map.extractions?.length ?? 1}:${locks}`;
  }

  private rebuildMap(map: RaidMap): void {
    disposeTree(this.staticRoot);
    this.staticRoot.clear();
    this.roofEntries.length = 0;
    this.scene.background = new THREE.Color(map.id === 'port' ? 0xb6d2e6 : map.id === 'wetland' ? 0xb9ddd3 : 0xc8dccb);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.scene.background);

    const groundColor = new THREE.Color(color(map.palette.ground, 0x4f654d)).offsetHSL(0, 0.02, 0.015);
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(map.world.w, 8, map.world.h),
      new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 })
    );
    ground.position.set(map.world.w / 2, -5, map.world.h / 2);
    ground.receiveShadow = true;
    this.staticRoot.add(ground);
    this.addTerrainDetails(map);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343a36, roughness: 1 });
    map.roads.forEach((road) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(road.w, 2, road.h), roadMaterial);
      mesh.position.set(road.x + road.w / 2, 0.25, road.y + road.h / 2);
      mesh.receiveShadow = true;
      this.staticRoot.add(mesh);
    });
    this.addRoadMarkings(map.roads);

    const waterMaterial = new THREE.MeshStandardMaterial({ color: color(map.palette.water, 0x174b59), roughness: 0.22, metalness: 0.12, transparent: true, opacity: 0.9 });
    map.waterZones.forEach((water) => {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 36), waterMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(water.rx, water.ry, 1);
      mesh.position.set(water.x, 1.4, water.y);
      this.staticRoot.add(mesh);
      const shore = new THREE.Mesh(
        new THREE.RingGeometry(0.91, 1, 40),
        new THREE.MeshBasicMaterial({ color: 0x88a694, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false })
      );
      shore.rotation.x = -Math.PI / 2;
      shore.scale.set(water.rx, water.ry, 1);
      shore.position.set(water.x, 1.8, water.y);
      this.staticRoot.add(shore);
    });

    const buildings = map.buildings?.length ? map.buildings : map.buildingSpecs ?? [];
    const floorMaterial = new THREE.MeshStandardMaterial({ color: color(map.palette.floor, 0x58685f), roughness: 0.94 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: color(map.palette.top, 0x68736e), roughness: 0.76, metalness: 0.08, transparent: true, opacity: 0.34, depthWrite: false });
    const lockedRoofMaterial = new THREE.MeshStandardMaterial({ color: 0xa97a32, roughness: 0.68, transparent: true, opacity: 0.48, depthWrite: false });
    const buildingWallMaterials = buildings.map(() => {
      const material = new THREE.MeshStandardMaterial({ color: color(map.palette.wall, 0x29332f), roughness: 0.84, transparent: true, opacity: 1 });
      return material;
    });
    buildings.forEach((building, index) => {
      const floorCount = index % 3 === 0 || building.locked ? 3 : 2;
      const height = floorCount * 48 + (building.visualHeight ?? 22) * 0.45;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, building.w - 90), 2, Math.max(1, building.h - 90)), floorMaterial);
      floor.position.set(building.x + building.w / 2, 1.1, building.y + building.h / 2);
      floor.receiveShadow = true;
      const roofBase = building.locked ? lockedRoofMaterial : roofMaterial;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(building.w + 16, 6, building.h + 16), roofBase.clone());
      roof.position.set(building.x + building.w / 2, height + 3, building.y + building.h / 2);
      roof.castShadow = true;
      const facadeMaterials: Array<{ material: THREE.MeshStandardMaterial; opacity: number }> = [];
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: building.locked ? 0xa98244 : 0x4d7180,
        emissive: building.locked ? 0x4b2f10 : 0x162c36,
        emissiveIntensity: 0.42,
        roughness: 0.3,
        metalness: 0.22,
        transparent: true,
        opacity: 0.76
      });
      const bandMaterial = new THREE.MeshStandardMaterial({
        color: building.locked ? 0x8a7045 : 0x87928b,
        roughness: 0.82,
        transparent: true,
        opacity: 0.88
      });
      facadeMaterials.push({ material: windowMaterial, opacity: windowMaterial.opacity });
      facadeMaterials.push({ material: bandMaterial, opacity: bandMaterial.opacity });
      const storyHeight = height / floorCount;
      for (let level = 1; level <= floorCount; level += 1) {
        const windowY = Math.min(height - 17, storyHeight * level - storyHeight * 0.42);
        const southWindows = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(80, building.w * 0.62), Math.min(21, storyHeight * 0.28), 3.2),
          windowMaterial
        );
        southWindows.position.set(building.x + building.w / 2, windowY, building.y + building.h + 1.8);
        const eastWindows = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, Math.min(21, storyHeight * 0.28), Math.max(80, building.h * 0.56)),
          windowMaterial
        );
        eastWindows.position.set(building.x + building.w + 1.8, windowY, building.y + building.h / 2);
        this.staticRoot.add(southWindows, eastWindows);
        if (level < floorCount) {
          const bandY = storyHeight * level;
          const southBand = new THREE.Mesh(new THREE.BoxGeometry(building.w + 7, 4.5, 5), bandMaterial);
          southBand.position.set(building.x + building.w / 2, bandY, building.y + building.h + 2.5);
          const eastBand = new THREE.Mesh(new THREE.BoxGeometry(5, 4.5, building.h + 7), bandMaterial);
          eastBand.position.set(building.x + building.w + 2.5, bandY, building.y + building.h / 2);
          this.staticRoot.add(southBand, eastBand);
        }
      }
      this.roofEntries.push({
        mesh: roof,
        area: building,
        opacity: roofBase.opacity,
        wallMaterial: buildingWallMaterials[index],
        facadeMaterials
      });
      const rooftopUnit = new THREE.Mesh(
        new THREE.BoxGeometry(46 + index % 3 * 12, 14 + index % 2 * 5, 34 + index % 4 * 8),
        new THREE.MeshStandardMaterial({ color: index % 2 ? 0x485551 : 0x66716c, roughness: 0.72, metalness: 0.24 })
      );
      rooftopUnit.position.set(building.x + building.w * (index % 2 ? 0.34 : 0.66), height + 13, building.y + building.h * (index % 3 ? 0.38 : 0.62));
      shadow(rooftopUnit);
      this.staticRoot.add(floor, roof, rooftopUnit);
    });

    const wallMaterial = new THREE.MeshStandardMaterial({ color: color(map.palette.wall, 0x29332f), roughness: 0.84 });
    (map.walls ?? []).forEach((wall) => {
      if (wall.visualKind === 'prop' || wall.visualKind === 'fence') return;
      const building = wall.buildingIndex == null ? null : buildings[wall.buildingIndex];
      const floorCount = wall.buildingIndex != null && (wall.buildingIndex % 3 === 0 || building?.locked) ? 3 : 2;
      const height = wall.buildingIndex == null ? 32 : floorCount * 48 + (building?.visualHeight ?? 22) * 0.45;
      const material = wall.buildingIndex == null ? wallMaterial : buildingWallMaterials[wall.buildingIndex] ?? wallMaterial;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, height, wall.h), material);
      mesh.position.set(wall.x + wall.w / 2, height / 2, wall.y + wall.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.staticRoot.add(mesh);
    });

    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0xc08b38, roughness: 0.58, metalness: 0.18 });
    map.lockedRooms?.forEach((room) => {
      if (room.unlocked) return;
      const door = room.door;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(door.w, 44, door.h), doorMaterial);
      mesh.position.set(door.x + door.w / 2, 22, door.y + door.h / 2);
      shadow(mesh);
      this.staticRoot.add(mesh);
    });

    this.addTrees(map.bushes ?? []);
    this.addProps(map);
    this.buildExtractions(map.extractions?.length ? map.extractions : [map.extraction]);
    this.mapReference = map;
    this.mapStateKey = this.mapKey(map);
    this.updateObjectCount();
  }

  private addTerrainDetails(map: RaidMap): void {
    const seed = Array.from(map.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const pseudo = (index: number, salt: number): number => {
      const value = Math.sin((index + 1) * 12.9898 + seed * 0.173 + salt * 31.417) * 43758.5453;
      return value - Math.floor(value);
    };
    const points: Array<{ x: number; y: number; scaleX: number; scaleY: number; shade: number; angle: number }> = [];
    for (let index = 0; index < 760 && points.length < 340; index += 1) {
      const x = 180 + pseudo(index, 1) * (map.world.w - 360);
      const y = 180 + pseudo(index, 2) * (map.world.h - 360);
      const onRoad = map.roads.some((road) => x > road.x - 80 && x < road.x + road.w + 80 && y > road.y - 80 && y < road.y + road.h + 80);
      const inWater = map.waterZones.some((water) => {
        const dx = (x - water.x) / water.rx;
        const dy = (y - water.y) / water.ry;
        return dx * dx + dy * dy < 1.08;
      });
      if (onRoad || inWater) continue;
      points.push({ x, y, scaleX: 115 + pseudo(index, 3) * 270, scaleY: 80 + pseudo(index, 4) * 210, shade: pseudo(index, 5), angle: pseudo(index, 6) * Math.PI });
    }
    if (!points.length) return;
    const patches = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.42, depthWrite: false }),
      points.length
    );
    const terrainColors = map.id === 'wetland'
      ? [0x3e684d, 0x55734e, 0x66583c, 0x806b47]
      : map.id === 'port'
        ? [0x425f48, 0x536a49, 0x66543c, 0x796246]
        : [0x486642, 0x5c7049, 0x6b583b, 0x826a45];
    const rotation = new THREE.Quaternion();
    points.forEach((point, index) => {
      rotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, point.angle));
      tempMatrix.compose(new THREE.Vector3(point.x, 0.15, point.y), rotation, new THREE.Vector3(point.scaleX, point.scaleY, 1));
      patches.setMatrixAt(index, tempMatrix);
      tempColor.set(terrainColors[Math.min(terrainColors.length - 1, Math.floor(point.shade * terrainColors.length))]);
      patches.setColorAt(index, tempColor);
    });
    patches.instanceMatrix.needsUpdate = true;
    patches.instanceColor!.needsUpdate = true;
    patches.receiveShadow = true;
    this.staticRoot.add(patches);
  }

  private addRoadMarkings(roads: Rect[]): void {
    const marks: Array<{ x: number; y: number; vertical: boolean }> = [];
    roads.forEach((road) => {
      if (Math.min(road.w, road.h) < 170) return;
      const horizontal = road.w >= road.h;
      const length = horizontal ? road.w : road.h;
      for (let offset = 150; offset < length - 100 && marks.length < 460; offset += 260) {
        marks.push({
          x: horizontal ? road.x + offset : road.x + road.w / 2,
          y: horizontal ? road.y + road.h / 2 : road.y + offset,
          vertical: !horizontal
        });
      }
    });
    if (!marks.length) return;
    const markings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(104, 1.2, 7),
      new THREE.MeshBasicMaterial({ color: 0xe0cc79, transparent: true, opacity: 0.5 }),
      marks.length
    );
    const rotation = new THREE.Quaternion();
    marks.forEach((mark, index) => {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), mark.vertical ? Math.PI / 2 : 0);
      tempMatrix.compose(new THREE.Vector3(mark.x, 1.7, mark.y), rotation, new THREE.Vector3(1, 1, 1));
      markings.setMatrixAt(index, tempMatrix);
    });
    markings.instanceMatrix.needsUpdate = true;
    this.staticRoot.add(markings);
  }

  private addTrees(trees: Array<[number, number, number]>): void {
    if (!trees.length) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(7, 10, 44, 6),
      new THREE.MeshStandardMaterial({ color: 0x5c4531, roughness: 1 }),
      trees.length
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(30, 74, 7),
      new THREE.MeshStandardMaterial({ color: 0x244f31, roughness: 0.96 }),
      trees.length
    );
    trees.forEach(([x, y, radius], index) => {
      const scale = Math.max(0.72, radius / 38);
      tempMatrix.compose(new THREE.Vector3(x, 22 * scale, y), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(index, tempMatrix);
      tempMatrix.compose(new THREE.Vector3(x, 72 * scale, y), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      crowns.setMatrixAt(index, tempMatrix);
      tempColor.set(index % 3 === 0 ? 0x2f633c : index % 3 === 1 ? 0x244f31 : 0x385f3b);
      crowns.setColorAt(index, tempColor);
    });
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    crowns.instanceColor!.needsUpdate = true;
    this.staticRoot.add(trunks, crowns);
  }

  private addProps(map: RaidMap): void {
    const vehicleColors = [0x59666d, 0x765645, 0x46636c, 0x676548, 0x593e48];
    map.vehicles?.forEach((vehicle, index) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(vehicle.w, 24, vehicle.h), new THREE.MeshStandardMaterial({ color: vehicleColors[vehicle.type ?? index % vehicleColors.length], roughness: 0.7, metalness: 0.15 }));
      body.position.y = 15;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(vehicle.horizontal ? 42 : Math.max(20, vehicle.w - 16), 17, vehicle.horizontal ? Math.max(20, vehicle.h - 16) : 42), new THREE.MeshStandardMaterial({ color: 0x9eb5bb, roughness: 0.3, metalness: 0.12 }));
      cabin.position.y = 35;
      group.position.set(vehicle.x, 0, vehicle.y);
      group.add(body, cabin);
      shadow(group);
      this.staticRoot.add(group);
    });
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x626966, roughness: 1 });
    map.rocks?.forEach((rock, index) => {
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(rock.r, 0), rockMaterial);
      mesh.scale.y = 0.58 + index % 3 * 0.08;
      mesh.rotation.y = index * 1.73;
      mesh.position.set(rock.x, rock.r * 0.48, rock.y);
      shadow(mesh);
      this.staticRoot.add(mesh);
    });
    const coverMaterials = [0x9a8055, 0x747b78, 0x52664f, 0x9b5b42].map((value) => new THREE.MeshStandardMaterial({ color: value, roughness: 0.9 }));
    map.coverProps?.forEach((cover) => {
      const type = cover.type ?? 0;
      const group = new THREE.Group();
      group.position.set(cover.x, 0, cover.y);
      if (type === 0) {
        for (let row = 0; row < 2; row += 1) for (let part = 0; part < 3 - row; part += 1) {
          const bag = new THREE.Mesh(new THREE.SphereGeometry(12, 8, 6), coverMaterials[0]);
          bag.scale.set(Math.max(1.3, cover.w / 72), 0.48, 0.72);
          bag.position.set((part - (2 - row) / 2) * cover.w * 0.31, 7 + row * 10, 0);
          group.add(bag);
        }
      } else if (type === 1) {
        const barrier = new THREE.Mesh(new THREE.BoxGeometry(cover.w, 27, cover.h), coverMaterials[1]);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(cover.w * 0.78, 12, cover.h * 0.72), coverMaterials[1]);
        barrier.position.y = 13.5;cap.position.y = 33;group.add(barrier, cap);
      } else {
        const base = new THREE.Mesh(new THREE.BoxGeometry(cover.w, type === 3 ? 30 : 22, cover.h), coverMaterials[type]);
        base.position.y = type === 3 ? 15 : 11;group.add(base);
      }
      shadow(group);
      this.staticRoot.add(group);
    });
    this.addGrass(map.grassPatches ?? []);
    this.addFences(map.fences ?? []);
    this.addStreetLights(map.streetLights ?? []);
  }

  private addGrass(grass: PointEntity[]): void {
    if (!grass.length) return;
    const tufts = new THREE.InstancedMesh(
      new THREE.ConeGeometry(7, 28, 5),
      new THREE.MeshStandardMaterial({ color: 0x5f8b49, roughness: 1 }),
      grass.length
    );
    grass.forEach((patch, index) => {
      const scale = patch.scale ?? 1;
      tempMatrix.compose(new THREE.Vector3(patch.x, 12 * scale, patch.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.83), new THREE.Vector3(scale, scale, scale));
      tufts.setMatrixAt(index, tempMatrix);
      tempColor.set(index % 3 === 0 ? 0x73994e : index % 3 === 1 ? 0x4f7c43 : 0x87a85b);
      tufts.setColorAt(index, tempColor);
    });
    tufts.instanceMatrix.needsUpdate = true;
    tufts.instanceColor!.needsUpdate = true;
    tufts.castShadow = true;
    this.staticRoot.add(tufts);
  }

  private addFences(fences: Array<PointEntity & { w: number; h: number; horizontal?: boolean; type?: number }>): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7c6547, roughness: 0.96 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x7f9190, roughness: 0.55, metalness: 0.42 });
    fences.forEach((fence) => {
      const group = new THREE.Group();
      const horizontal = fence.horizontal !== false;
      const length = horizontal ? fence.w : fence.h;
      const material = fence.type === 0 ? wood : metal;
      const postCount = fence.type === 0 ? 4 : 7;
      for (let index = 0; index < postCount; index += 1) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(7, fence.type === 0 ? 48 : 58, 7), material);
        const offset = -length / 2 + length * index / (postCount - 1);
        post.position.set(horizontal ? offset : 0, fence.type === 0 ? 24 : 29, horizontal ? 0 : offset);
        group.add(post);
      }
      for (const height of fence.type === 0 ? [17, 38] : [12, 28, 46]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 5, 5, horizontal ? 5 : length), material);
        rail.position.y = height;
        group.add(rail);
      }
      group.position.set(fence.x, 0, fence.y);
      shadow(group);
      this.staticRoot.add(group);
    });
  }

  private addStreetLights(lights: Array<PointEntity & { horizontal?: boolean; type?: number }>): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x495655, roughness: 0.5, metalness: 0.48 });
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe8a8, emissive: 0xffd470, emissiveIntensity: 0.75, roughness: 0.3 });
    lights.forEach((light, index) => {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 96, 7), poleMaterial);
      pole.position.y = 48;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(light.horizontal ? 30 : 6, 5, light.horizontal ? 6 : 30), poleMaterial);
      arm.position.set(light.horizontal ? (index % 2 ? -13 : 13) : 0, 94, light.horizontal ? 0 : (index % 2 ? -13 : 13));
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(15, 6, 12), lampMaterial);
      lamp.position.set(light.horizontal ? (index % 2 ? -26 : 26) : 0, 91, light.horizontal ? 0 : (index % 2 ? -26 : 26));
      group.position.set(light.x, 0, light.y);
      group.add(pole, arm, lamp);
      shadow(group);
      this.staticRoot.add(group);
    });
  }

  private buildExtractions(areas: Array<Rect & { active?: boolean }>): void {
    disposeTree(this.extraction);
    this.extraction.clear();
    this.extractionRings.length = 0;
    areas.forEach((area, index) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.min(area.w, area.h) * 0.28, Math.min(area.w, area.h) * 0.34, 48),
        new THREE.MeshBasicMaterial({ color: 0x4b5952, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = index * 0.4;
      ring.position.set(area.x + area.w / 2, 4, area.y + area.h / 2);
      this.extractionRings.push(ring);
      this.extraction.add(ring);
    });
  }

  private updateExtraction(map: RaidMap, time: number): void {
    const areas = map.extractions?.length ? map.extractions : [map.extraction];
    this.extractionRings.forEach((ring, index) => {
      const active = areas[index]?.active ?? map.extraction.active;
      const material = ring.material as THREE.MeshBasicMaterial;
      material.color.set(active ? 0x62f28a : 0x69756f);
      material.opacity = active ? 0.66 + Math.sin(time * 4 + index) * 0.14 : 0.34;
      const pulse = 1 + Math.sin(time * 3.5 + index) * 0.055;
      ring.scale.setScalar(pulse);
      ring.rotation.z += active ? 0.004 : 0.001;
    });
  }

  private ensureActor(index: number, player: boolean, entity?: PointEntity): THREE.Group {
    while (this.actorPool.length <= index) {
      const isPlayer = this.actorPool.length === 0;
      const actor = makeDuck(isPlayer ? 0xf1e5c5 : 0xd9d1b8, isPlayer ? 0x2f6680 : 0x74433c);
      const healthBack = new THREE.Mesh(new THREE.BoxGeometry(42, 3, 3), new THREE.MeshBasicMaterial({ color: 0x251515 }));
      healthBack.name = 'healthBack';
      healthBack.position.set(0, 62, 0);
      const health = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 4), new THREE.MeshBasicMaterial({ color: isPlayer ? 0x66c9ff : 0xff665f }));
      health.name = 'health';
      health.position.set(0, 62.5, -1);
      actor.add(healthBack, health);
      this.dynamicRoot.add(actor);
      this.actorPool.push(actor);
    }
    const actor = this.actorPool[index];
    if (!player && entity?.kind === 'boss') actor.scale.setScalar(1.32);
    else if (!player && entity?.kind === 'elite') actor.scale.setScalar(1.12);
    else actor.scale.setScalar(1);
    return actor;
  }

  private syncActors(snapshot: RaidSnapshot): void {
    const actors = [snapshot.player, ...snapshot.enemies];
    actors.forEach((entity, index) => {
      const actor = this.ensureActor(index, index === 0, entity);
      actor.visible = !entity.dead;
      actor.position.set(entity.x, 2, entity.y);
      actor.rotation.y = -(entity.angle ?? 0);
      const health = actor.getObjectByName('health');
      const healthBack = actor.getObjectByName('healthBack');
      const ratio = Math.max(0.02, Math.min(1, (entity.hp ?? 1) / Math.max(1, entity.maxHp ?? 1)));
      if (health) {
        health.visible = index !== 0 && ratio < 0.999;
        health.scale.x = ratio;
        health.position.x = -20 * (1 - ratio);
      }
      if (healthBack) healthBack.visible = index !== 0 && ratio < 0.999;
    });
    for (let index = actors.length; index < this.actorPool.length; index += 1) this.actorPool[index].visible = false;
    snapshot.enemies.forEach((enemy, index) => {
      while (this.enemyVisionPool.length <= index) {
        const geometry = new THREE.CircleGeometry(1, 28, -0.58, 1.16);
        geometry.rotateX(-Math.PI / 2);
        const cone = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({ color: 0xff6b52, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false })
        );
        cone.renderOrder = 1;
        this.enemyVisionPool.push(cone);
        this.dynamicRoot.add(cone);
      }
      const cone = this.enemyVisionPool[index];
      const distance = Math.hypot(enemy.x - snapshot.player.x, enemy.y - snapshot.player.y);
      cone.visible = !enemy.dead && distance < 1150;
      cone.position.set(enemy.x, 2.1, enemy.y);
      cone.rotation.set(0, -(enemy.angle ?? 0), 0);
      const range = enemy.vision ?? 620;
      cone.scale.set(range, range, range);
      (cone.material as THREE.MeshBasicMaterial).opacity = (enemy.alertTimer ?? 0) > 0 ? 0.095 : 0.035;
    });
    for (let index = snapshot.enemies.length; index < this.enemyVisionPool.length; index += 1) this.enemyVisionPool[index].visible = false;
  }

  private syncCrates(crates: PointEntity[]): void {
    crates.forEach((crate, index) => {
      while (this.cratePool.length <= index) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(58, 24, 38), new THREE.MeshStandardMaterial({ color: 0x3f5d4c, roughness: 0.76, metalness: 0.12 }));
        body.name = 'body';
        body.position.y = 13;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(61, 8, 41), new THREE.MeshStandardMaterial({ color: 0x668270, roughness: 0.72 }));
        lid.name = 'lid';
        lid.position.y = 29;
        group.add(body, lid);
        shadow(group);
        this.cratePool.push(group);
        this.dynamicRoot.add(group);
      }
      const group = this.cratePool[index];
      group.visible = true;
      group.position.set(crate.x, 1, crate.y);
      group.scale.setScalar(crate.rare ? 1.18 : 1);
      const body = group.getObjectByName('body') as THREE.Mesh;
      const lid = group.getObjectByName('lid') as THREE.Mesh;
      (body.material as THREE.MeshStandardMaterial).color.set(crate.rare ? 0x792f32 : crate.containsQuest ? 0x596482 : 0x3f5d4c);
      lid.rotation.z = crate.opened ? -0.72 : 0;
      lid.position.set(crate.opened ? -8 : 0, crate.opened ? 36 : 29, 0);
    });
    for (let index = crates.length; index < this.cratePool.length; index += 1) this.cratePool[index].visible = false;
  }

  private syncMeshPool(
    entities: PointEntity[],
    pool: THREE.Mesh[],
    factory: () => THREE.Mesh,
    update: (mesh: THREE.Mesh, entity: PointEntity, index: number) => void
  ): void {
    entities.forEach((entity, index) => {
      while (pool.length <= index) {
        const mesh = factory();
        pool.push(mesh);
        this.dynamicRoot.add(mesh);
      }
      pool[index].visible = true;
      update(pool[index], entity, index);
    });
    for (let index = entities.length; index < pool.length; index += 1) pool[index].visible = false;
  }

  private syncBullets(bullets: PointEntity[]): void {
    bullets.forEach((bullet, index) => {
      while (this.bulletPool.length <= index) {
        const group = new THREE.Group();
        const glow = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xff321f, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        glow.name = 'glow';
        const tail = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.58, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        tail.name = 'tail';
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xfff2a6, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        core.name = 'core';
        const head = new THREE.Mesh(
          new THREE.ConeGeometry(1, 1, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        head.name = 'head';
        head.geometry.rotateZ(-Math.PI / 2);
        group.add(glow, tail, core, head);
        this.bulletPool.push(group);
        this.dynamicRoot.add(group);
      }
      const group = this.bulletPool[index];
      const angle = Math.atan2(bullet.vy ?? 0, bullet.vx ?? 1);
      const id = bullet.weaponId ?? '';
      const length = /anti|marksman/i.test(id) ? 68 : /pistol/i.test(id) ? 21 : /smg|compact/i.test(id) ? 31 : 45;
      const thickness = Math.max(2.8, Math.min(5.4, bullet.r ? bullet.r * 1.25 : 3.5));
      const hostile = bullet.owner !== 'player';
      group.visible = true;
      group.position.set(bullet.x, 20, bullet.y);
      group.rotation.y = -angle;
      const glow = group.getObjectByName('glow') as THREE.Mesh;
      glow.position.x = -length * 0.22;
      glow.scale.set(length * 1.32, thickness * 2.7, thickness * 2.1);
      const glowMaterial = glow.material as THREE.MeshBasicMaterial;
      glowMaterial.color.set(hostile ? 0xff2419 : 0xff3d18);
      glowMaterial.opacity = hostile ? 0.24 : 0.18;
      const tail = group.getObjectByName('tail') as THREE.Mesh;
      tail.position.x = -length * 0.2;
      tail.scale.set(length, thickness * 1.15, thickness * 0.92);
      (tail.material as THREE.MeshBasicMaterial).color.set(hostile ? 0xff301b : 0xff6a22);
      const core = group.getObjectByName('core') as THREE.Mesh;
      core.position.x = length * 0.08;
      core.scale.set(length * 0.56, thickness * 0.48, thickness * 0.42);
      const head = group.getObjectByName('head') as THREE.Mesh;
      head.position.x = length * 0.43;
      head.scale.set(length * 0.22, thickness * 1.15, thickness * 1.15);
    });
    for (let index = bullets.length; index < this.bulletPool.length; index += 1) this.bulletPool[index].visible = false;
  }

  private syncEffects(snapshot: RaidSnapshot): void {
    this.syncBullets(snapshot.bullets);

    this.syncMeshPool(snapshot.thrownGrenades, this.grenadePool,
      () => new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), new THREE.MeshStandardMaterial({ color: 0x526047, roughness: 0.7, metalness: 0.16 })),
      (mesh, grenade) => {
        mesh.position.set(grenade.x, 9 + (grenade.z ?? 0), grenade.y);
        (mesh.material as THREE.MeshStandardMaterial).color.set(grenade.id === 'flashGrenade' ? 0xe6d86b : grenade.id === 'smokeGrenade' ? 0xc4ced0 : 0x526047);
      });

    this.syncMeshPool(snapshot.smokeClouds, this.smokePool,
      () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), new THREE.MeshStandardMaterial({ color: 0xb8c4be, transparent: true, opacity: 0.24, depthWrite: false })),
      (mesh, smoke, index) => {
        const radius = smoke.radius ?? 20;
        mesh.position.set(smoke.x + Math.sin(index * 2.3) * radius * 0.16, 32 + index % 3 * 11, smoke.y + Math.cos(index * 1.7) * radius * 0.13);
        mesh.scale.set(radius * 0.72, radius * 0.42, radius * 0.62);
        (mesh.material as THREE.MeshStandardMaterial).opacity = 0.18 + Math.min(0.2, (smoke.age ?? 0) * 0.08);
      });

    this.syncMeshPool(snapshot.explosionEffects, this.explosionPool,
      () => new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })),
      (mesh, effect) => {
        const progress = Math.min(1, (effect.age ?? 0) / Math.max(0.01, effect.life ?? 1));
        const radius = effect.type === 'fragGrenade' ? 35 + progress * 150 : 55 + progress * 220;
        mesh.position.set(effect.x, 28, effect.y);
        mesh.scale.setScalar(radius);
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.set(effect.type === 'fragGrenade' ? 0xff7a24 : 0xf7fbff);
        material.opacity = Math.max(0, 0.85 * (1 - progress));
      });

    this.syncMeshPool(snapshot.muzzleFlashes, this.flashPool,
      () => {
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(9, 38, 6), new THREE.MeshBasicMaterial({ color: 0xffc44f, transparent: true, blending: THREE.AdditiveBlending }));
        mesh.geometry.rotateZ(-Math.PI / 2);
        return mesh;
      },
      (mesh, flash) => {
        mesh.position.set(flash.x, 25, flash.y);
        mesh.rotation.y = -(flash.angle ?? 0);
        mesh.scale.setScalar(flash.scale ?? 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - (flash.age ?? 0) / Math.max(0.01, flash.life ?? 0.1));
      });

    this.syncMeshPool(snapshot.particles.slice(0, 90), this.particlePool,
      () => new THREE.Mesh(new THREE.SphereGeometry(3, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd36a })),
      (mesh, particle) => {
        mesh.position.set(particle.x, 10, particle.y);
        (mesh.material as THREE.MeshBasicMaterial).color.set(particle.type === 'blood' ? 0x9b3131 : particle.type === 'spark' ? 0xffd36a : 0xfff0a8);
      });

    this.syncMeshPool(snapshot.corpses, this.corpsePool,
      () => new THREE.Mesh(new THREE.CapsuleGeometry(11, 28, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4d3431, roughness: 0.96 })),
      (mesh, corpse) => {
        mesh.position.set(corpse.x, 7, corpse.y);
        mesh.rotation.set(Math.PI / 2, 0, -(corpse.angle ?? 0));
      });

    this.syncMeshPool(snapshot.groundItems, this.itemPool,
      () => new THREE.Mesh(new THREE.OctahedronGeometry(10), new THREE.MeshStandardMaterial({ color: 0xe1c85e, emissive: 0x4c3b0e, roughness: 0.55 })),
      (mesh, item, index) => {
        mesh.position.set(item.x, 14 + Math.sin(snapshot.gameTime * 3 + index) * 4, item.y);
        mesh.rotation.y = snapshot.gameTime + index;
      });
  }

  private updateGrenadeAim(snapshot: RaidSnapshot): void {
    const aim = snapshot.grenadeAim;
    this.grenadeAim.visible = !!aim;
    if (!aim) return;
    this.aimDots.forEach((dot, index) => {
      const t = (index + 1) / this.aimDots.length;
      dot.position.set(
        snapshot.player.x + (aim.target.x - snapshot.player.x) * t,
        7 + Math.sin(t * Math.PI) * (26 + aim.power * 72),
        snapshot.player.y + (aim.target.y - snapshot.player.y) * t
      );
      dot.scale.setScalar(index === this.aimDots.length - 1 ? 1.7 : 1);
    });
  }

  private updateRoofOcclusion(player: PointEntity): void {
    this.roofEntries.forEach((entry) => {
      const margin = 34;
      const inside = player.x > entry.area.x - margin
        && player.x < entry.area.x + entry.area.w + margin
        && player.y > entry.area.y - margin
        && player.y < entry.area.y + entry.area.h + margin;
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      const targetOpacity = inside ? 0.07 : entry.opacity;
      material.opacity += (targetOpacity - material.opacity) * 0.18;
      entry.mesh.castShadow = !inside;
      entry.wallMaterial.opacity += ((inside ? 0.13 : 1) - entry.wallMaterial.opacity) * 0.2;
      entry.wallMaterial.depthWrite = !inside;
      entry.facadeMaterials.forEach(({ material: facadeMaterial, opacity }) => {
        facadeMaterial.opacity += ((inside ? 0.035 : opacity) - facadeMaterial.opacity) * 0.2;
        facadeMaterial.depthWrite = !inside;
      });
    });
  }

  private updateObjectCount(): void {
    let count = 0;
    this.scene.traverse(() => { count += 1; });
    this.objectCount = count;
  }

  render(value: unknown): boolean {
    if (!this.ready || !value || typeof value !== 'object') return false;
    const snapshot = value as RaidSnapshot;
    if (!snapshot.map || !snapshot.player || !snapshot.camera) return false;
    const key = this.mapKey(snapshot.map);
    if (this.mapReference !== snapshot.map || this.mapStateKey !== key) this.rebuildMap(snapshot.map);
    const enteringRaid = !this.active;
    this.active = true;
    this.stage.classList.add('threeRaidReady');
    const centerX = snapshot.camera.x + VIEW_WIDTH / 2;
    const centerY = snapshot.camera.y + VIEW_HEIGHT / 2;
    this.positionCamera(centerX, centerY, snapshot.player.angle ?? 0, snapshot.screenShake ?? 0, enteringRaid);
    this.syncActors(snapshot);
    this.syncCrates(snapshot.crates ?? []);
    this.syncEffects(snapshot);
    this.updateGrenadeAim(snapshot);
    this.updateRoofOcclusion(snapshot.player);
    this.updateExtraction(snapshot.map, snapshot.gameTime ?? 0);
    this.webgl.render(this.scene, this.camera);
    this.frameCount += 1;
    if (this.frameCount === 1 || this.frameCount % 180 === 0) this.updateObjectCount();
    return true;
  }

  screenToWorld(x: number, y: number): { x: number; y: number } | null {
    if (!this.ready || !this.active) return null;
    const pointer = new THREE.Vector2(x / VIEW_WIDTH * 2 - 1, -(y / VIEW_HEIGHT) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: hit.x, y: hit.z };
  }

  worldToScreen(x: number, y: number, height = 0): { x: number; y: number } | null {
    if (!this.ready || !this.active) return null;
    const point = new THREE.Vector3(x, height, y).project(this.camera);
    if (point.z < -1 || point.z > 1) return null;
    return { x: (point.x + 1) * VIEW_WIDTH / 2, y: (1 - point.y) * VIEW_HEIGHT / 2 };
  }

  deactivate(): void {
    this.active = false;
    this.stage.classList.remove('threeRaidReady');
  }
}

function installThreeRaid(): void {
  const container = document.getElementById('threeRaid');
  const stage = document.getElementById('raidStage');
  if (!container || !stage) return;
  try {
    window.__duckThreeRaid = new ThreeRaidRenderer(container, stage);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    window.__duckThreeRaid = {
      ready: false,
      active: false,
      renderer: 'unavailable',
      cameraMode: 'Canvas fallback',
      visualMode: 'Canvas fallback',
      revision: THREE.REVISION,
      objectCount: 0,
      frameCount: 0,
      reason,
      render: () => false,
      screenToWorld: () => null,
      worldToScreen: () => null,
      deactivate: () => undefined
    };
    stage.classList.remove('threeRaidReady');
  }
}

installThreeRaid();
