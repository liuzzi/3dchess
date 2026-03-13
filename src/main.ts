import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Interaction } from './interaction';
import { Game } from './game';
import { UI } from './ui';
import { Bot } from './bot';
import type { WorkerResponse } from './botWorker';
import { Network } from './network';
import * as THREE from 'three';
import { Piece, PieceColor, PieceType, Position3D, posKey, posEqual, GameMode, SetupMode, Difficulty, boardToWorld } from './types';
import { getLegalMoves, isKingInCheck } from './movement';
import { playAiThinkTick, playCapture, playCheck, playCheckmate, playStep } from './sound';
import { wireOnlineEvents } from './onlineBridge';
import { setupMenu, type MenuControllerHandle } from './menuController';
import {
  computeHoverThreatPreview,
  computeThreatLinesByAttacker,
  computeProtectionLinesForThreatenedPieces,
} from './threatPreview';
import { autoPromoteToQueen } from './promotion';
import { LobbyClient } from './lobbyClient';
import type { RoomInfo } from './lobbyTypes';

import { loadModels } from './modelLoader';

let renderer: Renderer;
let boardView: BoardView;
let pieceView: PieceView;
let game: Game;
let interaction: Interaction;
let ui: UI;
let bot: Bot | null = null;
let network: Network | null = null;
let lobbyClient: LobbyClient | null = null;
let menuController: MenuControllerHandle | null = null;
let menuHideTimeoutId: number | null = null;
let onlineFlowCancelled = false;
let hoverPreviewTargetKey: string | null = null;
let hoverPreviewRafPending = false;
let queuedHoverPos: Position3D | null = null;
let hoverPreviewTimerId: number | null = null;
let myThreatsActive = true;
let showProtectedActive = true;
let aiThinkingFxEnabled = false;
let isAnimatingMove = false;
let moveAnimationToken = 0;
let moveAnimationQueue: Promise<void> = Promise.resolve();
let botTurnToken = 0;
let activeBotAbortController: AbortController | null = null;
let lastAiFxBeepAt = 0;
let aiThinkingDepthArrowHoldUntil = 0;
let isCtrlPressed = false;
let gameStatusEl: HTMLElement | null = null;
let pendingMobileConfirmPos: Position3D | null = null;
let mobilePreviewOriginalWorldPos: THREE.Vector3 | null = null;
let mobilePreviewCapturedMesh: THREE.Group | null = null;
let mobilePreviewPiece: Piece | null = null;

const MOBILE_WIDTH_THRESHOLD = 768;

function isMobileScreen(): boolean {
  return window.innerWidth <= MOBILE_WIDTH_THRESHOLD;
}

function showMobileConfirmPreview(piece: Piece, targetPos: Position3D): void {
  pendingMobileConfirmPos = targetPos;
  mobilePreviewPiece = piece;

  const mesh = pieceView.getMeshForPiece(piece);
  if (mesh) {
    mobilePreviewOriginalWorldPos = mesh.position.clone();
    const [wx, wy, wz] = boardToWorld(targetPos);
    mesh.position.set(wx, wy, wz);
  }

  const capturedPiece = game.board.getPieceAt(targetPos);
  if (capturedPiece && capturedPiece.color !== piece.color) {
    const capturedMesh = pieceView.getMeshForPiece(capturedPiece);
    if (capturedMesh) {
      mobilePreviewCapturedMesh = capturedMesh;
      capturedMesh.visible = false;
    }
  }

  boardView.clearHighlights();
  boardView.clearThreatLines();
  boardView.clearDangerPreviewLines();
  boardView.clearHoverProtectionLines();
  boardView.clearHoverThreatLines();
  boardView.highlightLastMove(piece.position, targetPos);

  const preview = computeHoverThreatPreview(game.board, piece, targetPos);
  if (preview) {
    boardView.showThreatLines(preview.dangerPairs);
    boardView.showHoverThreatLines(preview.threatPairs);
    if (showProtectedActive) {
      boardView.showHoverProtectionLines(preview.protectionPairs);
    }
  }

  interaction.setHighlightedCells(new Set());

  const el = document.getElementById('mobile-move-confirm');
  if (el) el.classList.add('is-visible');
}

function revertMobilePreview(): void {
  if (mobilePreviewPiece && mobilePreviewOriginalWorldPos) {
    const mesh = pieceView.getMeshForPiece(mobilePreviewPiece);
    if (mesh) {
      mesh.position.copy(mobilePreviewOriginalWorldPos);
    }
  }

  if (mobilePreviewCapturedMesh) {
    mobilePreviewCapturedMesh.visible = true;
  }

  mobilePreviewOriginalWorldPos = null;
  mobilePreviewCapturedMesh = null;
  mobilePreviewPiece = null;
}

function hideMobileConfirm(): void {
  if (pendingMobileConfirmPos) {
    revertMobilePreview();
    boardView.clearLastMove();
    recalcThreatVisuals();
  }
  pendingMobileConfirmPos = null;
  const el = document.getElementById('mobile-move-confirm');
  if (el) el.classList.remove('is-visible');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Control' && !isCtrlPressed) {
    isCtrlPressed = true;
    updateHighlightedMoves();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    isCtrlPressed = false;
    updateHighlightedMoves();
  }
});
window.addEventListener('blur', () => {
  if (isCtrlPressed) {
    isCtrlPressed = false;
    updateHighlightedMoves();
  }
});

function updateHighlightedMoves() {
  if (!game || !game.selectedPiece) return;
  const piece = game.selectedPiece;
  let moves = game.validMoves;
  
  if (isCtrlPressed) {
    moves = moves.filter(m => 
      Math.abs(m.x - piece.position.x) <= 1 &&
      Math.abs(m.y - piece.position.y) <= 1 &&
      Math.abs(m.z - piece.position.z) <= 1
    );
  }

  const captures = moves.filter(m => {
    const occ = game.board.getPieceAt(m);
    return occ && occ.color !== piece.color;
  });

  boardView.highlightCells(moves, captures);
  boardView.selectCell(piece.position);
  interaction.setHighlightedCells(new Set(moves.map(m => posKey(m))));
  interaction.setSelectedKey(posKey(piece.position));
}

const MOVE_STEP_MS = 500;
const IMPACT_BURST_MS = 260;
const CELL_ENTRY_T = 0.5;
const EASY_BOT_MIN_THINK_MS = 2000;
const EASY_BOT_MAX_THINK_MS = 3000;
const AI_FX_DEV_DIAGNOSTICS =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function isStraightStepMove(from: Position3D, to: Position3D): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const dz = Math.abs(to.z - from.z);
  const stepCount = Math.max(dx, dy, dz);
  return [dx, dy, dz].every((d) => d === 0 || d === stepCount);
}

function buildStepPath(from: Position3D, to: Position3D): Position3D[] {
  if (!isStraightStepMove(from, to)) return [{ ...to }];

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const stepCount = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);

  const path: Position3D[] = [];
  for (let i = 1; i <= stepCount; i++) {
    path.push({
      x: from.x + sx * i,
      y: from.y + sy * i,
      z: from.z + sz * i,
    });
  }
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stopAiThinkingFx(): void {
  lastAiFxBeepAt = 0;
  aiThinkingDepthArrowHoldUntil = 0;
  if (boardView) {
    boardView.clearThinkingLines();
  }
}

function interruptBotThinking(): void {
  if (!activeBotAbortController && !game?.botThinking) return;
  botTurnToken++;
  activeBotAbortController?.abort();
  activeBotAbortController = null;
  if (bot) {
    bot.cancelThinking();
  }
  if (game) {
    game.botThinking = false;
  }
  stopAiThinkingFx();
}

function startAiThinkingFx(turnToken: number): void {
  if (!aiThinkingFxEnabled || !game || !boardView || !game.isBotTurn()) return;
  if (turnToken !== botTurnToken) return;
  stopAiThinkingFx();
}

function enqueueAiThinkingFx(progress: WorkerResponse, turnToken: number): void {
  if (!aiThinkingFxEnabled || !game || turnToken !== botTurnToken) return;
  if (!progress.fromPos || !progress.to) return;
  if (progress.type !== 'progress') return;
  if (progress.progressKind !== 'rootMove' && progress.progressKind !== 'depth') return;
  const now = performance.now();
  if (progress.progressKind === 'depth') {
    const pvSets = buildPvSetsForDisplay(progress);
    boardView.showThinkingLineSets(pvSets.map((line) => line.map(m => ({ from: m.fromPos, to: m.to }))));
    const ghosts: { pos: Position3D; color: PieceColor; type: PieceType; ply: number; lane?: number }[] = [];
    for (let lane = 0; lane < pvSets.length; lane++) {
      const line = pvSets[lane];
      const sim = game.board.clone();
      for (let i = 0; i < line.length; i++) {
        const step = line[i];
        const piece = sim.getPieceAt(step.fromPos);
        if (!piece) break;
        sim.applyMove(piece, step.to);
        autoPromoteToQueen(piece);
        ghosts.push({ pos: { ...piece.position }, color: piece.color, type: piece.type, ply: i, lane });
      }
    }
    boardView.showThinkingGhosts(ghosts);
    aiThinkingDepthArrowHoldUntil = now + 320;
  } else {
    // Root updates arrive very frequently; don't immediately overwrite PV subtree arrows.
    if (now >= aiThinkingDepthArrowHoldUntil) {
      boardView.showThinkingLines([{ from: progress.fromPos, to: progress.to }]);
        const moved = game.board.getPieceAt(progress.fromPos);
        boardView.showThinkingGhosts([{
          pos: progress.to,
          color: moved?.color ?? PieceColor.Black,
          type: moved?.type ?? PieceType.Pawn,
          ply: 0,
        }]);
    }
  }
  boardView.flashThinkingCell(progress.to, 42);
  if (now - lastAiFxBeepAt > 85) {
    playAiThinkTick();
    lastAiFxBeepAt = now;
  }
}

function pieceValueForFx(piece: Piece): number {
  switch (piece.type) {
    case 'pawn': return 100;
    case 'knight': return 320;
    case 'bishop': return 330;
    case 'rook': return 500;
    case 'queen': return 900;
    case 'king': return 20000;
    default: return 0;
  }
}

function buildPvForDisplay(pvLine: { fromPos: Position3D; to: Position3D }[]): { fromPos: Position3D; to: Position3D }[] {
  if (!game || pvLine.length === 0) return pvLine;
  if (pvLine.length >= 2) return pvLine;

  // If worker PV is truncated, infer one opponent reply for visualization clarity.
  const sim = game.board.clone();
  const first = pvLine[0];
  const firstPiece = sim.getPieceAt(first.fromPos);
  if (!firstPiece) return pvLine;
  sim.applyMove(firstPiece, first.to);
  autoPromoteToQueen(firstPiece);

  const enemy = firstPiece.color === PieceColor.White ? PieceColor.Black : PieceColor.White;

  let best: { fromPos: Position3D; to: Position3D; score: number } | null = null;
  for (const piece of sim.getPiecesOfColor(enemy)) {
    const legal = getLegalMoves(sim, piece);
    for (const to of legal) {
      const captured = sim.getPieceAt(to);
      const applied = sim.applyMove(piece, to);
      autoPromoteToQueen(piece);
      const givesCheck = isKingInCheck(sim, piece.color === PieceColor.White ? PieceColor.Black : PieceColor.White);
      sim.unapplyMove(applied);

      const score =
        (captured ? pieceValueForFx(captured) * 1.4 - pieceValueForFx(piece) * 0.2 : 0)
        + (givesCheck ? 160 : 0)
        + (3.5 - Math.abs(to.x - 3.5)) + (3.5 - Math.abs(to.y - 3.5)) + (3.5 - Math.abs(to.z - 3.5));
      if (!best || score > best.score) {
        best = { fromPos: { ...piece.position }, to: { ...to }, score };
      }
    }
  }

  return best ? [first, { fromPos: best.fromPos, to: best.to }] : pvLine;
}

function buildPvSetsForDisplay(progress: WorkerResponse): { fromPos: Position3D; to: Position3D }[][] {
  const baseCandidates = (progress.pvCandidates ?? [])
    .map((c) => c.pvLine)
    .filter((line) => line.length > 0);
  if (baseCandidates.length > 0) {
    return baseCandidates
      .slice(0, 3)
      .map((line) => buildPvForDisplay(line));
  }

  const basePv = (progress.pvLine && progress.pvLine.length > 0)
    ? progress.pvLine
    : [{ fromPos: progress.fromPos!, to: progress.to! }];
  return [buildPvForDisplay(basePv)];
}

const sharedShatterGeo = new THREE.BoxGeometry(1, 1, 1);
const sharedShatterWhiteMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7, metalness: 0.2 });
const sharedShatterBlackMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.2 });

const sharedFlashGeo = new THREE.SphereGeometry(0.12, 12, 12);
const sharedImpactGeo = new THREE.SphereGeometry(1, 8, 8);

interface EffectUpdate {
  // Return true when effect is finished.
  update(now: number): boolean;
}

const activeEffects: EffectUpdate[] = [];

function addEffect(effect: EffectUpdate): void {
  activeEffects.push(effect);
}

function tickEffects(now: number): void {
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    if (activeEffects[i].update(now)) {
      activeEffects.splice(i, 1);
    }
  }
}

function clearEffects(): void {
  activeEffects.length = 0;
}

function spawnShatterParticles(capturedPiece: Piece, pos: Position3D): void {
  if (!shatterParticlesGroup) return;

  const [x, y, z] = boardToWorld(pos);
  const center = new THREE.Vector3(x, y, z);

  const isWhite = capturedPiece.color === PieceColor.White;
  const mat = isWhite ? sharedShatterWhiteMat : sharedShatterBlackMat;

  const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; rotationAxis: THREE.Vector3; rotationSpeed: number }[] = [];
  const batchMeshes: THREE.Mesh[] = [];

  for (let i = 0; i < 30; i++) {
    const mesh = new THREE.Mesh(sharedShatterGeo, mat);
    const size = 0.05 + Math.random() * 0.1;
    mesh.scale.setScalar(size);

    mesh.position.set(
      center.x + (Math.random() - 0.5) * 0.5,
      center.y + (Math.random() - 0.5) * 0.5,
      center.z + (Math.random() - 0.5) * 0.5
    );

    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 4 + 2,
      (Math.random() - 0.5) * 4
    );

    const rotationAxis = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    const rotationSpeed = Math.random() * 10;

    particles.push({ mesh, velocity, rotationAxis, rotationSpeed });
    batchMeshes.push(mesh);
    shatterParticlesGroup.add(mesh);
  }

  shatterBatches.push(batchMeshes);

  let lastTime = performance.now();
  const floorY = -1.5;

  addEffect({
    update(now: number): boolean {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      let allSettled = true;

      for (const p of particles) {
        if (p.mesh.position.y > floorY || Math.abs(p.velocity.y) > 0.1 || Math.abs(p.velocity.x) > 0.1 || Math.abs(p.velocity.z) > 0.1) {
          allSettled = false;
          p.velocity.y -= 15 * dt;

          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mesh.rotateOnAxis(p.rotationAxis, p.rotationSpeed * dt);

          if (p.mesh.position.y <= floorY) {
            p.mesh.position.y = floorY;
            if (Math.abs(p.velocity.y) > 0.5) {
              p.velocity.y *= -0.4;
              p.velocity.x *= 0.6;
              p.velocity.z *= 0.6;
              p.rotationSpeed *= 0.6;
            } else {
              p.velocity.y = 0;
              p.velocity.x *= 0.9;
              p.velocity.z *= 0.9;
              p.rotationSpeed *= 0.9;
            }
          }
        }
      }

      return allSettled;
    },
  });
}

function spawnImpactBurst(pos: Position3D): void {
  const [x, y, z] = boardToWorld(pos);
  const center = new THREE.Vector3(x, y, z);
  const group = new THREE.Group();
  const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; material: THREE.MeshBasicMaterial; size: number }[] = [];

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.9,
  });
  const flash = new THREE.Mesh(sharedFlashGeo, flashMat);
  flash.position.copy(center);
  group.add(flash);

  const burstMat1 = new THREE.MeshBasicMaterial({ color: 0xff4d00, transparent: true, opacity: 0.95 });
  const burstMat2 = new THREE.MeshBasicMaterial({ color: 0xffa000, transparent: true, opacity: 0.95 });

  for (let i = 0; i < 14; i++) {
    const mat = i % 3 === 0 ? burstMat1 : burstMat2;
    const mesh = new THREE.Mesh(sharedImpactGeo, mat);
    const size = 0.03 + Math.random() * 0.03;
    mesh.scale.setScalar(size);
    mesh.position.copy(center);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.2) * 2.2,
      (Math.random() - 0.5) * 2,
    );
    particles.push({ mesh, velocity, material: mat, size });
    group.add(mesh);
  }

  renderer.scene.add(group);
  const start = performance.now();

  addEffect({
    update(now: number): boolean {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / IMPACT_BURST_MS);
      const fade = 1 - t;

      flash.scale.setScalar(1 + t * 1.8);
      flashMat.opacity = 0.9 * fade;

      for (const p of particles) {
        p.mesh.position.set(
          center.x + p.velocity.x * t,
          center.y + p.velocity.y * t - 0.5 * t * t,
          center.z + p.velocity.z * t,
        );
        p.material.opacity = 0.95 * fade;
        p.mesh.scale.setScalar(p.size * (1 - t * 0.35));
      }

      if (t < 1) return false;

      renderer.scene.remove(group);
      flashMat.dispose();
      burstMat1.dispose();
      burstMat2.dispose();
      return true;
    },
  });
}

async function animateMoveSteps(
  piece: Piece,
  from: Position3D,
  to: Position3D,
  token: number,
  captured: Piece | undefined,
): Promise<void> {
  const mesh = pieceView.getMeshForPiece(piece);
  if (!mesh) return;

  const path = buildStepPath(from, to);
  const worldPath = [from, ...path].map((p) => {
    const [x, y, z] = boardToWorld(p);
    return new THREE.Vector3(x, y, z);
  });

  mesh.position.copy(worldPath[0]);
  boardView.setTraversalCell(null);
  for (let i = 1; i < worldPath.length; i++) {
    if (token !== moveAnimationToken) return;
    const start = worldPath[i - 1];
    const end = worldPath[i];
    const enteredCell = path[i - 1];

    await new Promise<void>((resolve) => {
      const begin = performance.now();
      let enteredCellTriggered = false;
      const tick = (now: number): void => {
        if (token !== moveAnimationToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - begin) / MOVE_STEP_MS);
        mesh.position.lerpVectors(start, end, t);
        if (!enteredCellTriggered && t >= CELL_ENTRY_T) {
          enteredCellTriggered = true;
          boardView.setTraversalCell(enteredCell);
          playStep();
        }
        if (t < 1) {
          window.requestAnimationFrame(tick);
          return;
        }
        resolve();
      };
      window.requestAnimationFrame(tick);
    });

    if (token !== moveAnimationToken) return;
    if (captured && i === worldPath.length - 1) {
      playCapture();
      spawnImpactBurst(to);
      spawnShatterParticles(captured, to);
    }
  }
  boardView.setTraversalCell(null);
}

function oppositeColor(color: PieceColor): PieceColor {
  return color === PieceColor.White ? PieceColor.Black : PieceColor.White;
}

function resolvePerspectiveColor(): PieceColor {
  if (!game) return PieceColor.White;
  if (game.mode.type === 'online') return game.mode.localColor ?? game.currentTurn;
  if (game.mode.type === 'bot') {
    if (bot) return oppositeColor(bot.color);
    return PieceColor.White;
  }
  return game.currentTurn;
}

function recalcThreatVisuals(includeMyThreats = myThreatsActive): void {
  boardView.clearThreatLines();
  boardView.clearDangerPreviewLines();
  boardView.clearHoverProtectionLines();
  if (!game) return;

  const perspectiveColor = resolvePerspectiveColor();
  const attackerColor = oppositeColor(perspectiveColor);

  const threatsByAttacker = computeThreatLinesByAttacker(game.board);
  const enemyThreatPairs = attackerColor === PieceColor.White
    ? threatsByAttacker.white
    : threatsByAttacker.black;

  const myThreatPairs = perspectiveColor === PieceColor.White
    ? threatsByAttacker.white
    : threatsByAttacker.black;

  if (game.lastMove && enemyThreatPairs.length > 0) {
    boardView.showThreatLines(enemyThreatPairs);
  }

  if (includeMyThreats && myThreatPairs.length > 0) {
    boardView.showDangerPreviewLines(myThreatPairs);
  }

  if (!game.lastMove || !showProtectedActive || game.selectedPiece) return;
  const protectionPairs = computeProtectionLinesForThreatenedPieces(game.board, attackerColor, enemyThreatPairs);
  if (protectionPairs.length > 0) {
    boardView.showHoverProtectionLines(protectionPairs);
  }
}

function recalcThreatLines(): void {
  if (!game?.lastMove) {
    boardView.clearThreatLines();
    boardView.clearHoverProtectionLines();
    return;
  }
  recalcThreatVisuals(false);
}

function recalcMyThreats(): void {
  const hasGame = Boolean(game);
  if (!hasGame || !myThreatsActive) {
    boardView.clearDangerPreviewLines();
    return;
  }
  const hasLastMove = Boolean(game.lastMove);
  if (hasLastMove) {
    recalcThreatVisuals(myThreatsActive);
    return;
  }
  const perspectiveColor = resolvePerspectiveColor();
  const threatsByAttacker = computeThreatLinesByAttacker(game.board);
  const myThreatPairs = perspectiveColor === PieceColor.White
    ? threatsByAttacker.white
    : threatsByAttacker.black;
  if (myThreatPairs.length > 0) {
    boardView.showDangerPreviewLines(myThreatPairs);
  } else {
    boardView.clearDangerPreviewLines();
  }
}

function queueHoverPreview(pos: Position3D | null): void {
  if (pendingMobileConfirmPos) return;
  queuedHoverPos = pos;
  if (!game.selectedPiece) {
    if (hoverPreviewTimerId !== null) {
      window.clearTimeout(hoverPreviewTimerId);
      hoverPreviewTimerId = null;
    }
    if (hoverPreviewTargetKey !== null) {
      hoverPreviewTargetKey = null;
      boardView.clearHoverThreatLines();
      recalcThreatVisuals();
    }
    return;
  }

  if (!pos) {
    if (hoverPreviewTimerId !== null) {
      window.clearTimeout(hoverPreviewTimerId);
      hoverPreviewTimerId = null;
    }
    if (hoverPreviewTargetKey === null) return;
    if (hoverPreviewRafPending) return;
    hoverPreviewRafPending = true;
    window.requestAnimationFrame(() => {
      hoverPreviewRafPending = false;
      const nextPos = queuedHoverPos;
      queuedHoverPos = null;
      if (!nextPos || !game.selectedPiece) {
        hoverPreviewTargetKey = null;
        boardView.clearHoverThreatLines();
        recalcThreatVisuals();
      }
    });
    return;
  }

  if (hoverPreviewTimerId !== null) {
    window.clearTimeout(hoverPreviewTimerId);
  }
  hoverPreviewTimerId = window.setTimeout(() => {
    hoverPreviewTimerId = null;
    const nextPos = queuedHoverPos;
    queuedHoverPos = null;

    if (!nextPos || !game.selectedPiece) {
      hoverPreviewTargetKey = null;
      boardView.clearHoverThreatLines();
      recalcThreatVisuals();
      return;
    }

    const targetKey = `${posKey(game.selectedPiece.position)}->${posKey(nextPos)}`;
    if (targetKey === hoverPreviewTargetKey) return;
    hoverPreviewTargetKey = targetKey;

    boardView.clearDangerPreviewLines();
    boardView.clearHoverThreatLines();
    const preview = computeHoverThreatPreview(game.board, game.selectedPiece, nextPos);
    if (!preview) return;
    boardView.showThreatLines(preview.dangerPairs);
    boardView.showHoverThreatLines(preview.threatPairs);
    if (showProtectedActive) {
      boardView.showHoverProtectionLines(preview.protectionPairs);
    } else {
      boardView.clearHoverProtectionLines();
    }
  }, 55);
}

let shatterParticlesGroup: THREE.Group | null = null;
// Each entry is one capture's worth of meshes, in capture order
const shatterBatches: THREE.Mesh[][] = [];

function disposeCurrentGame(): void {
  if (renderer) renderer.dispose();
  if (interaction) interaction.dispose();
  if (ui) ui.dispose();
  if (game) game.removeAllListeners();
  clearEffects();
  clearAllShatterParticles();
  shatterParticlesGroup = null;
}

function disposeMeshes(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    shatterParticlesGroup?.remove(mesh);
    // Geometries and materials are shared, so do not dispose them here.
  }
}

function clearAllShatterParticles(): void {
  for (const batch of shatterBatches) disposeMeshes(batch);
  shatterBatches.length = 0;
}

function clearLastShatterBatch(): void {
  const batch = shatterBatches.pop();
  if (batch) disposeMeshes(batch);
}

function initGame(mode: GameMode): void {
  disposeCurrentGame();
  myThreatsActive = true;
  showProtectedActive = true;
  isAnimatingMove = false;
  moveAnimationToken++;
  moveAnimationQueue = Promise.resolve();
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

  renderer = new Renderer(canvas);
  boardView = new BoardView();
  pieceView = new PieceView();
  game = new Game();
  game.setMode(mode);
  interaction = new Interaction(renderer, boardView);

  ui = new UI(game, boardView, {
    onMoveHover: (pos: Position3D | null) => {
      if (pos) {
        boardView.hoverCell(pos);
      } else {
        boardView.clearHover();
      }
      queueHoverPreview(pos);
    },
    onMyThreatsToggle: (enabled: boolean) => {
      myThreatsActive = enabled;
      recalcMyThreats();
    },
    onShowProtectedToggle: (enabled: boolean) => {
      showProtectedActive = enabled;
      if (!enabled) {
        boardView.clearHoverProtectionLines();
      } else if (!game.selectedPiece) {
        recalcThreatVisuals();
      }
    },
    onAiThinkingFxToggle: (enabled: boolean) => {
      aiThinkingFxEnabled = enabled;
      if (!enabled) stopAiThinkingFx();
    },
  });

  interaction.setBoard(game.board);
  interaction.setPieceView(pieceView);

  shatterParticlesGroup = new THREE.Group();
  renderer.scene.add(shatterParticlesGroup);

  renderer.scene.add(boardView.group);
  renderer.scene.add(pieceView.group);

  pieceView.sync(game.board);
  ui.setMyThreatsEnabled(true);
  ui.setShowProtectedEnabled(true);
  ui.setAiThinkingFxEnabled(false);
  recalcMyThreats();

  interaction.setClickHandler((pos: Position3D) => {
    if (isAnimatingMove) return;

    if (isMobileScreen() && game.selectedPiece) {
      const clickedPiece = game.board.getPieceAt(pos);
      const isOwnPiece = clickedPiece && clickedPiece.color === game.currentTurn;
      const isValidTarget = game.validMoves.some(m => posEqual(m, pos));

      if (!isOwnPiece && isValidTarget) {
        if (pendingMobileConfirmPos && posEqual(pendingMobileConfirmPos, pos)) {
          return;
        }
        hideMobileConfirm();
        showMobileConfirmPreview(game.selectedPiece, pos);
        return;
      }
    }

    hideMobileConfirm();
    game.handleCellClick(pos);
  });

  interaction.setDeselectHandler(() => {
    hideMobileConfirm();
    game.deselect();
  });

  const mobileConfirmYes = document.getElementById('mobile-confirm-yes');
  const mobileConfirmNo = document.getElementById('mobile-confirm-no');
  mobileConfirmYes?.addEventListener('click', () => {
    const pos = pendingMobileConfirmPos;
    revertMobilePreview();
    pendingMobileConfirmPos = null;
    const el = document.getElementById('mobile-move-confirm');
    if (el) el.classList.remove('is-visible');
    if (pos) game.handleCellClick(pos);
  });
  mobileConfirmNo?.addEventListener('click', () => {
    hideMobileConfirm();
    game.deselect();
  });

  interaction.setHoverFilter((piece: Piece) => {
    if (isAnimatingMove) return false;
    if (game.gameOver || game.awaitingPromotion || game.botThinking) return false;
    if (game.isBotTurn() || game.isRemoteTurn()) return false;
    return piece.color === game.currentTurn;
  });

  interaction.setHoverHandler((pos: Position3D | null) => {
    ui.setHoveredMove(pos);
    queueHoverPreview(pos);
  });

  interaction.setPieceHoverHandler((piece: Piece | null, x: number, y: number) => {
    const tooltip = document.getElementById('piece-tooltip');
    if (!tooltip) return;
    if (piece) {
      tooltip.textContent = piece.type;
      tooltip.style.left = `${x + 15}px`;
      tooltip.style.top = `${y + 15}px`;
      tooltip.classList.add('is-visible');
    } else {
      tooltip.classList.remove('is-visible');
    }
  });

  if (bot) {
    bot.terminate();
    bot = null;
  }
  if (mode.type === 'bot' && mode.difficulty) {
    bot = new Bot(PieceColor.Black, mode.difficulty, mode.setup ?? 'classic');
  }

  if (mode.type === 'online' && network) {
    wireOnlineEvents(network, game);
  }

  game.on((event) => {
    switch (event.type) {
      case 'select': {
        hideMobileConfirm();
        hoverPreviewTargetKey = null;
        boardView.clearHoverProtectionLines();
        updateHighlightedMoves();
        pieceView.setSelected(game.selectedPiece);
        break;
      }
      case 'deselect':
        hideMobileConfirm();
        hoverPreviewTargetKey = null;
        boardView.clearHighlights();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        pieceView.setSelected(null);
        recalcThreatVisuals();
        break;
      case 'move': {
        stopAiThinkingFx();
        hoverPreviewTargetKey = null;
        const { piece, from, to, captured } = event.data;
        const token = moveAnimationToken;
        boardView.clearCheckPath();
        boardView.clearHoverThreatLines();
        boardView.highlightLastMove(from, to);
        recalcThreatVisuals();
        moveAnimationQueue = moveAnimationQueue.then(async () => {
          if (token !== moveAnimationToken) return;
          isAnimatingMove = true;
          let shouldFinalize = false;
          try {
            await animateMoveSteps(piece, from, to, token, captured);
            if (token === moveAnimationToken) {
              boardView.setTraversalCell(null);
              pieceView.sync(game.board);
              shouldFinalize = true;
            }
          } finally {
            boardView.setTraversalCell(null);
            if (token === moveAnimationToken) {
              isAnimatingMove = false;
            }
          }
          if (shouldFinalize && token === moveAnimationToken) {
            game.finalizeMove();
          }
        });
        break;
      }
      case 'capture':
        break;
      case 'promotion': {
        const { piece: promoted } = event.data;
        pieceView.rebuildPiece(promoted);
        break;
      }
      case 'check': {
        const { checkPath } = event.data;
        boardView.highlightCheckPath(checkPath);
        playCheck();
        break;
      }
      case 'checkmate':
        playCheckmate();
        break;
      case 'reset':
        stopAiThinkingFx();
        hoverPreviewTargetKey = null;
        moveAnimationToken++;
        isAnimatingMove = false;
        clearEffects();
        pieceView.sync(game.board);
        pieceView.setSelected(null);
        boardView.clearHighlights();
        boardView.clearLastMove();
        boardView.clearCheckPath();
        boardView.clearThreatLines();
        boardView.clearDangerPreviewLines();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setBoard(game.board);
        clearAllShatterParticles();
        break;
      case 'undo': {
        interruptBotThinking();
        stopAiThinkingFx();
        hoverPreviewTargetKey = null;
        moveAnimationToken++;
        isAnimatingMove = false;
        clearEffects();
        const { lastMove } = event.data;
        pieceView.sync(game.board);
        pieceView.setSelected(null);
        boardView.clearHighlights();
        boardView.clearLastMove();
        boardView.clearCheckPath();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        interaction.setBoard(game.board);
        clearLastShatterBatch();

        if (lastMove) {
          boardView.highlightLastMove(lastMove.from, lastMove.to);
        }
        recalcThreatVisuals();
        break;
      }
      case 'botTurn':
        // Ensure bot search starts only after move animation pipeline has fully settled.
        moveAnimationQueue = moveAnimationQueue.then(async () => {
          if (isAnimatingMove) return;
          await Promise.resolve();
          if (!isAnimatingMove) await handleBotTurn();
        });
        break;
    }
  });

  renderer.startLoop(() => {
    tickEffects(performance.now());
    pieceView.updateLods(renderer.camera);
  });
}

async function handleBotTurn(): Promise<void> {
  if (!bot || !game) return;
  const turnToken = ++botTurnToken;
  const abortController = new AbortController();
  activeBotAbortController = abortController;
  startAiThinkingFx(turnToken);

  if (!gameStatusEl) gameStatusEl = document.getElementById('game-status');
  const statusEl = gameStatusEl;
  if (!statusEl) return;
  statusEl.textContent = 'Thinking...';
  const thinkStart = performance.now();
  const fxDiag = AI_FX_DEV_DIAGNOSTICS && aiThinkingFxEnabled
    ? {
      depthEvents: 0,
      depthEventsWithSubtree: 0,
      maxPvLen: 0,
      maxDepth: 0,
    }
    : null;

  try {
    const onProgress = aiThinkingFxEnabled
      ? (progress: WorkerResponse) => {
        if (fxDiag && progress.type === 'progress' && progress.progressKind === 'depth') {
          const candidateMax = Math.max(
            progress.pvLine?.length ?? 0,
            ...((progress.pvCandidates ?? []).map((c) => c.pvLine.length)),
          );
          fxDiag.depthEvents++;
          if (candidateMax >= 2) fxDiag.depthEventsWithSubtree++;
          if (candidateMax > fxDiag.maxPvLen) fxDiag.maxPvLen = candidateMax;
          if ((progress.completedDepth ?? 0) > fxDiag.maxDepth) fxDiag.maxDepth = progress.completedDepth ?? 0;
        }
        enqueueAiThinkingFx(progress, turnToken);
      }
      : undefined;
    const move = await bot.pickMove(
      game.board,
      onProgress,
      abortController.signal,
    );
    if (turnToken !== botTurnToken) return;
    if (bot.difficulty === 'easy') {
      const targetThinkMs =
        EASY_BOT_MIN_THINK_MS + Math.random() * (EASY_BOT_MAX_THINK_MS - EASY_BOT_MIN_THINK_MS);
      const elapsedMs = performance.now() - thinkStart;
      if (elapsedMs < targetThinkMs) {
        await sleep(targetThinkMs - elapsedMs);
    }
    }
    if (turnToken !== botTurnToken) return;
    if (game.gameOver || !game.isBotTurn()) return;

    stopAiThinkingFx();
    game.botThinking = false;
    const moved = game.makeMove(move.piece, move.to);
    if (!moved) {
      throw new Error('Bot produced illegal move at execution time');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    if (!game || turnToken !== botTurnToken) return;
    game.botThinking = false;
    statusEl.textContent = '';
  } finally {
    if (fxDiag) {
      const elapsed = Math.round(performance.now() - thinkStart);
      console.debug(
        `[AI FX] turn=${turnToken} depthEvents=${fxDiag.depthEvents} depthEventsWithSubtree=${fxDiag.depthEventsWithSubtree} maxPvLen=${fxDiag.maxPvLen} maxDepth=${fxDiag.maxDepth} thinkMs=${elapsed}`,
      );
    }
    if (activeBotAbortController === abortController) {
      activeBotAbortController = null;
    }
    if (turnToken === botTurnToken) stopAiThinkingFx();
  }
}

function showGame(): void {
  document.body.classList.add('game-active');
  document.querySelectorAll('.game-hidden').forEach(el => {
    el.classList.remove('game-hidden');
  });
}

function hideGame(): void {
  const gameElementIds = [
    'game-frame',
    'ui-overlay',
    'side-panel',
    'move-panel',
    'move-panel-toggle',
    'side-panel-toggle',
    'promo-modal',
    'game-canvas',
    'piece-tooltip',
  ];
  gameElementIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('game-hidden');
    }
  });

  const promoModal = document.getElementById('promo-modal');
  promoModal?.classList.add('modal-hidden');
}

function hideMenu(): void {
  const menu = document.getElementById('menu-screen')!;
  if (menuHideTimeoutId !== null) {
    window.clearTimeout(menuHideTimeoutId);
  }
  menu.classList.add('menu-fade-out');
  menuHideTimeoutId = window.setTimeout(() => {
    menu.style.display = 'none';
    menuHideTimeoutId = null;
  }, 400);
}

function showMenu(): void {
  document.body.classList.remove('game-active');
  const menu = document.getElementById('menu-screen')!;
  if (menuHideTimeoutId !== null) {
    window.clearTimeout(menuHideTimeoutId);
    menuHideTimeoutId = null;
  }
  menu.classList.remove('menu-fade-out');
  menu.style.display = 'flex';
  menuController?.resetToMainMenu();
}

function returnToMenuFromGame(): void {
  cleanupLobbyClient();
  if (network) {
    if (game && game.mode.type === 'online' && !game.gameOver) {
      network.sendResign();
    }
    network.disconnect();
    network = null;
  }

  if (bot) {
    bot.terminate();
    bot = null;
  }

  hideGame();
  showMenu();
  window.location.hash = '';
}

function showLobbyView(viewId: string): void {
  const lobby = document.getElementById('online-lobby')!;
  lobby.style.display = 'flex';
  for (const view of ['lobby-browse', 'lobby-create', 'lobby-quick', 'lobby-waiting']) {
    const el = document.getElementById(view);
    if (el) el.style.display = view === viewId ? '' : 'none';
  }
}

function showWaitingView(title: string, status: string, pulse = true): void {
  showLobbyView('lobby-waiting');
  const lobbyTitle = document.getElementById('lobby-title')!;
  const linkRow = document.getElementById('lobby-link-row')!;
  const statusEl = document.getElementById('lobby-status')!;
  lobbyTitle.textContent = title;
  lobbyTitle.style.animation = pulse ? 'lobbyPulse 2s ease-in-out infinite' : 'none';
  linkRow.style.display = 'none';
  statusEl.textContent = status;
}

function hideLobby(): void {
  document.getElementById('online-lobby')!.style.display = 'none';
}

function describeOnlineError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

function handleLobbyError(err: unknown, fallback: string): void {
  console.error(fallback, err);
  showWaitingView('Connection failed', describeOnlineError(err, fallback), false);
  if (network) { network.disconnect(); network = null; }
  if (lobbyClient) { lobbyClient.disconnect(); lobbyClient = null; }
}

function cleanupLobbyClient(): void {
  if (lobbyClient) {
    lobbyClient.disconnect();
    lobbyClient = null;
  }
}

/* ─── Reusable PeerJS handshake helpers ─── */

async function runHostHandshake(localColor: PieceColor, setup: SetupMode): Promise<void> {
  if (!network) throw new Error('No network');
  const statusEl = document.getElementById('lobby-status')!;

  statusEl.textContent = 'Opponent connecting...';
  await network.waitForGuest((msg) => { statusEl.textContent = msg; });
  if (onlineFlowCancelled || !network) return;

  statusEl.textContent = 'Verifying session...';
  const hello = await network.waitForHello();
  if (!network.isProtocolCompatible(hello.protocolVersion)) {
    throw new Error('Incompatible game version with opponent');
  }
  if (hello.hostColor !== localColor || hello.setup !== setup) {
    throw new Error('Session settings mismatch');
  }

  network.sendReady();
  statusEl.textContent = 'Finalizing...';
  await network.waitForReady();
  if (onlineFlowCancelled || !network) return;

  hideLobby();
  showGame();
  initGame({ type: 'online', localColor, setup });
  network.sendStart();
}

async function runGuestHandshake(hostPeerId: string, hostColor: PieceColor, setup: SetupMode): Promise<void> {
  if (!network) throw new Error('No network');
  const statusEl = document.getElementById('lobby-status')!;
  const localColor = hostColor === PieceColor.White ? PieceColor.Black : PieceColor.White;

  statusEl.textContent = 'Connecting to opponent...';
  await network.join(hostPeerId, (msg) => { statusEl.textContent = msg; });
  if (onlineFlowCancelled || !network) return;

  statusEl.textContent = 'Negotiating session...';
  network.sendHello(hostColor, setup);
  await network.waitForReady();
  if (onlineFlowCancelled || !network) return;

  network.sendReady();
  statusEl.textContent = 'Starting game...';
  await network.waitForStart();
  if (onlineFlowCancelled || !network) return;

  hideLobby();
  showGame();
  initGame({ type: 'online', localColor, setup });
}

/* ─── Direct link flows (kept for backward compat) ─── */

async function startOnlineGuest(hostPeerId: string, hostColor: PieceColor, setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;
  network = new Network();

  const menuScreen = document.getElementById('menu-screen')!;
  menuScreen.style.display = 'none';

  const localColor = hostColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  showWaitingView('Connecting...', `You are playing as ${localColor}. Attempting to connect...`);

  try {
    await runGuestHandshake(hostPeerId, hostColor, setup);
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not connect to host. The link may be expired or the host may be offline.');
  }
}

/* ─── Main online lobby screen ─── */

async function goOnline(): Promise<void> {
  onlineFlowCancelled = false;
  hideMenu();
  showLobbyView('lobby-browse');

  try {
    lobbyClient = new LobbyClient();
    await lobbyClient.connect();
    if (onlineFlowCancelled) return;

    lobbyClient.onMessage((msg) => {
      if (msg.type === 'roomList') {
        renderRoomTable(msg.rooms as RoomInfo[]);
      } else if (msg.type === 'roomJoined') {
        showWaitingView('Joining game...', 'Connecting to host...');
        joinViaLobby(msg.hostPeerId, msg.hostColor as PieceColor, msg.setup as SetupMode);
      } else if (msg.type === 'inviteMatched') {
        showWaitingView('Joining game...', 'Connecting to host...');
        joinViaLobby(msg.hostPeerId, msg.hostColor as PieceColor, msg.setup as SetupMode);
      } else if (msg.type === 'error') {
        const statusEl = document.getElementById('lobby-status');
        if (statusEl) statusEl.textContent = msg.message;
      }
    });

    lobbyClient.onDisconnect(() => {
      const heading = document.getElementById('lobby-heading');
      if (heading) heading.textContent = 'Disconnected';
    });

    lobbyClient.listRooms();

    wireCreateView();
    wireQuickPlayView();
    wireBrowseActions();
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not connect to lobby.');
  }
}

function wireCreateView(): void {
  const createBtn = document.getElementById('lobby-create-btn')!;
  const startBtn = document.getElementById('create-start-btn')!;
  const backBtn = document.getElementById('create-back-btn')!;

  const colorBtns = document.querySelectorAll<HTMLButtonElement>('#create-color-buttons .create-toggle-btn');
  const visBtns = document.querySelectorAll<HTMLButtonElement>('#create-vis-buttons .create-toggle-btn');

  const wireToggleGroup = (btns: NodeListOf<HTMLButtonElement>) => {
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  };
  wireToggleGroup(colorBtns);
  wireToggleGroup(visBtns);

  createBtn.addEventListener('click', () => {
    showLobbyView('lobby-create');
  });

  backBtn.addEventListener('click', () => {
    showLobbyView('lobby-browse');
  });

  startBtn.addEventListener('click', () => {
    const setup = (document.getElementById('create-mode-select') as HTMLSelectElement).value as SetupMode;
    const color = document.querySelector<HTMLButtonElement>('#create-color-buttons .selected')?.dataset.color as PieceColor ?? 'white';
    const vis = document.querySelector<HTMLButtonElement>('#create-vis-buttons .selected')?.dataset.vis ?? 'public';

    if (vis === 'private') {
      createInviteWithColor(color, setup);
    } else {
      createRoomWithColor(color, setup);
    }
  });
}

function wireQuickPlayView(): void {
  const quickBtn = document.getElementById('lobby-quick-btn')!;
  const startBtn = document.getElementById('quick-start-btn')!;
  const backBtn = document.getElementById('quick-back-btn')!;

  quickBtn.addEventListener('click', () => {
    showLobbyView('lobby-quick');
  });

  backBtn.addEventListener('click', () => {
    showLobbyView('lobby-browse');
  });

  startBtn.addEventListener('click', () => {
    const setup = (document.getElementById('quick-mode-select') as HTMLSelectElement).value as SetupMode;
    startQuickPlay(setup);
  });
}

function wireBrowseActions(): void {
  const codeInput = document.getElementById('room-code-input') as HTMLInputElement;
  const codeJoinBtn = document.getElementById('room-code-join-btn')!;
  codeJoinBtn.onclick = () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length > 0 && lobbyClient) {
      lobbyClient.acceptInvite(code);
    }
  };
  codeInput.onkeydown = (e) => {
    if (e.key === 'Enter') codeJoinBtn.click();
  };
}

/* ─── Lobby-based flows ─── */

async function startQuickPlay(setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;

  try {
    showWaitingView('Finding Match...', 'Looking for open games...');

    if (!lobbyClient || !lobbyClient.connected) {
      lobbyClient = new LobbyClient();
      await lobbyClient.connect();
    }
    if (onlineFlowCancelled) return;

    const rooms = await new Promise<RoomInfo[]>((resolve, reject) => {
      lobbyClient!.onMessage((msg) => {
        if (msg.type === 'roomList') resolve(msg.rooms as RoomInfo[]);
        else if (msg.type === 'error') reject(new Error(msg.message));
      });
      lobbyClient!.onDisconnect(() => reject(new Error('Lost connection to lobby server')));
      lobbyClient!.listRooms();
    });
    if (onlineFlowCancelled) return;

    const matching = rooms
      .filter(r => r.setup === setup)
      .sort((a, b) => a.createdAt - b.createdAt);

    if (matching.length > 0) {
      const oldest = matching[0];
      const statusEl = document.getElementById('lobby-status')!;
      statusEl.textContent = 'Joining game...';

      const joinPromise = new Promise<{ hostPeerId: string; hostColor: PieceColor; setup: SetupMode }>((resolve, reject) => {
        lobbyClient!.onMessage((msg) => {
          if (msg.type === 'roomJoined') {
            resolve({
              hostPeerId: msg.hostPeerId,
              hostColor: msg.hostColor as PieceColor,
              setup: msg.setup as SetupMode,
            });
          } else if (msg.type === 'error') reject(new Error(msg.message));
        });
        lobbyClient!.onDisconnect(() => reject(new Error('Lost connection to lobby server')));
      });

      lobbyClient!.joinRoom(oldest.id);
      const match = await joinPromise;
      if (onlineFlowCancelled) return;

      showWaitingView('Game Found!', 'Connecting to host...', false);
      joinViaLobby(match.hostPeerId, match.hostColor, match.setup);
      return;
    }

    const lobbyTitle = document.getElementById('lobby-title')!;
    lobbyTitle.textContent = 'No Games Available';
    lobbyTitle.style.animation = 'none';
    const statusEl = document.getElementById('lobby-status')!;
    statusEl.textContent = 'No one is playing right now. Try creating a game!';
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not find a match.');
  }
}

async function createRoomWithColor(localColor: PieceColor, setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;
  network = new Network();

  try {
    showWaitingView('Creating room...', 'Setting up peer connection...');

    const peerId = await network.host();
    if (onlineFlowCancelled) return;

    const statusEl = document.getElementById('lobby-status')!;

    if (!lobbyClient || !lobbyClient.connected) {
      statusEl.textContent = 'Connecting to lobby...';
      lobbyClient = new LobbyClient();
      await lobbyClient.connect();
    }
    if (onlineFlowCancelled) return;

    const fillPromise = new Promise<void>((resolve, reject) => {
      lobbyClient!.onMessage((msg) => {
        if (msg.type === 'roomCreated') {
          const lobbyTitle = document.getElementById('lobby-title')!;
          lobbyTitle.textContent = 'Room Created';
          statusEl.textContent = `Waiting for an opponent to join... (playing as ${localColor})`;
        } else if (msg.type === 'roomFilled') {
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      });
      lobbyClient!.onDisconnect(() => reject(new Error('Lost connection to lobby server')));
    });

    lobbyClient!.createRoom(peerId, localColor, setup);
    await fillPromise;
    if (onlineFlowCancelled) return;

    cleanupLobbyClient();
    statusEl.textContent = 'Opponent found! Connecting...';

    await runHostHandshake(localColor, setup);
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not create room.');
  }
}

async function joinViaLobby(hostPeerId: string, hostColor: PieceColor, setup: SetupMode): Promise<void> {
  try {
    cleanupLobbyClient();
    network = new Network();
    await runGuestHandshake(hostPeerId, hostColor, setup);
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not join game.');
  }
}

function renderRoomTable(rooms: RoomInfo[]): void {
  const tbody = document.getElementById('room-table-body')!;
  const emptyEl = document.getElementById('room-table-empty')!;
  const tableEl = document.getElementById('room-table')!;

  tbody.replaceChildren();

  if (rooms.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }

  tableEl.style.display = '';
  emptyEl.style.display = 'none';

  for (const room of rooms) {
    const tr = document.createElement('tr');
    const modeTd = document.createElement('td');
    modeTd.textContent = room.setup.charAt(0).toUpperCase() + room.setup.slice(1);

    const colorTd = document.createElement('td');
    const yourColor = room.hostColor === PieceColor.White ? 'Black' : 'White';
    colorTd.textContent = yourColor;

    const actionTd = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'table-join-tag';
    tag.textContent = 'Join';
    actionTd.appendChild(tag);

    tr.append(modeTd, colorTd, actionTd);
    tr.addEventListener('click', () => {
      lobbyClient?.joinRoom(room.id);
    });

    tbody.appendChild(tr);
  }
}

async function createInviteWithColor(localColor: PieceColor, setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;
  network = new Network();

  try {
    showWaitingView('Creating invite...', 'Setting up connection...');

    const peerId = await network.host();
    if (onlineFlowCancelled) return;

    const lobbyTitle = document.getElementById('lobby-title')!;
    const statusEl = document.getElementById('lobby-status')!;
    const linkRow = document.getElementById('lobby-link-row')!;
    const linkInput = document.getElementById('lobby-link') as HTMLInputElement;
    const copyBtn = document.getElementById('lobby-copy-btn')!;

    if (!lobbyClient || !lobbyClient.connected) {
      statusEl.textContent = 'Connecting to lobby...';
      lobbyClient = new LobbyClient();
      await lobbyClient.connect();
    }
    if (onlineFlowCancelled) return;

    const fillPromise = new Promise<void>((resolve, reject) => {
      lobbyClient!.onMessage((msg) => {
        if (msg.type === 'inviteCreated') {
          lobbyTitle.textContent = 'Share This Code';
          lobbyTitle.style.animation = 'none';
          linkRow.style.display = 'flex';
          linkInput.value = msg.code;
          linkInput.className = 'invite-code-display';
          statusEl.textContent = `Playing as ${localColor} — share this code with your friend`;
          copyBtn.textContent = 'Copy';
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(msg.code).then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
            });
          };
        } else if (msg.type === 'inviteFilled') {
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      });
      lobbyClient!.onDisconnect(() => reject(new Error('Lost connection to lobby server')));
    });

    lobbyClient!.createInvite(peerId, localColor, setup);
    await fillPromise;
    if (onlineFlowCancelled) return;

    cleanupLobbyClient();

    linkInput.className = '';
    statusEl.textContent = 'Friend joined! Connecting...';

    await runHostHandshake(localColor, setup);
  } catch (err) {
    if (onlineFlowCancelled) return;
    const linkInput = document.getElementById('lobby-link') as HTMLInputElement;
    linkInput.className = '';
    handleLobbyError(err, 'Could not create invite.');
  }
}

async function acceptInviteFromHash(code: string): Promise<void> {
  onlineFlowCancelled = false;

  const menuScreen = document.getElementById('menu-screen')!;
  menuScreen.style.display = 'none';

  showWaitingView('Joining via invite...', 'Connecting to lobby...');

  try {
    lobbyClient = new LobbyClient();
    await lobbyClient.connect();
    if (onlineFlowCancelled) return;

    const matchPromise = new Promise<{ hostPeerId: string; hostColor: PieceColor; setup: SetupMode }>((resolve, reject) => {
      lobbyClient!.onMessage((msg) => {
        if (msg.type === 'inviteMatched') {
          resolve({
            hostPeerId: msg.hostPeerId,
            hostColor: msg.hostColor as PieceColor,
            setup: msg.setup as SetupMode,
          });
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      });
      lobbyClient!.onDisconnect(() => reject(new Error('Lost connection to lobby server')));
    });

    lobbyClient.acceptInvite(code);
    const match = await matchPromise;
    if (onlineFlowCancelled) return;

    cleanupLobbyClient();

    network = new Network();
    await runGuestHandshake(match.hostPeerId, match.hostColor, match.setup);
  } catch (err) {
    if (onlineFlowCancelled) return;
    handleLobbyError(err, 'Could not join via invite code.');
  }
}

function returnToHomeFromLobby(): void {
  onlineFlowCancelled = true;
  cleanupLobbyClient();
  if (network) {
    network.disconnect();
    network = null;
  }
  hideLobby();
  showMenu();
  window.location.hash = '';
}

function parseOnlineHash():
  | { type: 'direct'; peerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'invite'; code: string }
  | null {
  const hash = window.location.hash;

  const directMatch = hash.match(/^#online:([^:]+):(white|black)(?::(classic|barricade|pawnWall))?$/);
  if (directMatch) {
    return {
      type: 'direct',
      peerId: directMatch[1],
      hostColor: directMatch[2] as PieceColor,
      setup: (directMatch[3] as SetupMode | undefined) ?? 'classic',
    };
  }

  const inviteMatch = hash.match(/^#invite:([A-Za-z0-9]+)$/);
  if (inviteMatch) {
    return { type: 'invite', code: inviteMatch[1].toUpperCase() };
  }

  return null;
}

function parseQueryParams(): { mode?: string; difficulty?: string } | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (!mode) return null;
  return { mode, difficulty: params.get('difficulty') ?? undefined };
}

loadModels().then(() => {
  const onlineParams = parseOnlineHash();
  if (onlineParams) {
    window.location.hash = '';
    const lobbyBackBtn = document.getElementById('lobby-back-btn');
    lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
    const gameHomeBtn = document.getElementById('game-home-btn');
    gameHomeBtn?.addEventListener('click', returnToMenuFromGame);

    if (onlineParams.type === 'direct') {
      startOnlineGuest(onlineParams.peerId, onlineParams.hostColor, onlineParams.setup);
    } else {
      acceptInviteFromHash(onlineParams.code);
    }
    return;
  }

  menuController = setupMenu({
    startBot: (difficulty, setup) => {
      hideMenu();
      showGame();
      initGame({ type: 'bot', difficulty, setup });
    },
    goOnline: () => {
      goOnline();
    },
  });
  const lobbyBrowseBack = document.getElementById('lobby-browse-back');
  lobbyBrowseBack?.addEventListener('click', returnToHomeFromLobby);
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);

  const queryParams = parseQueryParams();
  if (queryParams) {
    window.history.replaceState({}, '', window.location.pathname);
    if (queryParams.mode === 'bot') {
      menuController.expandToMode('bot');
    } else if (queryParams.mode === 'online') {
      goOnline();
    }
  }
});
