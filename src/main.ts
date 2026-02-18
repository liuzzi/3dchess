import { Renderer } from './renderer';
import { BoardView } from './boardView';
import { PieceView } from './pieceView';
import { Interaction } from './interaction';
import { Game } from './game';
import { UI } from './ui';
import { Bot } from './bot';
import { Piece, PieceColor, Position3D, posKey, GameMode, Difficulty } from './types';
import { playMove, playCapture, playCheck, playCheckmate } from './sound';

let renderer: Renderer;
let boardView: BoardView;
let pieceView: PieceView;
let game: Game;
let interaction: Interaction;
let ui: UI;
let bot: Bot | null = null;

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

  ui.setLayerToggleCallback((layer, visible) => {
    boardView.setLayerVisible(layer, visible);
    pieceView.setLayerVisible(layer, visible);
  });

  renderer.scene.add(boardView.group);
  renderer.scene.add(pieceView.group);

  pieceView.sync(game.board);

  interaction.setClickHandler((pos: Position3D) => {
    game.handleCellClick(pos);
  });

  if (mode.type === 'bot' && mode.difficulty) {
    bot = new Bot(PieceColor.Black, mode.difficulty);
  } else {
    bot = null;
  }

  game.on((event) => {
    switch (event.type) {
      case 'select': {
        const { piece, moves } = event.data as { piece: Piece; moves: Position3D[] };
        const captures = moves.filter(m => {
          const occ = game.board.getPieceAt(m);
          return occ && occ.color !== piece.color;
        });
        boardView.highlightCells(moves, captures);
        boardView.selectCell(piece.position);
        interaction.setHighlightedCells(new Set(moves.map(m => posKey(m))));
        break;
      }
      case 'deselect':
        boardView.clearHighlights();
        interaction.setHighlightedCells(new Set());
        break;
      case 'move': {
        const { captured } = event.data as { captured?: Piece };
        if (!captured) playMove();
        pieceView.sync(game.board);
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
      case 'check':
        playCheck();
        break;
      case 'checkmate':
        playCheckmate();
        break;
      case 'reset':
        pieceView.sync(game.board);
        boardView.clearHighlights();
        interaction.setHighlightedCells(new Set());
        interaction.setBoard(game.board);
        break;
      case 'botTurn':
        handleBotTurn();
        break;
    }
  });

  renderer.startLoop(() => {});
}

async function handleBotTurn(): Promise<void> {
  if (!bot || !game) return;

  const statusEl = document.getElementById('game-status')!;
  statusEl.textContent = 'Thinking...';

  await new Promise(r => setTimeout(r, 350));

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

function hideMenu(): void {
  const menu = document.getElementById('menu-screen')!;
  menu.classList.add('menu-fade-out');
  setTimeout(() => {
    menu.style.display = 'none';
  }, 400);
}

function setupMenu(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.menu-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const modeType = btn.dataset.mode as 'local' | 'bot';
      const difficulty = btn.dataset.difficulty as Difficulty | undefined;
      const mode: GameMode = { type: modeType };
      if (modeType === 'bot' && difficulty) {
        mode.difficulty = difficulty;
      }

      hideMenu();
      showGame();
      initGame(mode);
    });
  });
}

setupMenu();
