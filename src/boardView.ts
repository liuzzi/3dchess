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
  cellMeshes: Map<number, THREE.Mesh> = new Map();
  cellEdges: Map<number, THREE.Points> = new Map();
  cellLines: Map<number, THREE.LineSegments> = new Map();
  private cellMeshList: THREE.Mesh[] = [];

  private highlightedCells: Set<number> = new Set();
  private captureKeys: Set<number> = new Set();
  private selectedCell: number | null = null;
  private hoveredCell: number | null = null;
  private pathPreviewCells: Set<number> = new Set();
  private lastMoveCells: Set<number> = new Set();
  private checkPathCells: Set<number> = new Set();
  private traversalCell: number | null = null;
  private threatArrows: THREE.Group[] = [];
  private dangerPreviewArrows: THREE.Group[] = [];
  private hoverThreatArrows: THREE.Group[] = [];
  private hoverProtectionArrows: THREE.Group[] = [];
  private thinkingArrows: THREE.Group[] = [];
  private thinkingGhosts: THREE.Group[] = [];
  private traversalFlashTimers: Map<number, number> = new Map();
  private thinkingFlashTimers: Map<number, number> = new Map();

  private baseStyles: Map<number, CellBase> = new Map();
  private frostingLevel: number = 0.02;

  constructor() {
    this.group = new THREE.Group();
    this.buildGrid();
  }

  private buildGrid(): void {
    const geo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const h = CELL_SIZE / 2;
    const dotGeo = new THREE.BufferGeometry();
    const corners = new Float32Array([
      -h, -h, -h,
       h, -h, -h,
      -h,  h, -h,
       h,  h, -h,
      -h, -h,  h,
       h, -h,  h,
      -h,  h,  h,
       h,  h,  h
    ]);
    dotGeo.setAttribute('position', new THREE.BufferAttribute(corners, 3));
    const lightBottom = new THREE.Color(0x6655bb);
    const lightTop = new THREE.Color(0x4466aa);
    const darkBottom = new THREE.Color(0x332255);
    const darkTop = new THREE.Color(0x223355);
    const edgeLightBottom = new THREE.Color(0x8877dd);
    const edgeLightTop = new THREE.Color(0x6688cc);
    const edgeDarkBottom = new THREE.Color(0x554477);
    const edgeDarkTop = new THREE.Color(0x445577);
    const tmp = new THREE.Color();

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, 2 * Math.PI);
    ctx.fillStyle = 'white';
    ctx.fill();
    const dotTexture = new THREE.CanvasTexture(canvas);

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

          this.baseStyles.set(key, { color: cellColor, opacity: this.frostingLevel, edgeColor });

          const mat = new THREE.MeshBasicMaterial({
            color: cellColor,
            transparent: true,
            opacity: this.frostingLevel,
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

          const dotMat = new THREE.PointsMaterial({
            color: edgeColor,
            size: 4,
            transparent: true,
            opacity: 0.15,
            sizeAttenuation: false,
            depthWrite: false,
            map: dotTexture,
            alphaTest: 0.05
          });
          const points = new THREE.Points(dotGeo, dotMat);
          points.position.set(wx, wy, wz);
          points.renderOrder = 1;
          this.group.add(points);
          this.cellEdges.set(key, points);

          const lineMat = new THREE.LineDashedMaterial({
            color: edgeColor,
            dashSize: 0.08,
            gapSize: 0.06,
            transparent: true,
            opacity: 0,
            depthWrite: false
          });
          const line = new THREE.LineSegments(edgeGeo, lineMat);
          line.position.set(wx, wy, wz);
          line.computeLineDistances();
          line.renderOrder = 2;
          this.group.add(line);
          this.cellLines.set(key, line);
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
      const line = this.cellLines.get(key);
      if (edge && line) {
        (edge.material as THREE.PointsMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
        (edge.material as THREE.PointsMaterial).opacity = 0.8;
        (line.material as THREE.LineDashedMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
        (line.material as THREE.LineDashedMaterial).opacity = 0.8;
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
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffee44);
      (edge.material as THREE.PointsMaterial).opacity = 0.9;
      (line.material as THREE.LineDashedMaterial).color.set(0xffee44);
      (line.material as THREE.LineDashedMaterial).opacity = 0.9;
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
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffffff);
      (edge.material as THREE.PointsMaterial).opacity = 1.0;
      (line.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (line.material as THREE.LineDashedMaterial).opacity = 1.0;
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
    const line = this.cellLines.get(nextKey);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffffff);
      (edge.material as THREE.PointsMaterial).opacity = 1.0;
      (line.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (line.material as THREE.LineDashedMaterial).opacity = 1.0;
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
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffffff);
      (edge.material as THREE.PointsMaterial).opacity = 1.0;
      (line.material as THREE.LineDashedMaterial).color.set(0xffffff);
      (line.material as THREE.LineDashedMaterial).opacity = 1.0;
    }

    const timer = window.setTimeout(() => {
      this.traversalFlashTimers.delete(key);
      this.restoreCell(key);
    }, durationMs);
    this.traversalFlashTimers.set(key, timer);
  }

  private reapplyHighlight(key: number): void {
    const mesh = this.cellMeshes.get(key);
    const edge = this.cellEdges.get(key);
    const line = this.cellLines.get(key);
    const isCapture = this.captureKeys.has(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(isCapture ? 0xcc4422 : 0x22cc66);
      (mesh.material as THREE.MeshBasicMaterial).opacity = isCapture ? 0.22 : 0.18;
    }
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
      (edge.material as THREE.PointsMaterial).opacity = 0.8;
      (line.material as THREE.LineDashedMaterial).color.set(isCapture ? 0xff6644 : 0x44ff88);
      (line.material as THREE.LineDashedMaterial).opacity = 0.8;
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

  private applyLastMoveStyle(key: number): void {
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xaa77dd);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.18;
    }
    const edge = this.cellEdges.get(key);
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xcc99ff);
      (edge.material as THREE.PointsMaterial).opacity = 0.7;
      (line.material as THREE.LineDashedMaterial).color.set(0xcc99ff);
      (line.material as THREE.LineDashedMaterial).opacity = 0.7;
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

  private applyCheckPathStyle(key: number): void {
    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(0xdd8833);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.16;
    }
    const edge = this.cellEdges.get(key);
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffaa55);
      (edge.material as THREE.PointsMaterial).opacity = 0.65;
      (line.material as THREE.LineDashedMaterial).color.set(0xffaa55);
      (line.material as THREE.LineDashedMaterial).opacity = 0.65;
    }
  }

  private restoreCell(key: number): void {
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

  private restoreCellToBase(key: number): void {
    const base = this.baseStyles.get(key);
    if (!base) return;

    const mesh = this.cellMeshes.get(key);
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(base.color);
      (mesh.material as THREE.MeshBasicMaterial).opacity = base.opacity;
    }

    const edge = this.cellEdges.get(key);
    if (edge) {
      (edge.material as THREE.PointsMaterial).color.set(base.edgeColor);
      (edge.material as THREE.PointsMaterial).opacity = 0.15;
    }

    const line = this.cellLines.get(key);
    if (line) {
      (line.material as THREE.LineDashedMaterial).opacity = 0;
    }
  }

  private isCellInSpecialState(key: number): boolean {
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
      const line = this.cellLines.get(key);
      if (edge && line) {
        (edge.material as THREE.PointsMaterial).color.set(0x99aabb);
        (edge.material as THREE.PointsMaterial).opacity = 0.4;
        (line.material as THREE.LineDashedMaterial).color.set(0x99aabb);
        (line.material as THREE.LineDashedMaterial).opacity = 0.4;
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
      const line = this.cellLines.get(key);
      if (edge && line) {
        (edge.material as THREE.PointsMaterial).color.set(0xff5555);
        (edge.material as THREE.PointsMaterial).opacity = 0.7;
        (line.material as THREE.LineDashedMaterial).color.set(0xff5555);
        (line.material as THREE.LineDashedMaterial).opacity = 0.7;
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
        const line = this.cellLines.get(key);
        if (edge && line) {
          (edge.material as THREE.PointsMaterial).color.set(0xffee44);
          (edge.material as THREE.PointsMaterial).opacity = 0.9;
          (line.material as THREE.LineDashedMaterial).color.set(0xffee44);
          (line.material as THREE.LineDashedMaterial).opacity = 0.9;
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

  showThreatLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearThreatLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff2222, 0.7);
      this.threatArrows.push(arrow);
    }
  }

  showDangerPreviewLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearDangerPreviewLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff8800, 0.6);
      this.dangerPreviewArrows.push(arrow);
    }
  }

  showHoverThreatLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearHoverThreatLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0xff8800, 0.6);
      this.hoverThreatArrows.push(arrow);
    }
  }

  showHoverProtectionLines(pairs: { from: Position3D; to: Position3D }[]): void {
    this.clearHoverProtectionLines();
    for (const { from, to } of pairs) {
      const origin = new THREE.Vector3(...boardToWorld(from));
      const dest = new THREE.Vector3(...boardToWorld(to));
      const arrow = this.createArrow(origin, dest, 0x3da7ff, 0.86);
      this.hoverProtectionArrows.push(arrow);
    }
  }

  clearHoverThreatLines(): void {
    for (const arrow of this.hoverThreatArrows) this.disposeArrow(arrow);
    this.hoverThreatArrows = [];
    this.clearHoverProtectionLines();
  }

  clearHoverProtectionLines(): void {
    for (const arrow of this.hoverProtectionArrows) this.disposeArrow(arrow);
    this.hoverProtectionArrows = [];
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
      this.thinkingGhosts.push(mesh);
    }
  }

  private clearThinkingGhosts(): void {
    for (const ghost of this.thinkingGhosts) {
      ghost.visible = false;
      const key = ghost.userData.poolKey;
      if (key) {
        if (!this.ghostPool.has(key)) this.ghostPool.set(key, []);
        this.ghostPool.get(key)!.push(ghost);
      }
    }
    this.thinkingGhosts = [];
  }

  private createThinkingGhostPiece(type: PieceType, color: PieceColor, plyT: number): THREE.Group {
    const key = `${type}-${color}`;
    let pool = this.ghostPool.get(key);
    if (!pool) {
      pool = [];
      this.ghostPool.set(key, pool);
    }

    let group: THREE.Group;
    if (pool.length > 0) {
      group = pool.pop()!;
      group.visible = true;
    } else {
      group = this.createThinkingGhostPieceBase(type, color);
      this.group.add(group);
    }

    const bodyHex = color === PieceColor.White ? 0xf0e6d2 : 0x2a2a3e;
    const tint = new THREE.Color(0xffdd33).lerp(new THREE.Color(0x33e6ff), plyT);
    const baseColor = new THREE.Color(bodyHex).lerp(tint, 0.3);

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.isBody) {
        (child.material as THREE.MeshStandardMaterial).color.copy(baseColor);
      }
    });

    return group;
  }

  private createThinkingGhostPieceBase(type: PieceType, color: PieceColor): THREE.Group {
    const group = new THREE.Group();
    group.userData.poolKey = `${type}-${color}`;
    const outlineColor = color === PieceColor.White ? 0xffffff : 0x111111;

    const makeBodyMat = () => new THREE.MeshStandardMaterial({
      color: 0xffffff,
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
      mainPart.userData.isBody = true;
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
    const line = this.cellLines.get(key);
    if (edge && line) {
      (edge.material as THREE.PointsMaterial).color.set(0xffee88);
      (edge.material as THREE.PointsMaterial).opacity = 0.95;
      (line.material as THREE.LineDashedMaterial).color.set(0xffee88);
      (line.material as THREE.LineDashedMaterial).opacity = 0.95;
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

  private arrowPool: THREE.Group[] = [];
  private ghostPool: Map<string, THREE.Group[]> = new Map();
  private readonly arrowDir = new THREE.Vector3();
  private readonly arrowNorm = new THREE.Vector3();
  private readonly arrowShaftEnd = new THREE.Vector3();
  private readonly arrowUp = new THREE.Vector3(0, 1, 0);

  private createArrow(from: THREE.Vector3, to: THREE.Vector3, color: number, opacity: number): THREE.Group {
    let arrow: THREE.Group;
    let line: THREE.Line;
    let cone: THREE.Mesh;

    if (this.arrowPool.length > 0) {
      arrow = this.arrowPool.pop()!;
      arrow.visible = true;
      line = arrow.children[0] as THREE.Line;
      cone = arrow.children[1] as THREE.Mesh;
    } else {
      arrow = new THREE.Group();
      const lineGeo = new THREE.BufferGeometry();
      const lineMat = new THREE.LineBasicMaterial({ depthTest: true });
      line = new THREE.Line(lineGeo, lineMat);
      arrow.add(line);

      const coneGeo = new THREE.ConeGeometry(1, 1, 8); // normalized cone
      const coneMat = new THREE.MeshBasicMaterial({ depthTest: true });
      cone = new THREE.Mesh(coneGeo, coneMat);
      arrow.add(cone);

      arrow.renderOrder = 10;
      this.group.add(arrow);
    }

    this.arrowDir.subVectors(to, from);
    const length = this.arrowDir.length();
    if (length === 0) {
      arrow.visible = false;
      this.arrowPool.push(arrow);
      return arrow;
    }

    this.arrowNorm.copy(this.arrowDir).normalize();
    const headLength = Math.min(0.3, length * 0.3);
    const headRadius = headLength * 0.45;

    this.arrowShaftEnd.copy(to).addScaledVector(this.arrowNorm, -headLength);
    line.geometry.setFromPoints([from, this.arrowShaftEnd]);
    (line.material as THREE.LineBasicMaterial).color.setHex(color);
    (line.material as THREE.LineBasicMaterial).opacity = opacity;
    (line.material as THREE.LineBasicMaterial).transparent = opacity < 1;

    cone.scale.set(headRadius, headLength, headRadius);
    cone.position.copy(to).addScaledVector(this.arrowNorm, -headLength / 2);
    cone.quaternion.setFromUnitVectors(this.arrowUp, this.arrowNorm);
    (cone.material as THREE.MeshBasicMaterial).color.setHex(color);
    (cone.material as THREE.MeshBasicMaterial).opacity = opacity;
    (cone.material as THREE.MeshBasicMaterial).transparent = opacity < 1;

    return arrow;
  }

  private disposeArrow(arrow: THREE.Group): void {
    arrow.visible = false;
    this.arrowPool.push(arrow);
  }

  getAllCellMeshes(): THREE.Mesh[] {
    return this.cellMeshList;
  }

  getCellMeshByKey(key: number): THREE.Mesh | undefined {
    return this.cellMeshes.get(key);
  }
}
