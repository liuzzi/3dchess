import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Renderer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  controls: OrbitControls;

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
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 40;
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x8888ff, 0.3);
    dirLight2.position.set(-10, -5, -10);
    this.scene.add(dirLight2);

    this.addAxisLabels();

    window.addEventListener('resize', () => this.onResize());
  }

  private addAxisLabels(): void {
    // x-axis: columns (a-h) along 3D X
    const colLabels = ['a','b','c','d','e','f','g','h'];
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(colLabels[i], 0x6688bb);
      sprite.position.set(i, -0.8, -0.8);
      this.scene.add(sprite);
    }

    // Board y (rows 1-8) renders along 3D Z (depth)
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(String(i + 1), 0x6688bb);
      sprite.position.set(-0.8, -0.8, i);
      this.scene.add(sprite);
    }

    // Board z (layers L1-L8) renders along 3D Y (vertical)
    for (let i = 0; i < 8; i++) {
      const sprite = this.makeTextSprite(`L${i + 1}`, 0x8866bb);
      sprite.position.set(-0.8, i, -0.8);
      this.scene.add(sprite);
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
    this.webgl.render(this.scene, this.camera);
  }

  startLoop(callback: () => void): void {
    const loop = () => {
      callback();
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
