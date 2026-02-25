import * as THREE from 'three';
import { Board } from './board';
import { Piece, PieceColor, PieceType, posKey, boardToWorld } from './types';

const WHITE_COLOR = 0xf0e6d2;
const BLACK_COLOR = 0x2a2a3e;
const PIECE_SCALE = 0.35;
const OUTLINE_BASE_OPACITY = 0.25;
const OUTLINE_HOVER_OPACITY = 0.72;
const OUTLINE_SELECTED_OPACITY = 0.55;
const OUTLINE_BASE_SCALE = 1.1;
const OUTLINE_HOVER_SCALE = 1.18;
const OUTLINE_SELECTED_SCALE = 1.14;
const OUTLINE_BASE_WHITE = 0xffffff;
const OUTLINE_BASE_BLACK = 0x000000;
const OUTLINE_HOVER_WHITE = 0x44ccff;
const OUTLINE_HOVER_BLACK = 0x8888ff;
const OUTLINE_SELECTED_WHITE = 0xffcc44;
const OUTLINE_SELECTED_BLACK = 0xddaa33;

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
    const color = piece.color === PieceColor.White ? WHITE_COLOR : BLACK_COLOR;
    const emissive = piece.color === PieceColor.White ? 0x222211 : 0x111122;
    const group = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive,
      metalness: 0.3,
      roughness: 0.6,
      transparent: true,
      opacity: 0.92,
      depthWrite: true,
    });

    const outlineMat = new THREE.MeshBasicMaterial({
      color: piece.color === PieceColor.White ? OUTLINE_BASE_WHITE : OUTLINE_BASE_BLACK,
      side: THREE.BackSide,
      transparent: true,
      opacity: OUTLINE_BASE_OPACITY,
    });
    const outlineMeshes: THREE.Mesh[] = [];
    const addOutlinedPart = (
      geo: THREE.BufferGeometry,
      configure?: (mesh: THREE.Mesh) => void,
    ): void => {
      const mainPart = new THREE.Mesh(geo, mat);
      configure?.(mainPart);
      group.add(mainPart);

      const outlinePart = new THREE.Mesh(geo.clone(), outlineMat);
      outlinePart.scale.setScalar(OUTLINE_BASE_SCALE);
      configure?.(outlinePart);
      group.add(outlinePart);
      outlineMeshes.push(outlinePart);
    };

    let mainGeo: THREE.BufferGeometry;
    let height = 0.4;

    switch (piece.type) {
      case PieceType.King: {
        mainGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8);
        height = 0.45;
        const crossV = new THREE.BoxGeometry(0.04, 0.14, 0.04);
        const crossH = new THREE.BoxGeometry(0.1, 0.04, 0.04);
        addOutlinedPart(crossV, (mesh) => {
          mesh.position.y = 0.3;
        });
        addOutlinedPart(crossH, (mesh) => {
          mesh.position.y = 0.28;
        });
        break;
      }
      case PieceType.Queen: {
        mainGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.42, 8);
        height = 0.42;
        const sphere = new THREE.SphereGeometry(0.06, 8, 8);
        addOutlinedPart(sphere, (mesh) => {
          mesh.position.y = 0.27;
        });
        break;
      }
      case PieceType.Rook: {
        mainGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.32, 8);
        height = 0.32;
        const top = new THREE.CylinderGeometry(0.18, 0.16, 0.06, 8);
        addOutlinedPart(top, (mesh) => {
          mesh.position.y = 0.19;
        });
        break;
      }
      case PieceType.Bishop: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.4, 8);
        height = 0.4;
        const tip = new THREE.SphereGeometry(0.04, 6, 6);
        addOutlinedPart(tip, (mesh) => {
          mesh.position.y = 0.22;
        });
        break;
      }
      case PieceType.Knight: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.36, 8);
        height = 0.36;
        const head = new THREE.BoxGeometry(0.1, 0.12, 0.16);
        addOutlinedPart(head, (mesh) => {
          mesh.position.set(0.06, 0.14, 0);
          mesh.rotation.z = -0.4;
        });
        break;
      }
      case PieceType.Pawn: {
        mainGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.25, 8);
        height = 0.25;
        const ball = new THREE.SphereGeometry(0.07, 8, 8);
        addOutlinedPart(ball, (mesh) => {
          mesh.position.y = 0.16;
        });
        break;
      }
    }

    addOutlinedPart(mainGeo);

    // Base disc
    const baseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12);
    addOutlinedPart(baseGeo, (mesh) => {
      mesh.position.y = -height / 2;
    });

    group.scale.setScalar(PIECE_SCALE / 0.35);
    group.renderOrder = 5;
    group.userData = { piece, key: posKey(piece.position), outlineMat, outlineMeshes };

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
    const outlineMat = group.userData.outlineMat as THREE.MeshBasicMaterial | undefined;
    const outlineMeshes = group.userData.outlineMeshes as THREE.Mesh[] | undefined;
    if (!outlineMat) return;

    const isWhite = piece.color === PieceColor.White;
    let opacity: number;
    let color: number;
    let scale: number;

    switch (style) {
      case 'hover':
        opacity = OUTLINE_HOVER_OPACITY;
        color = isWhite ? OUTLINE_HOVER_WHITE : OUTLINE_HOVER_BLACK;
        scale = OUTLINE_HOVER_SCALE;
        break;
      case 'selected':
        opacity = OUTLINE_SELECTED_OPACITY;
        color = isWhite ? OUTLINE_SELECTED_WHITE : OUTLINE_SELECTED_BLACK;
        scale = OUTLINE_SELECTED_SCALE;
        break;
      default:
        opacity = OUTLINE_BASE_OPACITY;
        color = isWhite ? OUTLINE_BASE_WHITE : OUTLINE_BASE_BLACK;
        scale = OUTLINE_BASE_SCALE;
        break;
    }

    outlineMat.opacity = opacity;
    outlineMat.color.setHex(color);
    outlineMeshes?.forEach((outline) => {
      outline.scale.setScalar(scale);
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
