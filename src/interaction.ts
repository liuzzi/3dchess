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
  private board: Board | null = null;
  private pieceView: PieceView | null = null;
  private highlightedKeys = new Set<string>();
  private pathPreviewActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressPiece: Piece | null = null;

  constructor(
    private renderer: Renderer,
    private boardView: BoardView,
  ) {
    const canvas = renderer.webgl.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => this.boardView.clearHover());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setClickHandler(cb: CellClickCallback): void {
    this.onCellClick = cb;
  }

  setBoard(board: Board): void {
    this.board = board;
  }

  setPieceView(pv: PieceView): void {
    this.pieceView = pv;
  }

  setHighlightedCells(keys: Set<string>): void {
    this.highlightedKeys = keys;
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

    const hadLongPressTimer = this.longPressTimer !== null;
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

    if (e.pointerType === 'touch' && !hadLongPressTimer) return;

    const pos = this.raycastBestCell(e.clientX, e.clientY);
    if (pos && this.onCellClick) {
      this.onCellClick(pos);
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    const pos = this.raycastClosestHighlighted(clientX, clientY);
    if (pos) {
      this.boardView.hoverCell(pos);
    } else {
      this.boardView.clearHover();
    }
  }

  private raycastClosestHighlighted(clientX: number, clientY: number): Position3D | null {
    if (this.highlightedKeys.size === 0) return null;

    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

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
    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

    const cellMeshes = this.boardView.getAllCellMeshes();
    const cellIntersects = this.raycaster.intersectObjects(cellMeshes, false);

    const hitCells: Position3D[] = [];
    for (const hit of cellIntersects) {
      const cellPos = hit.object.userData.cellPos as Position3D | undefined;
      if (cellPos) hitCells.push(cellPos);
    }

    for (const pos of hitCells) {
      if (this.highlightedKeys.has(posKey(pos))) return pos;
    }

    // Raycast piece meshes so clicks land on the piece you can actually see,
    // even when a closer cell (with a different piece) sits between the camera
    // and the target.
    if (this.pieceView) {
      const groups = this.pieceView.getAllPieceGroups();
      const pieceHits = this.raycaster.intersectObjects(groups, true);
      if (pieceHits.length > 0) {
        let obj: THREE.Object3D | null = pieceHits[0].object;
        while (obj && !(obj.userData as Record<string, unknown>)?.piece) {
          obj = obj.parent;
        }
        if (obj) {
          return (obj.userData.piece as Piece).position;
        }
      }
    }

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

    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

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
}
