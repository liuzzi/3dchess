import * as THREE from 'three';
import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Board } from './board';
import { Piece, Position3D, posKey } from './types';
import { getPiecePaths } from './movement';

const DRAG_THRESHOLD = 5;

export type CellClickCallback = (pos: Position3D) => void;

export class Interaction {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private mouseDownPos = new THREE.Vector2();
  private isPointerDown = false;
  private isDragging = false;
  private onCellClick: CellClickCallback | null = null;
  private onDeselect: (() => void) | null = null;
  private onHover: ((pos: Position3D | null) => void) | null = null;
  private canHoverPiece: ((piece: Piece) => boolean) | null = null;
  private board: Board | null = null;
  private pieceView: PieceView | null = null;
  private highlightedKeys = new Set<number>();
  private pathPreviewActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressPiece: Piece | null = null;
  private selectedKey: number | null = null;
  private ac = new AbortController();

  constructor(
    private renderer: Renderer,
    private boardView: BoardView,
  ) {
    const signal = this.ac.signal;
    const canvas = renderer.webgl.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    canvas.addEventListener('pointerleave', () => {
      this.boardView.clearHover();
      this.pieceView?.setHovered(null);
      this.onHover?.(null);
      canvas.style.cursor = 'default';
    }, { signal });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.onDeselect?.();
    }, { signal });
  }

  setClickHandler(cb: CellClickCallback): void {
    this.onCellClick = cb;
  }

  setDeselectHandler(cb: () => void): void {
    this.onDeselect = cb;
  }

  setHoverHandler(cb: (pos: Position3D | null) => void): void {
    this.onHover = cb;
  }

  setHoverFilter(cb: (piece: Piece) => boolean): void {
    this.canHoverPiece = cb;
  }

  setSelectedKey(key: number | null): void {
    this.selectedKey = key;
  }

  setBoard(board: Board): void {
    this.board = board;
  }

  setPieceView(pv: PieceView): void {
    this.pieceView = pv;
  }

  setHighlightedCells(keys: Set<number>): void {
    this.highlightedKeys = keys;
  }

  private setRayFromClient(clientX: number, clientY: number): void {
    const rect = this.renderer.webgl.domElement.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    this.mouse.x = nx * 2 - 1;
    this.mouse.y = -ny * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.beginPathPreview(e.clientX, e.clientY);
      return;
    }

    this.mouseDownPos.set(e.clientX, e.clientY);
    this.isPointerDown = true;
    this.isDragging = false;

    if (e.pointerType === 'touch') {
      this.clearLongPressTimer();
      this.longPressPiece = this.raycastPiece(e.clientX, e.clientY);
      if (this.longPressPiece) {
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          if (this.longPressPiece) {
            this.showPathPreviewForPiece(this.longPressPiece);
            this.longPressPiece = null;
          }
        }, 400);
      }
    }
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressPiece = null;
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.isPointerDown) {
      const dx = e.clientX - this.mouseDownPos.x;
      const dy = e.clientY - this.mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        this.isDragging = true;
        this.clearLongPressTimer();
        this.boardView.clearHover();
        this.pieceView?.setHovered(null);
        this.renderer.webgl.domElement.style.cursor = 'default';
        return;
      }
    }

    if (this.isDragging) return;

    this.updateHover(e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 2) {
      this.endPathPreview();
      return;
    }

    this.clearLongPressTimer();

    this.isPointerDown = false;

    if (this.pathPreviewActive) {
      this.endPathPreview();
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      return;
    }

    const pos = this.raycastBestCell(e.clientX, e.clientY);
    if (pos && this.onCellClick) {
      this.onCellClick(pos);
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    const pos = this.raycastClosestHighlighted(clientX, clientY);
    let canInteractWithPiece = false;
    const piece = this.raycastPiece(clientX, clientY);
    if (piece && (!this.canHoverPiece || this.canHoverPiece(piece))) {
      this.pieceView?.setHovered(piece);
      canInteractWithPiece = true;
    } else {
      this.pieceView?.setHovered(null);
    }

    this.renderer.webgl.domElement.style.cursor = canInteractWithPiece ? 'pointer' : 'default';

    if (pos) {
      this.boardView.hoverCell(pos);
    } else {
      this.boardView.clearHover();
    }
    this.onHover?.(pos);
  }

  private raycastClosestHighlighted(clientX: number, clientY: number): Position3D | null {
    if (this.highlightedKeys.size === 0) return null;

    this.setRayFromClient(clientX, clientY);

    const meshes = this.boardView.getAllCellMeshes();
    const intersects = this.raycaster.intersectObjects(meshes, false);

    for (const hit of intersects) {
      const cellPos = hit.object.userData.cellPos as Position3D | undefined;
      if (cellPos && this.highlightedKeys.has(posKey(cellPos))) {
        return cellPos;
      }
    }
    return null;
  }

  private raycastBestCell(clientX: number, clientY: number): Position3D | null {
    this.setRayFromClient(clientX, clientY);

    const cellMeshes = this.boardView.getAllCellMeshes();
    const cellIntersects = this.raycaster.intersectObjects(cellMeshes, false);

    const hitCells: Position3D[] = [];
    let closestHighlighted: { pos: Position3D; distance: number } | null = null;
    for (const hit of cellIntersects) {
      const cellPos = hit.object.userData.cellPos as Position3D | undefined;
      if (!cellPos) continue;
      hitCells.push(cellPos);
      if (this.highlightedKeys.has(posKey(cellPos)) && !closestHighlighted) {
        closestHighlighted = { pos: cellPos, distance: hit.distance };
      }
    }

    let closestPiece: { pos: Position3D; distance: number } | null = null;
    if (this.pieceView) {
      const groups = this.pieceView.getAllPieceGroups();
      const pieceHits = this.raycaster.intersectObjects(groups, true);
      for (const hit of pieceHits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !(obj.userData as Record<string, unknown>)?.piece) {
          obj = obj.parent;
        }
        if (obj) {
          closestPiece = { pos: (obj.userData.piece as Piece).position, distance: hit.distance };
          break;
        }
      }
    }

    // Clicking the selected piece should always return its position so the
    // game layer can deselect, even if highlighted cells on other layers are
    // in the ray's path.
    if (closestPiece && this.selectedKey && posKey(closestPiece.pos) === this.selectedKey) {
      return closestPiece.pos;
    }

    // Prioritize piece clicks over highlighted-cell clicks. In stacked 3D layers,
    // users often target a visible piece while highlighted cells from a previously
    // selected piece lie along the same ray path.
    if (closestPiece) return closestPiece.pos;

    if (closestHighlighted) return closestHighlighted.pos;

    if (this.board) {
      for (const pos of hitCells) {
        if (this.board.getPieceAt(pos)) return pos;
      }
    }

    if (hitCells.length > 0) return hitCells[0];
    return null;
  }

  private raycastPiece(clientX: number, clientY: number): Piece | null {
    if (!this.pieceView) return null;

    this.setRayFromClient(clientX, clientY);

    const groups = this.pieceView.getAllPieceGroups();
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !(obj.userData as Record<string, unknown>)?.piece) {
      obj = obj.parent;
    }
    return obj ? (obj.userData.piece as Piece) : null;
  }

  private beginPathPreview(clientX: number, clientY: number): void {
    const piece = this.raycastPiece(clientX, clientY);
    if (piece) this.showPathPreviewForPiece(piece);
  }

  private showPathPreviewForPiece(piece: Piece): void {
    if (!this.board) return;
    const paths = getPiecePaths(this.board, piece);
    this.boardView.showPathPreview(paths.clear, paths.blocked);
    this.pathPreviewActive = true;
  }

  private endPathPreview(): void {
    if (!this.pathPreviewActive) return;
    this.boardView.clearPathPreview();
    this.pathPreviewActive = false;
  }

  dispose(): void {
    this.ac.abort();
    this.clearLongPressTimer();
  }
}
