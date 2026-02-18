import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Interaction } from './interaction';
import { Game } from './game';
import { UI } from './ui';
import { Bot } from './bot';
import { Network, NetMessage } from './network';
import { Piece, PieceColor, PieceType, Position3D, posKey, GameMode, Difficulty } from './types';
import { getValidMoves } from './movement';
import { playMove, playCapture, playCheck, playCheckmate, playMenuClick, playMenuConfirm } from './sound';

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

function initGame(mode: GameMode): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

  renderer = new Renderer(canvas);
  boardView = new BoardView();
  pieceView = new PieceView();
  game = new Game();
  game.setMode(mode);
  interaction = new Interaction(renderer, boardView);
  ui = new UI(game, boardView);

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
    boardView.clearDangerPreviewLines();
    boardView.clearHoverThreatLines();
    if (!pos || !game.selectedPiece) return;

    const piece = game.selectedPiece;
    const myColor = piece.color;
    const enemyColor = myColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
    const sim = game.board.clone();
    const simPiece = sim.getPieceAt(piece.position);
    if (!simPiece) return;
    sim.movePiece(simPiece, pos);

    const dangerPairs: { from: Position3D; to: Position3D }[] = [];
    for (const enemy of sim.getPiecesOfColor(enemyColor)) {
      const moves = getValidMoves(sim, enemy);
      for (const m of moves) {
        const occ = sim.getPieceAt(m);
        if (occ && occ.color === myColor) {
          dangerPairs.push({ from: { ...enemy.position }, to: { ...m } });
        }
      }
    }
    if (dangerPairs.length > 0) {
      boardView.showDangerPreviewLines(dangerPairs);
    }

    const threatPairs: { from: Position3D; to: Position3D }[] = [];
    for (const ally of sim.getPiecesOfColor(myColor)) {
      const moves = getValidMoves(sim, ally);
      for (const m of moves) {
        const occ = sim.getPieceAt(m);
        if (occ && occ.color === enemyColor) {
          threatPairs.push({ from: { ...ally.position }, to: { ...m } });
        }
      }
    }
    if (threatPairs.length > 0) {
      boardView.showHoverThreatLines(threatPairs);
    }
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
    const moverColor = pieceAtTo.color;
    const targetColor = moverColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
    const pairs: { from: Position3D; to: Position3D }[] = [];
    for (const ally of game.board.getPiecesOfColor(moverColor)) {
      const attacks = getValidMoves(game.board, ally);
      for (const aPos of attacks) {
        const occ = game.board.getPieceAt(aPos);
        if (occ && occ.color === targetColor) {
          pairs.push({ from: { ...ally.position }, to: { ...aPos } });
        }
      }
    }
    if (pairs.length > 0) {
      boardView.showThreatLines(pairs);
    }
  }

  game.on((event) => {
    switch (event.type) {
      case 'select': {
        const { piece, moves } = event.data as { piece: Piece; moves: Position3D[] };
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
        boardView.clearHighlights();
        boardView.clearDangerPreviewLines();
        boardView.clearHoverThreatLines();
        interaction.setHighlightedCells(new Set());
        interaction.setSelectedKey(null);
        pieceView.setSelected(null);
        recalcThreatLines();
        break;
      case 'move': {
        const { piece: movedPiece, from, to, captured } = event.data as { piece: Piece; from: Position3D; to: Position3D; captured?: Piece };
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
        const { piece: promoted } = event.data as { piece: Piece };
        pieceView.rebuildPiece(promoted);
        break;
      }
      case 'check': {
        const { checkPath } = event.data as { color: PieceColor; checkPath: Position3D[] };
        boardView.highlightCheckPath(checkPath);
        playCheck();
        break;
      }
      case 'checkmate':
        playCheckmate();
        break;
      case 'reset':
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
        const { lastMove } = event.data as { lastMove: { from: Position3D; to: Position3D } | null };
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
  });

  renderer.startLoop(() => {});
}

/**
 * Bridge between the Network layer and Game for online mode.
 * Sends local moves/promotions to the remote peer and
 * applies incoming remote moves/promotions to the local game.
 */
function wireOnlineEvents(net: Network, g: Game): void {
  net.onMessage((msg: NetMessage) => {
    switch (msg.type) {
      case 'move':
        g.receiveRemoteMove(msg.from, msg.to);
        break;
      case 'promote':
        g.receiveRemotePromotion(msg.pieceType as PieceType);
        break;
      case 'resign': {
        const statusEl = document.getElementById('game-status')!;
        statusEl.textContent = 'Opponent resigned!';
        g.gameOver = true;
        break;
      }
    }
  });

  g.on((event) => {
    if (g.mode.type !== 'online') return;

    switch (event.type) {
      case 'move': {
        const { piece, from, to } = event.data as { piece: Piece; from: Position3D; to: Position3D };
        if (piece.color === g.mode.localColor) {
          net.sendMove(from, to);
        }
        break;
      }
      case 'promotionPrompt': {
        // Only the local player sees the prompt — handled by UI
        break;
      }
      case 'promotion': {
        const { piece: promoted } = event.data as { piece: Piece };
        if (promoted.color === g.mode.localColor) {
          net.sendPromotion(promoted.type);
        }
        break;
      }
    }
  });

  net.onDisconnect(() => {
    const statusEl = document.getElementById('game-status')!;
    if (!g.gameOver) {
      statusEl.textContent = 'Opponent disconnected';
      g.gameOver = true;
    }
  });
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
  const gameElementIds = ['game-frame', 'ui-overlay', 'side-panel', 'promo-modal', 'game-canvas'];
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

function setupMenu(): void {
  type MainMode = 'local' | 'bot' | 'online';
  type ExpandableMode = Exclude<MainMode, 'local'>;

  type SubOption = {
    label: string;
    detail: string;
    toneClass: string;
    onSelect: () => void;
  };

  const menuScreen = document.getElementById('menu-screen');
  const cubeContainer = document.getElementById('menu-cubes');
  const submenu = document.getElementById('menu-submenu');
  const subCubeStack = document.getElementById('menu-subcubes');
  const backBtn = document.getElementById('menu-back-btn');
  if (!menuScreen || !cubeContainer || !submenu || !subCubeStack || !backBtn) return;

  const cubes = Array.from(cubeContainer.querySelectorAll<HTMLButtonElement>('.cube-wrapper[data-mode]'));
  const bgLayers = Array.from(menuScreen.querySelectorAll<HTMLElement>('.menu-bg-layer'));

  let expandedMode: ExpandableMode | null = null;
  let transitioning = false;

  const runMode = (modeType: MainMode, difficulty?: Difficulty, color?: 'white' | 'black'): void => {
    if (modeType === 'online' && color) {
      const localColor = color === 'white' ? PieceColor.White : PieceColor.Black;
      startOnlineHost(localColor);
      return;
    }

    const mode: GameMode = { type: modeType };
    if (modeType === 'bot' && difficulty) {
      mode.difficulty = difficulty;
    }

    hideMenu();
    showGame();
    initGame(mode);
  };

  const createCubeBody = (label: string, detail: string): HTMLDivElement => {
    const cube = document.createElement('div');
    cube.className = 'cube';
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
    faces.forEach((faceName) => {
      const face = document.createElement('div');
      face.className = `cube-face ${faceName}`;
      if (faceName === 'front') {
        const title = document.createElement('span');
        title.className = 'cube-title';
        title.textContent = label;
        const desc = document.createElement('span');
        desc.className = 'cube-desc';
        desc.textContent = detail;
        face.append(title, desc);
      }
      cube.appendChild(face);
    });
    return cube;
  };

  const collapseExpanded = (): void => {
    if (!expandedMode || transitioning) return;
    transitioning = true;
    expandedMode = null;
    cubeContainer.classList.remove('is-expanded');
    backBtn.classList.remove('is-visible');
    submenu.classList.remove('is-active');
    const rendered = Array.from(subCubeStack.querySelectorAll<HTMLElement>('.subcube-wrapper'));
    rendered.forEach((el) => el.classList.remove('is-visible'));
    window.setTimeout(() => {
      subCubeStack.replaceChildren();
      cubes.forEach((cube) => {
        cube.classList.remove('is-hidden', 'is-centered', 'is-selected');
      });
      transitioning = false;
    }, 260);
  };

  const renderSubOptions = (mode: ExpandableMode): void => {
    const options: SubOption[] = mode === 'bot'
      ? [
          { label: 'Easy', detail: 'Calm Play', toneClass: 'tone-soft', onSelect: () => runMode('bot', 'easy') },
          { label: 'Medium', detail: 'Balanced', toneClass: 'tone-mid', onSelect: () => runMode('bot', 'medium') },
          { label: 'Hard', detail: 'No Mercy', toneClass: 'tone-hard', onSelect: () => runMode('bot', 'hard') },
        ]
      : [
          { label: 'Play White', detail: 'First Move', toneClass: 'tone-white', onSelect: () => runMode('online', undefined, 'white') },
          { label: 'Play Black', detail: 'Counterplay', toneClass: 'tone-black', onSelect: () => runMode('online', undefined, 'black') },
        ];

    subCubeStack.replaceChildren();
    options.forEach((option, index) => {
      const optionCube = document.createElement('button');
      optionCube.type = 'button';
      optionCube.className = `cube-wrapper subcube-wrapper ${option.toneClass}`;
      optionCube.appendChild(createCubeBody(option.label, option.detail));
      optionCube.addEventListener('click', () => {
        if (transitioning) return;
        playMenuConfirm();
        optionCube.classList.add('is-activating', 'is-selected');
        window.setTimeout(() => option.onSelect(), 220);
      });
      subCubeStack.appendChild(optionCube);
      window.setTimeout(() => optionCube.classList.add('is-visible'), 60 + index * 70);
    });
    backBtn.classList.add('is-visible');
  };

  const expandMode = (_clickedCube: HTMLButtonElement, mode: ExpandableMode): void => {
    if (transitioning || expandedMode) return;
    transitioning = true;
    expandedMode = mode;
    cubeContainer.classList.add('is-expanded');
    submenu.classList.add('is-active');
    cubes.forEach((cube) => {
      cube.classList.add('is-hidden');
    });
    window.setTimeout(() => {
      renderSubOptions(mode);
      transitioning = false;
    }, 340);
  };

  cubes.forEach((cube) => {
    cube.addEventListener('click', () => {
      const modeType = cube.dataset.mode as MainMode | undefined;
      if (!modeType || transitioning) return;
      playMenuClick();

      if (modeType === 'local') {
        playMenuConfirm();
        cube.classList.add('is-activating', 'is-selected');
        window.setTimeout(() => runMode('local'), 220);
        return;
      }

      if (expandedMode === modeType) {
        collapseExpanded();
        return;
      }

      if (expandedMode) return;
      expandMode(cube, modeType);
    });
  });

  backBtn.addEventListener('click', () => {
    playMenuClick();
    collapseExpanded();
  });

  menuScreen.addEventListener('pointermove', (event) => {
    const rect = menuScreen.getBoundingClientRect();
    const xNorm = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const yNorm = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    bgLayers.forEach((layer) => {
      const depth = Number(layer.dataset.depth ?? '1');
      const x = -xNorm * 18 * depth;
      const y = -yNorm * 12 * depth;
      layer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    });
  });

  menuScreen.addEventListener('pointerleave', () => {
    bgLayers.forEach((layer) => {
      layer.style.transform = 'translate3d(0, 0, 0)';
    });
  });
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
  setupMenu();
  const lobbyBackBtn = document.getElementById('lobby-back-btn');
  lobbyBackBtn?.addEventListener('click', returnToHomeFromLobby);
  const gameHomeBtn = document.getElementById('game-home-btn');
  gameHomeBtn?.addEventListener('click', returnToMenuFromGame);
}
