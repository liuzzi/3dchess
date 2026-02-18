import * as THREE from 'three';
import { Position3D, posKey, boardToWorld } from './types';

const CELL_SIZE = 1;

interface CellBase {
  color: number;
  opacity: number;
  edgeColor: number;
}

export class BoardView {
  group: THREE.Group;
  cellMeshes: Map<string, THREE.Mesh> = new Map();
  cellEdges: Map<string, THREE.LineSegments> = new Map();

  private highlightedCells: Set<string> = new Set();
  private captureKeys: Set<string> = new Set();
  private selectedCell: string | null = null;
  private hoveredCell: string | null = null;

  private baseStyles: Map<string, CellBase> = new Map();

  constructor() {
    this.group = new THREE.Group();
    this.buildGrid();
  }

  private buildGrid(): void {
    const geo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const edgeGeo = new THREE.EdgesGeometry(geo);

    for (let z = 0; z < 8; z++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const key = posKey({ x, y, z });
          const isLight = (x + y + z) % 2 === 0;
          const cellColor = isLight ? 0x4466aa : 0x223355;
          const edgeColor = isLight ? 0x6688cc : 0x445577;

          this.baseStyles.set(key, { color: cellColor, opacity: 0.035, edgeColor });

          const mat = new THREE.MeshBasicMaterial({
            color: cellColor,
            transparent: true,
            opacity: 0.035,
            depthWrite: false,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(geo, mat);
          const [wx, wy, wz] = boardToWorld({ x, y, z });
          mesh.position.set(wx, wy, wz);
          mesh.userData = { cellPos: { x, y, z } };
          mesh.renderOrder = 0;
          this.group.add(mesh);
          this.cellMeshes.set(key, mesh);

          const lineMat = new THREE.LineDashedMaterial({
            color: edgeColor,
            dashSize: 0.08,
            gapSize: 0.06,
            transparent: true,
            opacity: 0.3,
          });
          const line = new THREE.LineSegments(edgeGeo, lineMat);
          line.position.set(wx, wy, wz);
          line.computeLineDistances();
          line.renderOrder = 1;
          this.group.add(line);
          this.cellEdges.set(key, line);
        }
      }
    }
  }

  highlightCells(moves: Position3D[], captures: Position3D[] = []): void {
    this.clearHighlights();
    this.captureKeys = new Set(captures.map(c => posKey(c)));

    for (const pos of moves) {
      const key = posKey(pos);
      this.highlightedCells.add(key);
      const isCapture = this.captureKeys.has(key);
      const mesh = this.cellMeshes.get(key);
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(isCapture ? 0xcc4422 : 0x22cc66);
        (mesh.material as THREE.MeshBasicMaterial).opacity = isCapture ? 0.22 : 0.18;
      }
      const edge = this.cellEdges.get(key);
      if (edge) {
        (edge.material as THREE.LineDashedMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
        (edge.material as THREE.LineDashedMaterial).opacity = 0.8;
      }
    }
  }

  selectCell(pos: Position3D): void {
    if (this.selectedCell) {
      this.restoreCell(this.selectedCell);
    }
    const key = posKey(pos);
    this.selectedCell = key;
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xddcc22);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffee44);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.9;
    }
  }

  clearHighlights(): void {
    for (const key of this.highlightedCells) {
      this.restoreCell(key);
    }
    this.highlightedCells.clear();
    if (this.selectedCell) {
      this.restoreCell(this.selectedCell);
      this.selectedCell = null;
    }
  }

  hoverCell(pos: Position3D): void {
    const key = posKey(pos);
    if (key === this.hoveredCell) return;

    this.clearHover();

    // Only hover on highlighted (valid move) cells
    if (!this.highlightedCells.has(key)) return;

    this.hoveredCell = key;
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xffffff);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.3;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (edge.material as THREE.LineDashedMaterial).opacity = 1.0;
    }
  }

  clearHover(): void {
    if (!this.hoveredCell) return;
    const key = this.hoveredCell;
    this.hoveredCell = null;

    // Restore back to its highlighted state (not base state)
    if (this.highlightedCells.has(key)) {
      this.reapplyHighlight(key);
    } else {
      this.restoreCell(key);
    }
  }

  private reapplyHighlight(key: string): void {
    const mesh = this.cellMeshes.get(key);
    const edge = this.cellEdges.get(key);
    const isCapture = this.captureKeys.has(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(isCapture ? 0xcc4422 : 0x22cc66);
      (mesh.material as THREE.MeshBasicMaterial).opacity = isCapture ? 0.22 : 0.18;
    }
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.8;
    }
  }

  private restoreCell(key: string): void {
    const base = this.baseStyles.get(key);
    if (!base) return;

    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(base.color);
      (mesh.material as THREE.MeshBasicMaterial).opacity = base.opacity;
    }

    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(base.edgeColor);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.3;
    }
  }

  isHighlighted(pos: Position3D): boolean {
    return this.highlightedCells.has(posKey(pos));
  }

  setLayerVisible(layer: number, visible: boolean): void {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const key = posKey({ x, y, z: layer });
        const mesh = this.cellMeshes.get(key);
        if (mesh) mesh.visible = visible;
        const edge = this.cellEdges.get(key);
        if (edge) edge.visible = visible;
      }
    }
  }

  getAllCellMeshes(): THREE.Mesh[] {
    return Array.from(this.cellMeshes.values());
  }
}
