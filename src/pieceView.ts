import * as THREE from 'three';
import { Board } from './board';
import { Piece, PieceColor, PieceType, posKey, boardToWorld } from './types';
import { getModelScene } from './modelLoader';

const WHITE_COLOR = 0xffffff;
const BLACK_COLOR = 0x2b2b32;
const PIECE_SCALE = 0.35;
const ORB_HOVER_COLOR = 0xffea77;
const ORB_SELECTED_COLOR = 0xffbb00;
const CUSTOM_MODEL_FILL = 0.85;
const CUSTOM_MODEL_SCALE_BY_TYPE: Partial<Record<PieceType, number>> = {
  [PieceType.Knight]: 1.5,
};
const CUSTOM_MODEL_Y_OFFSET_BY_TYPE: Partial<Record<PieceType, number>> = {
  [PieceType.Knight]: 0.0,
};

export class PieceView {
  group: THREE.Group;
  private meshes = new Map<Piece, THREE.Group>();
  private hoveredPiece: Piece | null = null;
  private selectedPiece: Piece | null = null;
  private _styledPieces = new Map<Piece, 'hover' | 'selected'>();

  constructor() {
    this.group = new THREE.Group();
  }

  sync(board: Board): void {
    const current = new Set(board.pieces);

    // Remove meshes for pieces no longer on the board
    for (const [piece, mesh] of this.meshes) {
      if (!current.has(piece)) {
        if (this.hoveredPiece === piece) {
          this.hoveredPiece = null;
        }
        if (this.selectedPiece === piece) {
          this.selectedPiece = null;
        }
        this._styledPieces.delete(piece);
        this.group.remove(mesh);
        this.meshes.delete(piece);
      }
    }

    // Add/update meshes
    for (const piece of board.pieces) {
      let mesh = this.meshes.get(piece);
      if (!mesh) {
        mesh = this.createPieceMesh(piece);
        this.group.add(mesh);
        this.meshes.set(piece, mesh);
      }
      const [wx, wy, wz] = boardToWorld(piece.position);
      mesh.position.set(wx, wy, wz);
    }
  }

  private createPieceMesh(piece: Piece): THREE.Group {
    const isWhite = piece.color === PieceColor.White;
    const color = isWhite ? WHITE_COLOR : BLACK_COLOR;
    const emissive = isWhite ? 0x080806 : 0x030306;
    const group = new THREE.Group();

    const mat = new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      metalness: 0.04,
      roughness: isWhite ? 0.62 : 0.55,
      clearcoat: isWhite ? 0.25 : 0.3,
      clearcoatRoughness: 0.35,
      reflectivity: 0.4,
      transparent: false,
      depthWrite: true,
    });

    const addPart = (
      geo: THREE.BufferGeometry,
      configure?: (mesh: THREE.Mesh) => void,
    ): void => {
      const mainPart = new THREE.Mesh(geo, mat);
      configure?.(mainPart);
      group.add(mainPart);
    };

    let customScene = getModelScene(piece.type);
    let height = 0.4;
    let mainMatForHighlight: THREE.Material = mat;

    if (customScene) {
      height = 0;
      const clone = customScene.clone();
      
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const origMat = child.material;
          const newMat = mat.clone();
          
          if (origMat.map) newMat.map = origMat.map;
          if (origMat.normalMap) newMat.normalMap = origMat.normalMap;
          if (origMat.roughnessMap) newMat.roughnessMap = origMat.roughnessMap;
          if (origMat.metalnessMap) newMat.metalnessMap = origMat.metalnessMap;
          if (origMat.aoMap) newMat.aoMap = origMat.aoMap;
          
          // Keep original textures but apply our custom color/lighting properties
          newMat.color.setHex(color);
          
          child.material = newMat;
          mainMatForHighlight = newMat;
        }
      });
      
      clone.position.y += CUSTOM_MODEL_Y_OFFSET_BY_TYPE[piece.type] ?? 0;
      if (!isWhite) clone.rotation.y = Math.PI;
      group.add(clone);
    } else {
      // Fallback if model not loaded
      let mainGeo: THREE.BufferGeometry;
      switch (piece.type) {
        case PieceType.King: {
          mainGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8);
          height = 0.45;
          const crossV = new THREE.BoxGeometry(0.04, 0.14, 0.04);
          const crossH = new THREE.BoxGeometry(0.1, 0.04, 0.04);
          addPart(crossV, (mesh) => {
            mesh.position.y = 0.3;
          });
          addPart(crossH, (mesh) => {
            mesh.position.y = 0.28;
          });
          break;
        }
        case PieceType.Queen: {
          mainGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.42, 8);
          height = 0.42;
          const sphere = new THREE.SphereGeometry(0.06, 8, 8);
          addPart(sphere, (mesh) => {
            mesh.position.y = 0.27;
          });
          break;
        }
        case PieceType.Rook: {
          mainGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.32, 8);
          height = 0.32;
          const top = new THREE.CylinderGeometry(0.18, 0.16, 0.06, 8);
          addPart(top, (mesh) => {
            mesh.position.y = 0.19;
          });
          break;
        }
        case PieceType.Bishop: {
          mainGeo = new THREE.ConeGeometry(0.16, 0.4, 8);
          height = 0.4;
          const tip = new THREE.SphereGeometry(0.04, 6, 6);
          addPart(tip, (mesh) => {
            mesh.position.y = 0.22;
          });
          break;
        }
        case PieceType.Knight: {
          mainGeo = new THREE.ConeGeometry(0.16, 0.36, 8);
          height = 0.36;
          const head = new THREE.BoxGeometry(0.1, 0.12, 0.16);
          addPart(head, (mesh) => {
            mesh.position.set(0.06, 0.14, 0);
            mesh.rotation.z = -0.4;
          });
          break;
        }
        case PieceType.Pawn: {
          mainGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.25, 8);
          height = 0.25;
          const ball = new THREE.SphereGeometry(0.07, 8, 8);
          addPart(ball, (mesh) => {
            mesh.position.y = 0.16;
          });
          break;
        }
        default: {
          mainGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.25, 8);
          height = 0.25;
          break;
        }
      }

      addPart(mainGeo, (mesh) => {
        if (height === 0) {
          mesh.position.y += CUSTOM_MODEL_Y_OFFSET_BY_TYPE[piece.type] ?? 0;
        }
      });

      // Base disc (only for fallback primitives)
      if (height > 0) {
        const baseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12);
        addPart(baseGeo, (mesh) => {
          mesh.position.y = -height / 2;
        });
      }
    }

    const customScaleBoost = CUSTOM_MODEL_SCALE_BY_TYPE[piece.type] ?? 1;
    const finalScale = height === 0
      ? (PIECE_SCALE / 0.35) * CUSTOM_MODEL_FILL * customScaleBoost
      : (PIECE_SCALE / 0.35);
    group.scale.setScalar(finalScale);

    group.renderOrder = 5;
    group.userData = { piece, key: posKey(piece.position) };

    return group;
  }

  rebuildPiece(piece: Piece): void {
    const old = this.meshes.get(piece);
    if (old) {
      this.group.remove(old);
      this.meshes.delete(piece);
    }
    const mesh = this.createPieceMesh(piece);
    const [wx, wy, wz] = boardToWorld(piece.position);
    mesh.position.set(wx, wy, wz);
    this.group.add(mesh);
    this.meshes.set(piece, mesh);
    this.updateHighlightState();
  }

  getMeshForPiece(piece: Piece): THREE.Group | undefined {
    return this.meshes.get(piece);
  }

  getAllPieceGroups(): THREE.Group[] {
    return Array.from(this.meshes.values());
  }

  setHovered(piece: Piece | null): void {
    if (this.hoveredPiece === piece) return;
    this.hoveredPiece = piece;
    this.updateHighlightState();
  }

  setSelected(piece: Piece | null): void {
    if (this.selectedPiece === piece) return;
    this.selectedPiece = piece;
    this.updateHighlightState();
  }

  private applyOutlineStyle(
    piece: Piece,
    style: 'base' | 'hover' | 'selected',
  ): void {
    const group = this.meshes.get(piece);
    if (!group) return;

    const isWhite = piece.color === PieceColor.White;
    let emissiveColor: number;

    switch (style) {
      case 'hover':
        emissiveColor = 0xdddd88; // Light yellow-white
        break;
      case 'selected':
        emissiveColor = 0xeebb44; // Warm yellow
        break;
      default:
        emissiveColor = isWhite ? 0x080806 : 0x030306;
        break;
    }

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshPhysicalMaterial;
        if (mat && mat.emissive) {
          mat.emissive.setHex(emissiveColor);
        }
      }
    });
  }

  private updateHighlightState(): void {
    const next = new Map<Piece, 'hover' | 'selected'>();

    if (this.selectedPiece && this.hoveredPiece && this.selectedPiece === this.hoveredPiece) {
      next.set(this.selectedPiece, 'hover');
    } else {
      if (this.selectedPiece) next.set(this.selectedPiece, 'selected');
      if (this.hoveredPiece) next.set(this.hoveredPiece, 'hover');
    }

    for (const [piece] of this._styledPieces) {
      if (!next.has(piece)) this.applyOutlineStyle(piece, 'base');
    }
    for (const [piece, style] of next) {
      if (this._styledPieces.get(piece) !== style) this.applyOutlineStyle(piece, style);
    }

    this._styledPieces = next;
  }
}

