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

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x8888ff, 0.3);
    dirLight2.position.set(-10, -5, -10);
    this.scene.add(dirLight2);

    this.addAxisLabels();

    window.addEventListener('resize', this.boundOnResize);
  }

  private xLabels: THREE.Sprite[] = [];
  private yLabels: THREE.Sprite[] = [];
  private zLabels: THREE.Sprite[] = [];

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
    const minBound = -1.0;
    const maxBound = 8.0;

    this.camera.updateMatrixWorld();
    const screenUp = new THREE.Vector3(0, 1, 0).transformDirection(this.camera.matrixWorld);
    const screenRight = new THREE.Vector3(1, 0, 0).transformDirection(this.camera.matrixWorld);

    // X Labels (columns a-h)
    const cornersYZ = [
      { y: minBound, z: minBound },
      { y: maxBound, z: minBound },
      { y: minBound, z: maxBound },
      { y: maxBound, z: maxBound }
    ];

    cornersYZ.sort((a, b) => {
      const dotA = new THREE.Vector3(3.5, a.y, a.z).dot(screenUp);
      const dotB = new THREE.Vector3(3.5, b.y, b.z).dot(screenUp);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB;
      const distA = new THREE.Vector3(3.5, a.y, a.z).distanceToSquared(this.camera.position);
      const distB = new THREE.Vector3(3.5, b.y, b.z).distanceToSquared(this.camera.position);
      return distA - distB;
    });

    const bottomMostYZ = cornersYZ[0];
    for (let i = 0; i < 8; i++) {
      this.xLabels[i].position.set(i, bottomMostYZ.y, bottomMostYZ.z);
    }

    // Y Labels (rows 1-8, deep along Z)
    const cornersXY = [
      { x: minBound, y: minBound },
      { x: maxBound, y: minBound },
      { x: minBound, y: maxBound },
      { x: maxBound, y: maxBound }
    ];

    cornersXY.sort((a, b) => {
      const dotA = new THREE.Vector3(a.x, a.y, 3.5).dot(screenUp);
      const dotB = new THREE.Vector3(b.x, b.y, 3.5).dot(screenUp);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB;
      const distA = new THREE.Vector3(a.x, a.y, 3.5).distanceToSquared(this.camera.position);
      const distB = new THREE.Vector3(b.x, b.y, 3.5).distanceToSquared(this.camera.position);
      return distA - distB;
    });

    const bottomMostXY = cornersXY[0];
    for (let i = 0; i < 8; i++) {
      this.yLabels[i].position.set(bottomMostXY.x, bottomMostXY.y, i);
    }

    // Z Labels (layers L1-L8, vertical along Y)
    const cornersXZ = [
      { x: minBound, z: minBound },
      { x: maxBound, z: minBound },
      { x: minBound, z: maxBound },
      { x: maxBound, z: maxBound }
    ];

    cornersXZ.sort((a, b) => {
      const dotA = new THREE.Vector3(a.x, 3.5, a.z).dot(screenRight);
      const dotB = new THREE.Vector3(b.x, 3.5, b.z).dot(screenRight);
      if (Math.abs(dotA - dotB) > 0.001) return dotA - dotB; // Minimum dot is leftmost
      const distA = new THREE.Vector3(a.x, 3.5, a.z).distanceToSquared(this.camera.position);
      const distB = new THREE.Vector3(b.x, 3.5, b.z).distanceToSquared(this.camera.position);
      return distA - distB;
    });
    
    const leftCorner = cornersXZ[0];
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
