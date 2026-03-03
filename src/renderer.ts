import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Renderer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  controls: OrbitControls;
  private rafId: number | null = null;
  private boundOnResize = () => this.onResize();

  private panOffset = new THREE.Vector2();
  private targetPanOffset = new THREE.Vector2();
  private isPanOffsetActive = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(14, 12, 14);
    this.camera.lookAt(3.5, 3.5, 3.5);

    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.sortObjects = true;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(3.5, 3.5, 3.5);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 40;
    this.controls.update();

    this.controls.enablePan = true;

    // Hook OrbitControls pan to our screen-space pan offset.
    // This allows the user to pan the view (Shift+LeftClick), but ensures
    // the 3D orbit pivot ALWAYS remains perfectly locked to the center of the cube.
    const origPan = (this.controls as any)._pan;
    (this.controls as any)._pan = (deltaX: number, deltaY: number) => {
      this.targetPanOffset.x -= deltaX;
      this.targetPanOffset.y -= deltaY;
    };

    // We want Ctrl+Drag to rotate the board, not pan. OrbitControls hardcodes Ctrl to pan.
    // By intercepting pointer events, stripping the ctrlKey, and re-dispatching,
    // OrbitControls treats it as a normal rotate, while our game layer still sees the keydown.
    const stripCtrl = (e: PointerEvent) => {
      if (e.ctrlKey) {
        e.stopPropagation();
        const cloned = new PointerEvent(e.type, {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          button: e.button,
          buttons: e.buttons,
          bubbles: e.bubbles,
          cancelable: e.cancelable,
          ctrlKey: false,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey
        });
        e.target?.dispatchEvent(cloned);
      }
    };
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(t => 
      canvas.addEventListener(t, stripCtrl as EventListener, { capture: true })
    );

    // Lighting rig for readable surface detail on monochrome pieces.
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xdde6ff, 0x1e1c24, 0.38);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(12, 18, 10);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb9c8ff, 0.5);
    fillLight.position.set(-10, 7, -8);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.45);
    rimLight.position.set(0, 10, -16);
    this.scene.add(rimLight);

    this.addAxisLabels();

    window.addEventListener('resize', this.boundOnResize);
  }

  private xLabels: THREE.Sprite[] = [];
  private yLabels: THREE.Sprite[] = [];
  private zLabels: THREE.Sprite[] = [];

  private tempVec1 = new THREE.Vector3();
  private tempVec2 = new THREE.Vector3();
  private screenUp = new THREE.Vector3();
  private screenRight = new THREE.Vector3();
  private lastCamX = NaN;
  private lastCamY = NaN;
  private lastCamZ = NaN;
  private lastCamQx = NaN;

  private cornersYZ = [
    { y: -1.0, z: -1.0 },
    { y: 8.0, z: -1.0 },
    { y: -1.0, z: 8.0 },
    { y: 8.0, z: 8.0 }
  ];
  private cornersXY = [
    { x: -1.0, y: -1.0 },
    { x: 8.0, y: -1.0 },
    { x: -1.0, y: 8.0 },
    { x: 8.0, y: 8.0 }
  ];
  private cornersXZ = [
    { x: -1.0, z: -1.0 },
    { x: 8.0, z: -1.0 },
    { x: -1.0, z: 8.0 },
    { x: 8.0, z: 8.0 }
  ];

  private addAxisLabels(): void {
    // x-axis: columns (a-h) along 3D X
    const colLabels = ['a','b','c','d','e','f','g','h'];
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(colLabels[i], 0x6688bb);
      this.scene.add(sprite);
      this.xLabels.push(sprite);
    }

    // Board y (rows 1-8) renders along 3D Z (depth)
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(String(i + 1), 0x6688bb);
      this.scene.add(sprite);
      this.yLabels.push(sprite);
    }

    // Board z (layers L1-L8) renders along 3D Y (vertical)
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(`L${i + 1}`, 0x8866bb);
      this.scene.add(sprite);
      this.zLabels.push(sprite);
    }
    
    this.updateAxisLabels();
  }

  private updateAxisLabels(): void {
    const cp = this.camera.position;
    const cq = this.camera.quaternion;
    if (cp.x === this.lastCamX && cp.y === this.lastCamY &&
        cp.z === this.lastCamZ && cq.x === this.lastCamQx) return;
    this.lastCamX = cp.x;
    this.lastCamY = cp.y;
    this.lastCamZ = cp.z;
    this.lastCamQx = cq.x;
    this.camera.updateMatrixWorld();
    this.screenUp.set(0, 1, 0).transformDirection(this.camera.matrixWorld);
    this.screenRight.set(1, 0, 0).transformDirection(this.camera.matrixWorld);

    // X Labels (columns a-h)
    this.cornersYZ.sort((a, b) => {
      const dotA = this.tempVec1.set(3.5, a.y, a.z).dot(this.screenUp);
      const dotB = this.tempVec2.set(3.5, b.y, b.z).dot(this.screenUp);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB;
      const distA = this.tempVec1.set(3.5, a.y, a.z).distanceToSquared(this.camera.position);
      const distB = this.tempVec2.set(3.5, b.y, b.z).distanceToSquared(this.camera.position);
      return distA - distB;
    });

    const bottomMostYZ = this.cornersYZ[0];
    for (let i = 0; i < 8; i++) {
      this.xLabels[i].position.set(i, bottomMostYZ.y, bottomMostYZ.z);
    }

    // Y Labels (rows 1-8, deep along Z)
    this.cornersXY.sort((a, b) => {
      const dotA = this.tempVec1.set(a.x, a.y, 3.5).dot(this.screenUp);
      const dotB = this.tempVec2.set(b.x, b.y, 3.5).dot(this.screenUp);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB;
      const distA = this.tempVec1.set(a.x, a.y, 3.5).distanceToSquared(this.camera.position);
      const distB = this.tempVec2.set(b.x, b.y, 3.5).distanceToSquared(this.camera.position);
      return distA - distB;
    });

    const bottomMostXY = this.cornersXY[0];
    for (let i = 0; i < 8; i++) {
      this.yLabels[i].position.set(bottomMostXY.x, bottomMostXY.y, i);
    }

    // Z Labels (layers L1-L8, vertical along Y)
    this.cornersXZ.sort((a, b) => {
      const dotA = this.tempVec1.set(a.x, 3.5, a.z).dot(this.screenRight);
      const dotB = this.tempVec2.set(b.x, 3.5, b.z).dot(this.screenRight);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB; // Minimum dot is leftmost
      const distA = this.tempVec1.set(a.x, 3.5, a.z).distanceToSquared(this.camera.position);
      const distB = this.tempVec2.set(b.x, 3.5, b.z).distanceToSquared(this.camera.position);
      return distA - distB;
    });
    
    const leftCorner = this.cornersXZ[0];
    for (let i = 0; i < 8; i++) {
      this.zLabels[i].position.set(leftCorner.x, i, leftCorner.z);
    }
  }

  private makeTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.6 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 0.5);
    return sprite;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.controls.update();
    this.updateAxisLabels();

    const dx = this.targetPanOffset.x - this.panOffset.x;
    const dy = this.targetPanOffset.y - this.panOffset.y;
    
    this.panOffset.x += dx * 0.25;
    this.panOffset.y += dy * 0.25;

    const isActive = Math.abs(this.panOffset.x) > 0.05 || Math.abs(this.panOffset.y) > 0.05;

    if (isActive || this.isPanOffsetActive) {
      if (isActive) {
        this.camera.setViewOffset(
          window.innerWidth,
          window.innerHeight,
          this.panOffset.x,
          this.panOffset.y,
          window.innerWidth,
          window.innerHeight
        );
      } else {
        this.camera.clearViewOffset();
        this.panOffset.set(0, 0);
        this.targetPanOffset.set(0, 0);
      }
      this.isPanOffsetActive = isActive;
    }

    this.webgl.render(this.scene, this.camera);
  }

  startLoop(callback: () => void): void {
    const loop = () => {
      callback();
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.boundOnResize);
    this.controls.dispose();
    this.webgl.dispose();
  }
}
