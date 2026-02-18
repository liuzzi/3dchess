import Peer, { DataConnection } from 'peerjs';
import { PieceType, Position3D } from './types';

export interface MoveMessage {
  type: 'move';
  from: Position3D;
  to: Position3D;
}

export interface PromoteMessage {
  type: 'promote';
  pieceType: PieceType;
}

export interface StartMessage {
  type: 'start';
}

export interface ResignMessage {
  type: 'resign';
}

export type NetMessage = MoveMessage | PromoteMessage | StartMessage | ResignMessage;

type MessageHandler = (msg: NetMessage) => void;
type DisconnectHandler = () => void;

export class Network {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private messageHandler: MessageHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;

  /**
   * Host a game. Returns a promise that resolves with the peer ID
   * once the peer is registered with the signaling server.
   */
  host(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.peer = new Peer();

      this.peer.on('open', (id) => {
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.wireConnection(conn);
      });

      this.peer.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Wait for a guest to connect. Returns a promise that resolves
   * once the data channel is open and ready.
   */
  waitForGuest(): Promise<void> {
    return new Promise((resolve) => {
      if (this.conn && this.conn.open) {
        resolve();
        return;
      }

      const check = () => {
        if (this.conn) {
          if (this.conn.open) {
            resolve();
          } else {
            this.conn.on('open', () => resolve());
          }
        } else {
          this.peer!.on('connection', (conn) => {
            this.conn = conn;
            this.wireConnection(conn);
            if (conn.open) {
              resolve();
            } else {
              conn.on('open', () => resolve());
            }
          });
        }
      };
      check();
    });
  }

  /**
   * Join a host's game by their peer ID. Returns a promise that
   * resolves once the data channel is open.
   */
  join(hostPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.peer = new Peer();

      this.peer.on('open', () => {
        const conn = this.peer!.connect(hostPeerId, { reliable: true });
        this.conn = conn;
        this.wireConnection(conn);

        conn.on('open', () => {
          resolve();
        });
      });

      this.peer.on('error', (err) => {
        reject(err);
      });
    });
  }

  private wireConnection(conn: DataConnection): void {
    conn.on('data', (data) => {
      if (this.messageHandler) {
        this.messageHandler(data as NetMessage);
      }
    });

    conn.on('close', () => {
      if (this.disconnectHandler) this.disconnectHandler();
    });

    conn.on('error', () => {
      if (this.disconnectHandler) this.disconnectHandler();
    });
  }

  send(msg: NetMessage): void {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  sendMove(from: Position3D, to: Position3D): void {
    this.send({ type: 'move', from, to });
  }

  sendPromotion(pieceType: PieceType): void {
    this.send({ type: 'promote', pieceType });
  }

  sendStart(): void {
    this.send({ type: 'start' });
  }

  sendResign(): void {
    this.send({ type: 'resign' });
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandler = handler;
  }

  disconnect(): void {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.messageHandler = null;
    this.disconnectHandler = null;
  }
}
