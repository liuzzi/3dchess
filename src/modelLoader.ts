import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from './types';

const loader = new GLTFLoader();

// Setup Draco
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

// Setup Meshopt
loader.setMeshoptDecoder(MeshoptDecoder);

const modelScenes = new Map<PieceType, THREE.LOD>();

export async function loadModels(): Promise<void> {
  const pieces = [
    PieceType.Pawn, PieceType.Knight, PieceType.Bishop,
    PieceType.Rook, PieceType.Queen, PieceType.King
  ];

  const loadPromise = (url: string) => {
    return new Promise<THREE.Group>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const scene = gltf.scene;
          
          const box = new THREE.Box3().setFromObject(scene);
          const center = new THREE.Vector3();
          box.getCenter(center);
          
          scene.position.sub(center);
          
          const wrapper = new THREE.Group();
          wrapper.add(scene);
          
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          wrapper.scale.setScalar(1 / maxDim);
          
          resolve(wrapper);
        },
        undefined,
        (error) => reject(error)
      );
    });
  };

  const promises = pieces.map(async (type) => {
    try {
      const [high, med, low] = await Promise.all([
        loadPromise(`/models/${type}_high.glb`),
        loadPromise(`/models/${type}_med.glb`),
        loadPromise(`/models/${type}_low.glb`),
      ]);

      const lod = new THREE.LOD();
      // Distance thresholds for zooming
      lod.addLevel(high, 0);
      lod.addLevel(med, 12);
      lod.addLevel(low, 22);

      modelScenes.set(type, lod);
    } catch (e) {
      console.error(`Failed to load LOD models for ${type}:`, e);
    }
  });

  await Promise.all(promises);
}

export function getModelScene(type: PieceType): THREE.LOD | undefined {
  return modelScenes.get(type);
}
