import * as THREE from 'three';
import { Position3D, PieceColor, PieceType, posKey, boardToWorld } from './types';

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
  private cellMeshList: THREE.Mesh[] = [];

  private highlightedCells: Set<string> = new Set();
  private captureKeys: Set<string> = new Set();
  private selectedCell: string | null = null;
  private hoveredCell: string | null = null;
  private pathPreviewCells: Set<string> = new Set();
  private lastMoveCells: Set<string> = new Set();
  private checkPathCells: Set<string> = new Set();
  private traversalCell: string | null = null;
  private threatArrows: THREE.Group[] = [];
  private dangerPreviewArrows: THREE.Group[] = [];
  private hoverThreatArrows: THREE.Group[] = [];
  private thinkingArrows: THREE.Group[] = [];
  private thinkingGhosts: THREE.Group[] = [];
  private traversalFlashTimers: Map<string, number> = new Map();
  private thinkingFlashTimers: Map<string, number> = new Map();

  private baseStyles: Map<string, CellBase> = new Map();
  private frostingLevel: number = 0.06;
  private outlineBrightness: number = 0.3;

  constructor() {
    this.group = new THREE.Group();
    this.buildGrid();
  }

  private buildGrid(): void {
    const geo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const lightBottom = new THREE.Color(0x6655bb);
    const lightTop = new THREE.Color(0x4466aa);
    const darkBottom = new THREE.Color(0x332255);
    const darkTop = new THREE.Color(0x223355);
    const edgeLightBottom = new THREE.Color(0x8877dd);
    const edgeLightTop = new THREE.Color(0x6688cc);
    const edgeDarkBottom = new THREE.Color(0x554477);
    const edgeDarkTop = new THREE.Color(0x445577);
    const tmp = new THREE.Color();

    for (let z = 0; z < 8; z++) {
      const t = z / 7;

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const key = posKey({ x, y, z });
          const isLight = (x + y + z) % 2 === 0;

          const cellColor = isLight
            ? tmp.copy(lightBottom).lerp(lightTop, t).getHex()
            : tmp.copy(darkBottom).lerp(darkTop, t).getHex();

          const edgeColor = isLight
            ? tmp.copy(edgeLightBottom).lerp(edgeLightTop, t).getHex()
            : tmp.copy(edgeDarkBottom).lerp(edgeDarkTop, t).getHex();

          this.baseStyles.set(key, { color: cellColor, opacity: 0.06, edgeColor });

          const mat = new THREE.MeshBasicMaterial({
            color: cellColor,
            transparent: true,
            opacity: 0.06,
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
          this.cellMeshList.push(mesh);

          const lineMat = new THREE.LineDashedMaterial({
            color: edgeColor,
            dashSize: 0.08,
            gapSize: 0.06,
            transparent: true,
            opacity: this.outlineBrightness,
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

  setTraversalCell(pos: Position3D | null): void {
    const nextKey = pos ? posKey(pos) : null;
    if (this.traversalCell === nextKey) return;

    if (this.traversalCell) {
      this.restoreCell(this.traversalCell);
      this.traversalCell = null;
    }

    if (!nextKey) return;
    this.traversalCell = nextKey;
    const mesh = this.cellMeshes.get(nextKey);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xe6fbff);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.34;
    }
    const edge = this.cellEdges.get(nextKey);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (edge.material as THREE.LineDashedMaterial).opacity = 1.0;
    }
  }

  flashTraversalCell(pos: Position3D, durationMs = 180): void {
    const key = posKey(pos);
    const existingTimer = this.traversalFlashTimers.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xe6fbff);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.34;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (edge.material as THREE.LineDashedMaterial).opacity = 1.0;
    }

    const timer = window.setTimeout(() => {
      this.traversalFlashTimers.delete(key);
      this.restoreCell(key);
    }, durationMs);
    this.traversalFlashTimers.set(key, timer);
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

  highlightLastMove(from: Position3D, to: Position3D): void {
    for (const key of this.lastMoveCells) {
      this.restoreCellToBase(key);
    }
    this.lastMoveCells.clear();

    const fromKey = posKey(from);
    const toKey = posKey(to);
    this.lastMoveCells.add(fromKey);
    this.lastMoveCells.add(toKey);

    this.applyLastMoveStyle(fromKey);
    this.applyLastMoveStyle(toKey);
  }

  clearLastMove(): void {
    for (const key of this.lastMoveCells) {
      this.restoreCellToBase(key);
    }
    this.lastMoveCells.clear();
  }

  private applyLastMoveStyle(key: string): void {
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xaa77dd);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.18;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xcc99ff);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.7;
    }
  }

  highlightCheckPath(cells: Position3D[]): void {
    this.clearCheckPath();
    for (const pos of cells) {
      const key = posKey(pos);
      this.checkPathCells.add(key);
      this.applyCheckPathStyle(key);
    }
  }

  clearCheckPath(): void {
    for (const key of this.checkPathCells) {
      this.restoreCellToBase(key);
    }
    this.checkPathCells.clear();
  }

  private applyCheckPathStyle(key: string): void {
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xdd8833);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.16;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffaa55);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.65;
    }
  }

  private restoreCell(key: string): void {
    if (this.lastMoveCells.has(key)) {
      this.applyLastMoveStyle(key);
      return;
    }
    if (this.checkPathCells.has(key)) {
      this.applyCheckPathStyle(key);
      return;
    }
    this.restoreCellToBase(key);
  }

  private restoreCellToBase(key: string): void {
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
      (edge.material as THREE.LineDashedMaterial).opacity = this.outlineBrightness;
    }
  }

  private isCellInSpecialState(key: string): boolean {
    return (
      this.highlightedCells.has(key) ||
      key === this.selectedCell ||
      key === this.hoveredCell ||
      this.pathPreviewCells.has(key) ||
      this.lastMoveCells.has(key) ||
      this.checkPathCells.has(key) ||
      key === this.traversalCell
    );
  }

  showPathPreview(clear: Position3D[], blocked: Position3D[]): void {
    this.clearPathPreview();

    for (const pos of clear) {
      const key = posKey(pos);
      this.pathPreviewCells.add(key);
      const mesh = this.cellMeshes.get(key);
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(0x8899aa);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.09;
      }
      const edge = this.cellEdges.get(key);
      if (edge) {
        (edge.material as THREE.LineDashedMaterial).color.set(0x99aabb);
        (edge.material as THREE.LineDashedMaterial).opacity = 0.4;
      }
    }

    for (const pos of blocked) {
      const key = posKey(pos);
      this.pathPreviewCells.add(key);
      const mesh = this.cellMeshes.get(key);
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(0xff3333);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.2;
      }
      const edge = this.cellEdges.get(key);
      if (edge) {
        (edge.material as THREE.LineDashedMaterial).color.set(0xff5555);
        (edge.material as THREE.LineDashedMaterial).opacity = 0.7;
      }
    }
  }

  clearPathPreview(): void {
    for (const key of this.pathPreviewCells) {
      if (key === this.selectedCell) {
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
      } else if (this.highlightedCells.has(key)) {
        this.reapplyHighlight(key);
      } else {
        this.restoreCell(key);
      }
    }
    this.pathPreviewCells.clear();
  }

  isHighlighted(pos: Position3D): boolean {
    return this.highlightedCells.has(posKey(pos));
  }

  setFrosting(level: number): void {
    this.frostingLevel = 0.005 + level * 0.495;
    for (const [key, mesh] of this.cellMeshes) {
      if (this.isCellInSpecialState(key)) continue;

      const base = this.baseStyles.get(key);
      if (!base) continue;
      base.opacity = this.frostingLevel;
      (mesh.material as THREE.MeshBasicMaterial).opacity = this.frostingLevel;
    }
  }

  setOutlineBrightness(level: number): void {
    this.outlineBrightness = Math.max(0, Math.min(level, 1));
    for (const [key, edge] of this.cellEdges) {
      if (this.isCellInSpecialState(key)) continue;
      (edge.material as THREE.LineDashedMaterial).opacity = this.outlineBrightness;
    }
  }

  showThreatLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearThreatLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff2222, 0.7);
      this.group.add(arrow);
      this.threatArrows.push(arrow);
    }
  }

  showDangerPreviewLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearDangerPreviewLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff8800, 0.6);
      this.group.add(arrow);
      this.dangerPreviewArrows.push(arrow);
    }
  }

  showHoverThreatLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearHoverThreatLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff8800, 0.6);
      this.group.add(arrow);
      this.hoverThreatArrows.push(arrow);
    }
  }

  clearHoverThreatLines(): void {
    for (const arrow of this.hoverThreatArrows) this.disposeArrow(arrow);
    this.hoverThreatArrows = [];
  }

  showThinkingLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.showThinkingLineSets([pairs]);
  }

  showThinkingLineSets(lines: { from: Position3D; to: Position3D }[][]): void {
    this.clearThinkingLines();
    if (lines.length === 0) return;
    const start = new THREE.Color(0xffdd33);
    const end = new THREE.Color(0x33e6ff);
    const maxBranch = Math.max(1, lines.length - 1);
    for (let branchIdx = 0; branchIdx < lines.length; branchIdx++) {
      const pairs = lines[branchIdx];
      const branchDim = branchIdx / maxBranch;
      const maxIdx = Math.max(1, pairs.length - 1);
      for (let i = 0; i < pairs.length; i++) {
        const { from, to } = pairs[i];
        const origin = new THREE.Vector3(...boardToWorld(from));
        const dest = new THREE.Vector3(...boardToWorld(to));
        const t = i / maxIdx;
        const color = start.clone().lerp(end, t).getHex();
        const baseOpacity = 0.56 - t * 0.14;
        const branchPenalty = branchIdx === 0 ? 0 : 0.16 + branchDim * 0.1;
        const opacity = Math.max(0.24, baseOpacity - branchPenalty);
        const arrow = this.createArrow(origin, dest, color, opacity);
        this.group.add(arrow);
        this.thinkingArrows.push(arrow);
      }
    }
  }

  clearThinkingLines(): void {
    for (const arrow of this.thinkingArrows) this.disposeArrow(arrow);
    this.thinkingArrows = [];
    this.clearThinkingGhosts();
  }

  showThinkingGhosts(ghosts: { pos: Position3D; color: PieceColor; type: PieceType; ply: number; lane?: number }[]): void {
    this.clearThinkingGhosts();
    const maxPly = Math.max(1, ghosts.reduce((m, g) => Math.max(m, g.ply), 0));
    for (const ghost of ghosts) {
      const [x, y, z] = boardToWorld(ghost.pos);
      const t = ghost.ply / maxPly;
      const mesh = this.createThinkingGhostPiece(ghost.type, ghost.color, t);
      const laneOffset = (ghost.lane ?? 0) * 0.04;
      mesh.position.set(x, y + 0.18 + laneOffset, z);
      mesh.renderOrder = 12;
      this.group.add(mesh);
      this.thinkingGhosts.push(mesh);
    }
  }

  private clearThinkingGhosts(): void {
    for (const ghost of this.thinkingGhosts) {
      ghost.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.group.remove(ghost);
    }
    this.thinkingGhosts = [];
  }

  private createThinkingGhostPiece(type: PieceType, color: PieceColor, plyT: number): THREE.Group {
    const group = new THREE.Group();
    const bodyHex = color === PieceColor.White ? 0xf0e6d2 : 0x2a2a3e;
    const tint = new THREE.Color(0xffdd33).lerp(new THREE.Color(0x33e6ff), plyT);
    const baseColor = new THREE.Color(bodyHex).lerp(tint, 0.3);
    const outlineColor = color === PieceColor.White ? 0xffffff : 0x111111;

    const makeBodyMat = () => new THREE.MeshStandardMaterial({
      color: baseColor.getHex(),
      metalness: 0.28,
      roughness: 0.62,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const makeOutlineMat = () => new THREE.MeshBasicMaterial({
      color: outlineColor,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    const addOutlinedPart = (
      geo: THREE.BufferGeometry,
      configure?: (mesh: THREE.Mesh) => void,
    ): void => {
      const mainPart = new THREE.Mesh(geo, makeBodyMat());
      configure?.(mainPart);
      group.add(mainPart);

      const outlinePart = new THREE.Mesh(geo.clone(), makeOutlineMat());
      outlinePart.scale.setScalar(1.1);
      configure?.(outlinePart);
      group.add(outlinePart);
    };

    let mainGeo: THREE.BufferGeometry;
    let height = 0.4;
    switch (type) {
      case PieceType.King: {
        mainGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8);
        height = 0.45;
        addOutlinedPart(new THREE.BoxGeometry(0.04, 0.14, 0.04), (mesh) => {
          mesh.position.y = 0.3;
        });
        addOutlinedPart(new THREE.BoxGeometry(0.1, 0.04, 0.04), (mesh) => {
          mesh.position.y = 0.28;
        });
        break;
      }
      case PieceType.Queen: {
        mainGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.42, 8);
        height = 0.42;
        addOutlinedPart(new THREE.SphereGeometry(0.06, 8, 8), (mesh) => {
          mesh.position.y = 0.27;
        });
        break;
      }
      case PieceType.Rook: {
        mainGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.32, 8);
        height = 0.32;
        addOutlinedPart(new THREE.CylinderGeometry(0.18, 0.16, 0.06, 8), (mesh) => {
          mesh.position.y = 0.19;
        });
        break;
      }
      case PieceType.Bishop: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.4, 8);
        height = 0.4;
        addOutlinedPart(new THREE.SphereGeometry(0.04, 6, 6), (mesh) => {
          mesh.position.y = 0.22;
        });
        break;
      }
      case PieceType.Knight: {
        mainGeo = new THREE.ConeGeometry(0.16, 0.36, 8);
        height = 0.36;
        addOutlinedPart(new THREE.BoxGeometry(0.1, 0.12, 0.16), (mesh) => {
          mesh.position.set(0.06, 0.14, 0);
          mesh.rotation.z = -0.4;
        });
        break;
      }
      case PieceType.Pawn: {
        mainGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.25, 8);
        height = 0.25;
        addOutlinedPart(new THREE.SphereGeometry(0.07, 8, 8), (mesh) => {
          mesh.position.y = 0.16;
        });
        break;
      }
    }

    addOutlinedPart(mainGeo);
    addOutlinedPart(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), (mesh) => {
      mesh.position.y = -height / 2;
    });
    group.scale.setScalar(1);
    return group;
  }

  flashThinkingCell(pos: Position3D, durationMs = 90): void {
    const key = posKey(pos);
    const existingTimer = this.thinkingFlashTimers.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xffdd44);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.26;
    }
    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.LineDashedMaterial).color.set(0xffee88);
      (edge.material as THREE.LineDashedMaterial).opacity = 0.95;
    }

    const timer = window.setTimeout(() => {
      this.thinkingFlashTimers.delete(key);
      this.restoreCell(key);
    }, durationMs);
    this.thinkingFlashTimers.set(key, timer);
  }

  clearDangerPreviewLines(): void {
    for (const arrow of this.dangerPreviewArrows) this.disposeArrow(arrow);
    this.dangerPreviewArrows = [];
  }

  clearThreatLines(): void {
    for (const arrow of this.threatArrows) this.disposeArrow(arrow);
    this.threatArrows = [];
  }

  private createArrow(from: THREE.Vector3, to: THREE.Vector3, color: number, opacity: number): THREE.Group {
    const arrow = new THREE.Group();
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    if (length === 0) return arrow;

    const norm = dir.clone().normalize();
    const headLength = Math.min(0.3, length * 0.3);
    const headRadius = headLength * 0.45;

    const shaftEnd = new THREE.Vector3().copy(to).addScaledVector(norm, -headLength);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([from, shaftEnd]);
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true });
    const line = new THREE.Line(lineGeo, lineMat);
    arrow.add(line);

    const coneGeo = new THREE.ConeGeometry(headRadius, headLength, 8);
    const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: true });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(to).addScaledVector(norm, -headLength / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);
    arrow.add(cone);

    arrow.renderOrder = 10;
    return arrow;
  }

  private disposeArrow(arrow: THREE.Group): void {
    arrow.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
    this.group.remove(arrow);
  }

  getAllCellMeshes(): THREE.Mesh[] {
    return this.cellMeshList;
  }
}
