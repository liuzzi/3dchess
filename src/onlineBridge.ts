import { Game } from './game';
import { NetMessage, Network } from './network';
import { PieceType } from './types';

/**
 * Bridge between the Network layer and Game for online mode.
 * Sends local moves/promotions to the remote peer and
 * applies incoming remote moves/promotions to the local game.
 */
export function wireOnlineEvents(net: Network, game: Game): void {
  net.onMessage((msg: NetMessage) => {
    switch (msg.type) {
      case 'move':
        game.receiveRemoteMove(msg.from, msg.to);
        break;
      case 'promote':
        game.receiveRemotePromotion(msg.pieceType as PieceType);
        break;
      case 'resign': {
        const statusEl = document.getElementById('game-status')!;
        statusEl.textContent = 'Opponent resigned!';
        game.gameOver = true;
        break;
      }
    }
  });

  game.on((event) => {
    if (game.mode.type !== 'online') return;

    switch (event.type) {
      case 'move': {
        const { piece, from, to } = event.data;
        if (piece.color === game.mode.localColor) {
          net.sendMove(from, to);
        }
        break;
      }
      case 'promotionPrompt':
        // Only the local player sees the prompt — handled by UI.
        break;
      case 'promotion': {
        const { piece: promoted } = event.data;
        if (promoted.color === game.mode.localColor) {
          net.sendPromotion(promoted.type);
        }
        break;
      }
    }
  });

  net.onDisconnect(() => {
    const statusEl = document.getElementById('game-status')!;
    if (!game.gameOver) {
      statusEl.textContent = 'Opponent disconnected';
      game.gameOver = true;
    }
  });
}
