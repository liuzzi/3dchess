import * as THREE from 'three';
import { Board } from './board';
import { Piece, PieceColor, PieceType, posKey, boardToWorld } from './types';

const WHITE_COLOR = 0xf0e6d2;
const BLACK_COLOR = 0x2a2a3e;
const PIECE_SCALE = 0.35;

export class PieceView {
  group: THREE.Group;
  private meshes = new Map<Piece, THREE.Group>();
  private hiddenLayers = new Set<number>();

  constructor() {
    this.group = new THREE.Group();
  }

  setLayerVisible(layer: number, visible: boolean): void {
    if (visible) {
      this.hiddenLayers.delete(layer);
    } else {
      this.hiddenLayers.add(layer);
    }
    for (const [piece, mesh] of this.meshes) {
      mesh.visible = !this.hiddenLayers.has(piece.position.z);
    }
  }

  sync(board: Board): void {
    const current = new Set(board.pieces);

    // Remove meshes for pieces no longer on the board
    for (const [piece, mesh] of this.meshes) {
      if (!current.has(piece)) {
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
      mesh.visible = !this.hiddenLayers.has(piece.position.z);
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
      color: piece.color === PieceColor.White ? 0xffffff : 0x000000,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.25,
    });

    let mainGeo: THREE.BufferGeometry;
    let height = 0.4;

    switch (piece.type) {
      case PieceType.King: {
        mainGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8);
        height = 0.45;
        const crossV = new THREE.BoxGeometry(0.04, 0.14, 0.04);
        const crossH = new THREE.BoxGeometry(0.1, 0.04, 0.04);
        const cv = new THREE.Mesh(crossV, mat);
        cv.position.y = 0.3;
        const ch = new THREE.Mesh(crossH, mat);
        ch.position.y = 0.28;
        group.add(cv, ch);
        break;
      }
      case PieceType.Queen: {
        mainGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.42, 8);
        height = 0.42;
        const sphere = new THREE.SphereGeometry(0.06, 8, 8);
        const sm = new THREE.Mesh(sphere, mat);
        sm.position.y = 0.27;
        group.add(sm);
        break;
      }
      case PieceType.Rook: {
        mainGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.32, 8);
        height = 0.32;
        const top = new THREE.CylinderGeometry(0.18, 0.16, 0.06, 8);
        const tm = new THREE.Mesh(top, mat);
        tm.position.y = 0.19;
        group.add(tm);
        break;
      }
      case PieceType.Bishop: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.4, 8);
        height = 0.4;
        const tip = new THREE.SphereGeometry(0.04, 6, 6);
        const tipm = new THREE.Mesh(tip, mat);
        tipm.position.y = 0.22;
        group.add(tipm);
        break;
      }
      case PieceType.Knight: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.36, 8);
        height = 0.36;
        const head = new THREE.BoxGeometry(0.1, 0.12, 0.16);
        const hm = new THREE.Mesh(head, mat);
        hm.position.set(0.06, 0.14, 0);
        hm.rotation.z = -0.4;
        group.add(hm);
        break;
      }
      case PieceType.Pawn: {
        mainGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.25, 8);
        height = 0.25;
        const ball = new THREE.SphereGeometry(0.07, 8, 8);
        const bm = new THREE.Mesh(ball, mat);
        bm.position.y = 0.16;
        group.add(bm);
        break;
      }
    }

    const mainMesh = new THREE.Mesh(mainGeo, mat);
    group.add(mainMesh);

    // Outline for visibility against transparent grid
    const outlineGeo = mainGeo.clone();
    const outline = new THREE.Mesh(outlineGeo, outlineMat);
    outline.scale.multiplyScalar(1.08);
    group.add(outline);

    // Base disc
    const baseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12);
    const baseMesh = new THREE.Mesh(baseGeo, mat);
    baseMesh.position.y = -height / 2;
    group.add(baseMesh);

    group.scale.setScalar(PIECE_SCALE / 0.35);
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
    mesh.visible = !this.hiddenLayers.has(piece.position.z);
    this.group.add(mesh);
    this.meshes.set(piece, mesh);
  }

  getMeshForPiece(piece: Piece): THREE.Group | undefined {
    return this.meshes.get(piece);
  }

  getAllPieceGroups(): THREE.Group[] {
    return Array.from(this.meshes.values());
  }
}
