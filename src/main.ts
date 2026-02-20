import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Interaction } from './interaction';
import { Game } from './game';
import { UI } from './ui';
import { Bot } from './bot';
import { Network } from './network';
import * as THREE from 'three';
import { Piece, PieceColor, Position3D, posKey, GameMode, SetupMode, boardToWorld } from './types';
import { getLegalMoves } from './movement';
import { playCapture, playCheck, playCheckmate, playStep } from './sound';
import { wireOnlineEvents } from './onlineBridge';
import { setupMenu, type MenuControllerHandle } from './menuController';
import { computeHoverThreatPreview, computeThreatLinesAfterMove } from './threatPreview';

let renderer: Renderer;
let boardView: BoardView;
let pieceView: PieceView;
let game: Game;
let interaction: Interaction;
let ui: UI;
let bot: Bot | null = null;
let network: Network | null = null;
let menuController: MenuControllerHandle | null = null;
let menuHideTimeoutId: number | null = null;
let onlineFlowCancelled = false;
let hoverPreviewTargetKey: string | null = null;
let hoverPreviewRafPending = false;
let queuedHoverPos: Position3D | null = null;
let attackPreviewActive = false;
let myThreatsActive = false;
let isAnimatingMove = false;
let moveAnimationToken = 0;
let moveAnimationQueue: Promise<void> = Promise.resolve();

const MOVE_STEP_MS = 500;
const IMPACT_BURST_MS = 260;
const CELL_ENTRY_T = 0.5;
const EASY_BOT_MIN_THINK_MS = 2000;
const EASY_BOT_MAX_THINK_MS = 3000;

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

function spawnImpactBurst(pos: Position3D): void {
  const [x, y, z] = boardToWorld(pos);
  const center = new THREE.Vector3(x, y, z);
  const group = new THREE.Group();
  const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; material: THREE.MeshBasicMaterial }[] = [];

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.9,
  });
  const flashGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(center);
  group.add(flash);

  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xff4d00 : 0xffa000,
      transparent: true,
      opacity: 0.95,
    });
    const geo = new THREE.SphereGeometry(0.03 + Math.random() * 0.03, 8, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.2) * 2.2,
      (Math.random() - 0.5) * 2,
    );
    particles.push({ mesh, velocity, material: mat });
    group.add(mesh);
  }

  renderer.scene.add(group);
  const start = performance.now();

  const animate = (now: number): void => {
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
      p.mesh.scale.setScalar(1 - t * 0.35);
    }

    if (t < 1) {
      window.requestAnimationFrame(animate);
      return;
    }

    renderer.scene.remove(group);
    flashGeo.dispose();
    flashMat.dispose();
    for (const p of particles) {
      const geo = p.mesh.geometry as THREE.BufferGeometry;
      geo.dispose();
      p.material.dispose();
    }
  };

  window.requestAnimationFrame(animate);
}

async function animateMoveSteps(
  piece: Piece,
  from: Position3D,
  to: Position3D,
  token: number,
  captured: boolean,
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
    }
  }
  boardView.setTraversalCell(null);
}

function recalcThreatLines(): void {
  boardView.clearThreatLines();
  if (!game || !game.lastMove) return;
  const enemyColor = game.currentTurn === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const pairs = computeThreatLinesAfterMove(game.board, enemyColor);
  if (pairs.length > 0) {
    boardView.showThreatLines(pairs);
  }
}

function recalcMyThreats(): void {
  boardView.clearDangerPreviewLines();
  if (!game || !myThreatsActive) return;
  const myColor = game.currentTurn;
  const pairs = computeThreatLinesAfterMove(game.board, myColor);
  if (pairs.length > 0) {
    boardView.showDangerPreviewLines(pairs);
  }
}

function queueHoverPreview(pos: Position3D | null): void {
  queuedHoverPos = pos;
  if (hoverPreviewRafPending) return;
  hoverPreviewRafPending = true;

  window.requestAnimationFrame(() => {
    hoverPreviewRafPending = false;
    const nextPos = queuedHoverPos;
    queuedHoverPos = null;

    if (!nextPos || !game.selectedPiece) {
      hoverPreviewTargetKey = null;
      boardView.clearHoverThreatLines();
      recalcThreatLines();
      recalcMyThreats();
      return;
    }

    const targetKey = `${posKey(game.selectedPiece.position)}->${posKey(nextPos)}`;
    if (targetKey === hoverPreviewTargetKey) return;
    hoverPreviewTargetKey = targetKey;

    boardView.clearDangerPreviewLines();
    const preview = computeHoverThreatPreview(game.board, game.selectedPiece, nextPos);
    if (!preview) return;
    boardView.showThreatLines(preview.dangerPairs);
    boardView.showHoverThreatLines(preview.threatPairs);
  });
}

function disposeCurrentGame(): void {
  if (renderer) renderer.dispose();
  if (interaction) interaction.dispose();
  if (ui) ui.dispose();
  if (game) game.removeAllListeners();
}

function initGame(mode: GameMode): void {
  disposeCurrentGame();
  attackPreviewActive = false;
  myThreatsActive = false;
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

  const getPreviewColor = (): PieceColor => {
    if (game.mode.type === 'online') return game.mode.localColor ?? game.currentTurn;
    if (game.mode.type === 'bot') return PieceColor.White;
    return game.currentTurn;
  };

  const applyAttackSurfacePreview = (): void => {
    const previewColor = getPreviewColor();
    const moveMap = new Map<string, Position3D>();
    const captureMap = new Map<string, Position3D>();

    for (const piece of game.board.getPiecesOfColor(previewColor)) {
      const legalMoves = getLegalMoves(game.board, piece);
      for (const move of legalMoves) {
        const key = posKey(move);
        moveMap.set(key, { ...move });
        const occ = game.board.getPieceAt(move);
        if (occ && occ.color !== piece.color) {
          captureMap.set(key, { ...move });
        }
      }
    }

    const allMoves = Array.from(moveMap.values());
    const captures = Array.from(captureMap.values());
    boardView.clearHover();
    boardView.clearDangerPreviewLines();
    boardView.clearHoverThreatLines();
    boardView.highlightCells(allMoves, captures);
    interaction.setHighlightedCells(new Set(moveMap.keys()));
    interaction.setSelectedKey(null);
    pieceView.setSelected(null);
    queueHoverPreview(null);
  };

  const restoreHighlightState = (): void => {
    boardView.clearDangerPreviewLines();
    boardView.clearHoverThreatLines();
    queueHoverPreview(null);

    if (game.selectedPiece) {
      const { piece, moves } = { piece: game.selectedPiece, moves: game.validMoves };
      const captures = moves.filter(m => {
        const occ = game.board.getPieceAt(m);
        return occ && occ.color !== piece.color;
      });
      boardView.highlightCells(moves, captures);
      boardView.selectCell(piece.position);
      interaction.setHighlightedCells(new Set(moves.map(m => posKey(m))));
      interaction.setSelectedKey(posKey(piece.position));
      pieceView.setSelected(piece);
      return;
    }

    boardView.clearHighlights();
    interaction.setHighlightedCells(new Set());
    interaction.setSelectedKey(null);
    pieceView.setSelected(null);
  };

  const disableAttackSurfacePreview = (): void => {
    if (!attackPreviewActive) return;
    attackPreviewActive = false;
    ui.setAttackPreviewEnabled(false);
    restoreHighlightState();
  };

  ui = new UI(game, boardView, {
    onMoveHover: (pos: Position3D | null) => {
      if (pos) {
        boardView.hoverCell(pos);
      } else {
        boardView.clearHover();
      }
      queueHoverPreview(pos);
    },
    onAttackPreviewToggle: (enabled: boolean) => {
      attackPreviewActive = enabled;
      if (enabled) {
        applyAttackSurfacePreview();
      } else {
        restoreHighlightState();
      }
    },
    onMyThreatsToggle: (enabled: boolean) => {
      myThreatsActive = enabled;
      recalcMyThreats();
    },
  });

  interaction.setBoard(game.board);
  interaction.setPieceView(pieceView);

  renderer.scene.add(boardView.group);
  renderer.scene.add(pieceView.group);

  pieceView.sync(game.board);

  interaction.setClickHandler((pos: Position3D) => {
    if (isAnimatingMove) return;
    disableAttackSurfacePreview();
    game.handleCellClick(pos);
  });

  interaction.setDeselectHandler(() => {
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

  if (bot) {
    bot.terminate();
    bot = null;
  }
  if (mode.type === 'bot' && mode.difficulty) {
    bot = new Bot(PieceColor.Black, mode.difficulty);
  }

  if (mode.type === 'online' && network) {
    wireOnlineEvents(network, game);
  }

  game.on((event) => {
    switch (event.type) {
      case 'select': {
        hoverPreviewTargetKey = null;
        const { piece, moves } = event.data;
        const captures = moves.filter(m => {
          const occ = game.board.getPieceAt(m);
          return occ && occ.color !== piece.color;
        });
        boardView.highlightCells(moves, captures);
        boardView.selectCell(piece.position);
        interaction.setHighlightedCells(new Set(moves.map(m => posKey(m))));
        interaction.setSelectedKey(posKey(piece.position));
        pieceView.setSelected(piece);
        break;
      }
      case 'deselect':
        hoverPreviewTargetKey = null;
        boardView.clearHighlights();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        pieceView.setSelected(null);
        recalcThreatLines();
        recalcMyThreats();
        break;
      case 'move': {
        hoverPreviewTargetKey = null;
        const { piece, from, to, captured } = event.data;
        const token = moveAnimationToken;
        boardView.clearCheckPath();
        boardView.clearHoverThreatLines();
        boardView.highlightLastMove(from, to);
        recalcThreatLines();
        recalcMyThreats();
        moveAnimationQueue = moveAnimationQueue.then(async () => {
          if (token !== moveAnimationToken) return;
          isAnimatingMove = true;
          try {
            await animateMoveSteps(piece, from, to, token, !!captured);
            if (token === moveAnimationToken) {
              boardView.setTraversalCell(null);
              pieceView.sync(game.board);
              game.finalizeMove();
            }
          } finally {
            boardView.setTraversalCell(null);
            if (token === moveAnimationToken) {
              isAnimatingMove = false;
            }
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
        hoverPreviewTargetKey = null;
        moveAnimationToken++;
        isAnimatingMove = false;
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
        break;
      case 'undo': {
        hoverPreviewTargetKey = null;
        moveAnimationToken++;
        isAnimatingMove = false;
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

        if (lastMove) {
          boardView.highlightLastMove(lastMove.from, lastMove.to);
        }
        recalcThreatLines();
        recalcMyThreats();
        break;
      }
      case 'botTurn':
        handleBotTurn();
        break;
    }
    if (attackPreviewActive) {
      applyAttackSurfacePreview();
    }
  });

  renderer.startLoop(() => {});
}

async function handleBotTurn(): Promise<void> {
  if (!bot || !game) return;

  const statusEl = document.getElementById('game-status')!;
  statusEl.textContent = 'Thinking...';
  const thinkStart = performance.now();

  try {
    const move = await bot.pickMove(game.board);
    if (bot.difficulty === 'easy') {
      const targetThinkMs =
        EASY_BOT_MIN_THINK_MS + Math.random() * (EASY_BOT_MAX_THINK_MS - EASY_BOT_MIN_THINK_MS);
      const elapsedMs = performance.now() - thinkStart;
      if (elapsedMs < targetThinkMs) {
        await sleep(targetThinkMs - elapsedMs);
    }
    }
    if (game.gameOver || !game.isBotTurn()) return;

    game.botThinking = false;
    const moved = game.makeMove(move.piece, move.to);
    if (!moved) {
      throw new Error('Bot produced illegal move at execution time');
    }
  } catch {
    game.botThinking = false;
    statusEl.textContent = '';
  }
}

function showGame(): void {
  document.querySelectorAll('.game-hidden').forEach(el => {
    el.classList.remove('game-hidden');
  });
}

function hideGame(): void {
  const gameElementIds = ['game-frame', 'ui-overlay', 'side-panel', 'move-panel', 'promo-modal', 'game-canvas'];
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

function showLobby(inviteUrl: string): void {
  const lobby = document.getElementById('online-lobby')!;
  const lobbyTitle = document.getElementById('lobby-title')!;
  const linkRow = document.getElementById('lobby-link-row')!;
  const linkInput = document.getElementById('lobby-link') as HTMLInputElement;
  const copyBtn = document.getElementById('lobby-copy-btn')!;
  const statusEl = document.getElementById('lobby-status')!;
  const backBtn = document.getElementById('lobby-back-btn') as HTMLButtonElement;

  lobbyTitle.textContent = 'Waiting for opponent...';
  lobbyTitle.style.animation = 'lobbyPulse 2s ease-in-out infinite';
  linkRow.style.display = 'flex';
  linkInput.value = inviteUrl;
  statusEl.textContent = 'Share this link with your opponent';
  copyBtn.textContent = 'Copy';
  lobby.style.display = 'flex';
  backBtn.style.display = '';

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  };
}

function hideLobby(): void {
  const lobby = document.getElementById('online-lobby')!;
  lobby.style.display = 'none';
}

async function startOnlineHost(localColor: PieceColor, setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;
  network = new Network();

  try {
    const peerId = await network.host();
    const base = window.location.href.split('#')[0];
    const inviteUrl = `${base}#online:${peerId}:${localColor}:${setup}`;

    hideMenu();
    showLobby(inviteUrl);

    await network.waitForGuest();
    if (onlineFlowCancelled || !network) return;

    hideLobby();
    showGame();
    network.sendStart();
    initGame({ type: 'online', localColor, setup });
  } catch (err) {
    console.error('Failed to host online game:', err);
    network.disconnect();
    network = null;
  }
}

async function startOnlineGuest(hostPeerId: string, hostColor: PieceColor, setup: SetupMode): Promise<void> {
  onlineFlowCancelled = false;
  const localColor = hostColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  network = new Network();

  const menuScreen = document.getElementById('menu-screen')!;
  menuScreen.style.display = 'none';

  const lobby = document.getElementById('online-lobby')!;
  const lobbyTitle = document.getElementById('lobby-title')!;
  const linkRow = document.getElementById('lobby-link-row')!;
  const statusEl = document.getElementById('lobby-status')!;

  lobbyTitle.textContent = 'Connecting...';
  lobbyTitle.style.animation = 'lobbyPulse 2s ease-in-out infinite';
  linkRow.style.display = 'none';
  statusEl.textContent = `You are playing as ${localColor}`;
  lobby.style.display = 'flex';

  try {
    await network.join(hostPeerId);
    if (onlineFlowCancelled || !network) return;

    hideLobby();
    showGame();
    initGame({ type: 'online', localColor, setup });
  } catch (err) {
    console.error('Failed to join online game:', err);
    lobbyTitle.textContent = 'Connection failed';
    lobbyTitle.style.animation = 'none';
    statusEl.textContent = 'Could not connect to host. The link may be expired.';
    network.disconnect();
    network = null;
  }
}

function returnToHomeFromLobby(): void {
  onlineFlowCancelled = true;
  if (network) {
    network.disconnect();
    network = null;
  }
  hideLobby();
  showMenu();
  window.location.hash = '';
}

function parseOnlineHash(): { peerId: string; hostColor: PieceColor; setup: SetupMode } | null {
  const hash = window.location.hash;
  const match = hash.match(/^#online:([^:]+):(white|black)(?::(classic|barricade))?$/);
  if (!match) return null;
  return {
    peerId: match[1],
    hostColor: match[2] as PieceColor,
    setup: (match[3] as SetupMode | undefined) ?? 'classic',
  };
}

const onlineParams = parseOnlineHash();
if (onlineParams) {
  window.location.hash = '';
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);
  startOnlineGuest(onlineParams.peerId, onlineParams.hostColor, onlineParams.setup);
} else {
  menuController = setupMenu({
    startLocal: (setup) => {
      hideMenu();
      showGame();
      initGame({ type: 'local', setup });
    },
    startBot: (difficulty, setup) => {
      hideMenu();
      showGame();
      initGame({ type: 'bot', difficulty, setup });
    },
    startOnlineHost: (localColor, setup) => {
      startOnlineHost(localColor, setup);
    },
  });
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);
}
