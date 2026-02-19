import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Interaction } from './interaction';
import { Game } from './game';
import { UI } from './ui';
import { Bot } from './bot';
import { Network } from './network';
import { Piece, PieceColor, Position3D, posKey, GameMode } from './types';
import { getLegalMoves } from './movement';
import { playMove, playCapture, playCheck, playCheckmate } from './sound';
import { wireOnlineEvents } from './onlineBridge';
import { setupMenu } from './menuController';
import { computeHoverThreatPreview, computeThreatLinesAfterMove } from './threatPreview';

let renderer: Renderer;
let boardView: BoardView;
let pieceView: PieceView;
let game: Game;
let interaction: Interaction;
let ui: UI;
let bot: Bot | null = null;
let network: Network | null = null;
let menuHideTimeoutId: number | null = null;
let onlineFlowCancelled = false;
let hoverPreviewTargetKey: string | null = null;
let hoverPreviewRafPending = false;
let queuedHoverPos: Position3D | null = null;
let attackPreviewActive = false;

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
      boardView.clearDangerPreviewLines();
      boardView.clearHoverThreatLines();
      return;
    }

    const targetKey = `${posKey(game.selectedPiece.position)}->${posKey(nextPos)}`;
    if (targetKey === hoverPreviewTargetKey) return;
    hoverPreviewTargetKey = targetKey;

    boardView.clearDangerPreviewLines();
    boardView.clearHoverThreatLines();
    const preview = computeHoverThreatPreview(game.board, game.selectedPiece, nextPos);
    if (!preview) return;
    if (preview.dangerPairs.length > 0) boardView.showDangerPreviewLines(preview.dangerPairs);
    if (preview.threatPairs.length > 0) boardView.showHoverThreatLines(preview.threatPairs);
  });
}

function initGame(mode: GameMode): void {
  attackPreviewActive = false;
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

  ui = new UI(game, boardView, {
    onMoveHover: (pos: Position3D | null) => {
      if (pos) {
        boardView.hoverCell(pos);
      } else {
        boardView.clearHover();
      }
      queueHoverPreview(pos);
    },
    onAttackPreviewStart: () => {
      attackPreviewActive = true;
      applyAttackSurfacePreview();
    },
    onAttackPreviewEnd: () => {
      attackPreviewActive = false;
      restoreHighlightState();
    },
  });

  interaction.setBoard(game.board);
  interaction.setPieceView(pieceView);

  renderer.scene.add(boardView.group);
  renderer.scene.add(pieceView.group);

  pieceView.sync(game.board);

  interaction.setClickHandler((pos: Position3D) => {
    game.handleCellClick(pos);
  });

  interaction.setDeselectHandler(() => {
    game.deselect();
  });

  interaction.setHoverFilter((piece: Piece) => {
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

  function recalcThreatLines(): void {
    boardView.clearThreatLines();
    if (!game.lastMove) return;
    const pieceAtTo = game.board.getPieceAt(game.lastMove.to);
    if (!pieceAtTo) return;
    const pairs = computeThreatLinesAfterMove(game.board, pieceAtTo.color);
    if (pairs.length > 0) {
      boardView.showThreatLines(pairs);
    }
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
        boardView.clearThreatLines();
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
        boardView.clearDangerPreviewLines();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        pieceView.setSelected(null);
        recalcThreatLines();
        break;
      case 'move': {
        hoverPreviewTargetKey = null;
        const { from, to, captured } = event.data;
        if (!captured) playMove();
        boardView.clearCheckPath();
        boardView.clearDangerPreviewLines();
        boardView.clearHoverThreatLines();
        pieceView.sync(game.board);
        boardView.highlightLastMove(from, to);
        recalcThreatLines();
        break;
      }
      case 'capture':
        playCapture();
        pieceView.sync(game.board);
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
        const { lastMove } = event.data;
        pieceView.sync(game.board);
        pieceView.setSelected(null);
        boardView.clearHighlights();
        boardView.clearLastMove();
        boardView.clearCheckPath();
        boardView.clearDangerPreviewLines();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        interaction.setBoard(game.board);

        if (lastMove) {
          boardView.highlightLastMove(lastMove.from, lastMove.to);
        }
        recalcThreatLines();
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

  try {
    const move = await bot.pickMove(game.board);
    if (game.gameOver || !game.isBotTurn()) return;

    game.botThinking = false;
    game.makeMove(move.piece, move.to);
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

async function startOnlineHost(localColor: PieceColor): Promise<void> {
  onlineFlowCancelled = false;
  network = new Network();

  try {
    const peerId = await network.host();
    const base = window.location.href.split('#')[0];
    const inviteUrl = `${base}#online:${peerId}:${localColor}`;

    hideMenu();
    showLobby(inviteUrl);

    await network.waitForGuest();
    if (onlineFlowCancelled || !network) return;

    hideLobby();
    showGame();
    network.sendStart();
    initGame({ type: 'online', localColor });
  } catch (err) {
    console.error('Failed to host online game:', err);
    network.disconnect();
    network = null;
  }
}

async function startOnlineGuest(hostPeerId: string, hostColor: PieceColor): Promise<void> {
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
    initGame({ type: 'online', localColor });
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

function parseOnlineHash(): { peerId: string; hostColor: PieceColor } | null {
  const hash = window.location.hash;
  const match = hash.match(/^#online:([^:]+):(white|black)$/);
  if (!match) return null;
  return {
    peerId: match[1],
    hostColor: match[2] as PieceColor,
  };
}

const onlineParams = parseOnlineHash();
if (onlineParams) {
  window.location.hash = '';
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);
  startOnlineGuest(onlineParams.peerId, onlineParams.hostColor);
} else {
  setupMenu({
    startLocal: () => {
      hideMenu();
      showGame();
      initGame({ type: 'local' });
    },
    startBot: (difficulty) => {
      hideMenu();
      showGame();
      initGame({ type: 'bot', difficulty });
    },
    startOnlineHost: (localColor) => {
      startOnlineHost(localColor);
    },
  });
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);
}
