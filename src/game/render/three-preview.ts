import * as THREE from 'three';
import { maps } from '../data/maps';
import type { DuckThreePreviewDebug, MapDefinition } from '../types';

const SCENE_WIDTH = 44;
const SCENE_DEPTH = 29;
const VIEW_HEIGHT = 27;

function colorFrom(value: string, fallback: number): THREE.ColorRepresentation {
  return value.startsWith('#') ? value : fallback;
}

function worldX(value: number, map: MapDefinition): number {
  return value / map.world.w * SCENE_WIDTH - SCENE_WIDTH / 2;
}

function worldZ(value: number, map: MapDefinition): number {
  return value / map.world.h * SCENE_DEPTH - SCENE_DEPTH / 2;
}

function enableShadows(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function createDuck(bodyColor: THREE.ColorRepresentation, vestColor: THREE.ColorRepresentation): THREE.Group {
  const duck = new THREE.Group();
  const feather = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.82 });
  const vest = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.72, metalness: 0.08 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf2a23a, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17201e, roughness: 0.65, metalness: 0.18 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.67, 18, 14), feather);
  body.scale.set(0.9, 1.08, 1.12);
  body.position.y = 0.92;
  duck.add(body);

  const armor = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.72, 0.82), vest);
  armor.position.set(0, 0.9, 0.08);
  armor.rotation.x = -0.08;
  duck.add(armor);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 14), feather);
  head.position.set(0, 1.78, -0.18);
  duck.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 4), orange);
  beak.rotation.x = -Math.PI / 2;
  beak.rotation.z = Math.PI / 4;
  beak.position.set(0, 1.68, -0.75);
  duck.add(beak);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), dark);
    eye.position.set(side * 0.25, 1.91, -0.56);
    duck.add(eye);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.52), orange);
    foot.position.set(side * 0.32, 0.15, -0.14);
    duck.add(foot);
  }

  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 1.7), dark);
  rifle.position.set(0.7, 1.02, -0.53);
  rifle.rotation.x = -0.24;
  duck.add(rifle);

  enableShadows(duck);
  return duck;
}

class ThreePreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Group();
  private readonly ducks: THREE.Group[] = [];
  private readonly debug: DuckThreePreviewDebug;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private extractionRing: THREE.Mesh | null = null;
  private running = false;
  private visible = true;
  private frameRequest = 0;
  private pointerX = 0;
  private pointerY = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x526b5b);
    this.scene.fog = new THREE.FogExp2(0x536b5d, 0.021);
    this.scene.add(this.world);
    this.configureLighting();
    this.buildDiorama(maps[0]);

    let objectCount = 0;
    this.scene.traverse(() => { objectCount += 1; });
    this.debug = {
      ready: true,
      renderer: this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL',
      revision: THREE.REVISION,
      objectCount,
      frameCount: 0
    };
    window.__duckThreePreview = this.debug;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? false;
      if (this.visible) this.start();
      else this.stop();
    }, { threshold: 0.02 });
    this.intersectionObserver.observe(container);
    container.addEventListener('pointermove', this.handlePointerMove);
    container.addEventListener('pointerleave', this.resetPointer);
    document.addEventListener('visibilitychange', this.handleVisibility);

    this.resize();
    this.render(0);
    this.start();
    container.closest('.heroImage')?.classList.add('threeReady');
    const status = document.getElementById('threePreviewStatus');
    if (status) status.textContent = `${this.debug.renderer}・r${THREE.REVISION}`;
  }

  private configureLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xcde3d5, 0x263329, 2.35));
    const sun = new THREE.DirectionalLight(0xffe2b0, 4.1);
    sun.position.set(-18, 28, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 75;
    sun.shadow.bias = -0.0007;
    this.scene.add(sun);
  }

  private buildDiorama(map: MapDefinition): void {
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: colorFrom(map.palette.ground, 0x485f50),
      roughness: 0.96
    });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(SCENE_WIDTH, 0.7, SCENE_DEPTH), groundMaterial);
    ground.position.y = -0.38;
    ground.receiveShadow = true;
    this.world.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343b37, roughness: 1 });
    map.roads.forEach((road) => {
      const width = road.w / map.world.w * SCENE_WIDTH;
      const depth = road.h / map.world.h * SCENE_DEPTH;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, depth), roadMaterial);
      mesh.position.set(worldX(road.x + road.w / 2, map), 0.025, worldZ(road.y + road.h / 2, map));
      mesh.receiveShadow = true;
      this.world.add(mesh);
    });

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: colorFrom(map.palette.water, 0x234f5e),
      roughness: 0.25,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88
    });
    map.waterZones.forEach((water) => {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 40), waterMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(water.rx / map.world.w * SCENE_WIDTH, water.ry / map.world.h * SCENE_DEPTH, 1);
      mesh.position.set(worldX(water.x, map), 0.08, worldZ(water.y, map));
      this.world.add(mesh);
    });

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: colorFrom(map.palette.wall, 0x29332f),
      roughness: 0.86
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: colorFrom(map.palette.top, 0x68736e),
      roughness: 0.78,
      metalness: 0.08
    });
    const lockedRoofMaterial = new THREE.MeshStandardMaterial({ color: 0xa77732, roughness: 0.7 });
    map.buildingSpecs.forEach((building, index) => {
      const width = Math.max(1.2, Number(building.w) / map.world.w * SCENE_WIDTH);
      const depth = Math.max(1, Number(building.h) / map.world.h * SCENE_DEPTH);
      const height = building.locked ? 2.8 : building.chest ? 2.25 : 1.65 + index % 3 * 0.28;
      const x = worldX(Number(building.x) + Number(building.w) / 2, map);
      const z = worldZ(Number(building.y) + Number(building.h) / 2, map);
      const structure = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
      walls.position.y = height / 2;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.16, 0.2, depth + 0.16),
        building.locked ? lockedRoofMaterial : roofMaterial
      );
      roof.position.y = height + 0.1;
      structure.position.set(x, 0, z);
      structure.add(walls, roof);
      enableShadows(structure);
      this.world.add(structure);
    });

    this.addTrees();
    this.addActors();
    this.addProps();
  }

  private addTrees(): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4631, roughness: 1 });
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x244f31, roughness: 0.95 });
    for (let index = 0; index < 34; index += 1) {
      const x = ((index * 17) % 43) - 21;
      const z = ((index * 29 + 7) % 27) - 13;
      if (Math.abs(x) < 3 || Math.abs(z) < 1.1) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 1.15, 7), trunkMaterial);
      trunk.position.y = 0.57;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.72 + index % 3 * 0.08, 2.05, 8), crownMaterial);
      crown.position.y = 1.85;
      tree.position.set(x, 0, z);
      tree.add(trunk, crown);
      enableShadows(tree);
      this.world.add(tree);
    }
  }

  private addActors(): void {
    const player = createDuck(0xf2e7c7, 0x315f78);
    player.position.set(-7.5, 0, 5.2);
    player.rotation.y = -0.45;
    this.world.add(player);
    this.ducks.push(player);

    const enemyPositions: Array<[number, number, number]> = [
      [5.2, -3.4, 2.35],
      [10.3, 5.8, -2.35],
      [-1.2, -8.4, 0.8]
    ];
    enemyPositions.forEach(([x, z, rotation], index) => {
      const enemy = createDuck(index === 1 ? 0xc8b895 : 0xd9cba8, index === 1 ? 0x703833 : 0x51443a);
      enemy.position.set(x, 0, z);
      enemy.rotation.y = rotation;
      this.world.add(enemy);
      this.ducks.push(enemy);
    });
  }

  private addProps(): void {
    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6338, roughness: 0.84 });
    [[-10, -4], [3, 7], [13, -6]].forEach(([x, z]) => {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 0.95), crateMaterial);
      crate.position.set(x, 0.43, z);
      crate.rotation.y = (x + z) * 0.12;
      crate.castShadow = true;
      crate.receiveShadow = true;
      this.world.add(crate);
    });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 2.15, 40),
      new THREE.MeshBasicMaterial({ color: 0x69f595, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(17, 0.1, -10.5);
    this.world.add(ring);
    this.extractionRing = ring;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.container.getBoundingClientRect();
    this.pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    this.pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
  };

  private readonly resetPointer = (): void => {
    this.pointerX = 0;
    this.pointerY = 0;
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) this.stop();
    else if (this.visible) this.start();
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    this.camera.left = -VIEW_HEIGHT * aspect / 2;
    this.camera.right = VIEW_HEIGHT * aspect / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.near = 0.1;
    this.camera.far = 120;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render(performance.now());
  }

  private start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.frameRequest = requestAnimationFrame(this.animate);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
  }

  private readonly animate = (time: number): void => {
    if (!this.running) return;
    this.render(time);
    this.frameRequest = requestAnimationFrame(this.animate);
  };

  private render(time: number): void {
    const seconds = time * 0.001;
    const angle = 0.74 + this.pointerX * 0.11 + Math.sin(seconds * 0.13) * 0.018;
    const radius = 37;
    this.camera.position.set(Math.cos(angle) * radius, 29 - this.pointerY * 2.4, Math.sin(angle) * radius);
    this.camera.lookAt(0, 0.5, 0);
    this.ducks.forEach((duck, index) => {
      duck.position.y = Math.sin(seconds * 2.1 + index * 1.7) * 0.035;
    });
    if (this.extractionRing) {
      this.extractionRing.rotation.z = seconds * 0.32;
      const material = this.extractionRing.material as THREE.MeshBasicMaterial;
      material.opacity = 0.58 + Math.sin(seconds * 2.4) * 0.14;
    }
    this.renderer.render(this.scene, this.camera);
    this.debug.frameCount += 1;
  }
}

const previewContainer = document.getElementById('threePreview');
if (previewContainer) {
  try {
    new ThreePreview(previewContainer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    window.__duckThreePreview = {
      ready: false,
      renderer: 'unavailable',
      revision: THREE.REVISION,
      objectCount: 0,
      frameCount: 0,
      reason
    };
    previewContainer.closest('.heroImage')?.classList.add('threeUnavailable');
    const status = document.getElementById('threePreviewStatus');
    if (status) status.textContent = '2D FALLBACK';
  }
}
