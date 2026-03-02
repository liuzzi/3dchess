import Peer, { DataConnection } from 'peerjs';
import { PieceColor, PieceType, Position3D, SetupMode } from './types';

const PEER_OPEN_TIMEOUT_MS = 15000;
const CONNECTION_TIMEOUT_MS = 35000;
const HANDSHAKE_TIMEOUT_MS = 12000;
const PROTOCOL_VERSION = 1;

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

export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  hostColor: PieceColor;
  setup: SetupMode;
}

export interface ReadyMessage {
  type: 'ready';
}

export interface ResignMessage {
  type: 'resign';
}

export type NetMessage =
  | MoveMessage
  | PromoteMessage
  | StartMessage
  | HelloMessage
  | ReadyMessage
  | ResignMessage;

type MessageHandler = (msg: NetMessage) => void;
type DisconnectHandler = () => void;
type MessageWaiter = {
  predicate: (msg: NetMessage) => boolean;
  resolve: (msg: NetMessage) => void;
  reject: (err: Error) => void;
  timeoutId: number;
};

export class Network {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private messageHandler: MessageHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;
  private queuedMessages: NetMessage[] = [];
  private wiredConn: DataConnection | null = null;
  private pendingWaiters: MessageWaiter[] = [];

  /**
   * Host a game. Returns a promise that resolves with the peer ID
   * once the peer is registered with the signaling server.
   */
  host(onProgress?: (msg: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out initializing online host'));
      }, PEER_OPEN_TIMEOUT_MS);
      
      if (onProgress) onProgress('Initializing peer network...');
      this.peer = new Peer({ debug: 2 });

      this.peer.on('open', (id) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.wireConnection(conn);
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * Wait for a guest to connect. Returns a promise that resolves
   * once the data channel is open and ready.
   */
  waitForGuest(onProgress?: (msg: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('Host peer is not initialized'));
        return;
      }

      let settled = false;

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const rejectOnce = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      if (onProgress) onProgress('Waiting for opponent connection...');

      const watchConnection = (conn: DataConnection) => {
        if (conn.open) {
          this.conn = conn;
          resolveOnce();
          return;
        }

        conn.on('open', () => {
          this.conn = conn;
          resolveOnce();
        });
        
        // DO NOT reject the session if a single incoming connection attempt closes/errors.
        // The guest might be experiencing ICE failures and retrying. We only reject on global error.
        conn.on('error', (err) => console.warn('[Network] Incoming connection errored:', err));
        conn.on('close', () => console.warn('[Network] Incoming connection closed before open'));
      };

      if (this.conn) {
        watchConnection(this.conn);
      }

      this.peer.on('connection', (conn) => {
        watchConnection(conn);
      });

      this.peer.on('error', (err) => {
        rejectOnce(err instanceof Error ? err : new Error('Host peer signaling error'));
      });
    });
  }

  /**
   * Join a host's game by their peer ID. Returns a promise that
   * resolves once the data channel is open.
   */
  join(hostPeerId: string, onProgress?: (msg: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out connecting to host'));
      }, CONNECTION_TIMEOUT_MS);

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };

      const rejectOnce = (err: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(err);
      };

      if (onProgress) onProgress('Connecting to signaling server...');
      this.peer = new Peer({ debug: 2 });

      this.peer.on('open', () => {
        let attempt = 0;
        let currentConn: DataConnection | null = null;
        let retryTimer: number | null = null;

        const attemptConnect = () => {
          if (settled) return;
          attempt++;
          if (currentConn) {
            currentConn.close();
          }
          if (retryTimer) {
            window.clearTimeout(retryTimer);
          }

          if (onProgress) onProgress(`Negotiating P2P connection (Attempt ${attempt})...`);
          
          currentConn = this.peer!.connect(hostPeerId);
          this.conn = currentConn;
          this.wireConnection(currentConn);

          if (currentConn.open) {
            resolveOnce();
            return;
          }

          currentConn.on('open', () => {
            if (retryTimer) window.clearTimeout(retryTimer);
            resolveOnce();
          });

          currentConn.on('error', (err) => {
            console.warn('[Network] Connect attempt errored:', err);
          });

          // Fast-fail and retry on WebRTC ICE failure
          const pc = currentConn.peerConnection;
          if (pc) {
            pc.addEventListener('iceconnectionstatechange', () => {
              console.log('[Network] ICE State:', pc.iceConnectionState);
              if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                if (!settled && attempt < 3) {
                  console.warn('[Network] ICE failed, retrying connection...');
                  window.setTimeout(attemptConnect, 500);
                } else if (!settled) {
                  rejectOnce(new Error('Network firewall completely blocked P2P connection.'));
                }
              }
            });
          }

          retryTimer = window.setTimeout(() => {
            if (!settled && attempt < 3) {
              console.warn('[Network] Connect attempt stalled, retrying...');
              attemptConnect();
            }
          }, 8000);
        };

        attemptConnect();
      });

      this.peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          rejectOnce(new Error('Host is offline or link is invalid.'));
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
          rejectOnce(new Error(`Connection infrastructure error: ${err.message || err.type}`));
        } else {
          console.warn('[Network] Guest peer error:', err.type, err);
        }
      });
    });
  }

  private wireConnection(conn: DataConnection): void {
    if (this.wiredConn === conn) return;
    this.wiredConn = conn;

    conn.on('data', (data) => {
      const msg = data as NetMessage;
      const waiterIndex = this.pendingWaiters.findIndex((waiter) => waiter.predicate(msg));
      if (waiterIndex !== -1) {
        const waiter = this.pendingWaiters.splice(waiterIndex, 1)[0];
        window.clearTimeout(waiter.timeoutId);
        waiter.resolve(msg);
        return;
      }
      if (this.messageHandler) {
        this.messageHandler(msg);
      } else {
        // Messages can arrive before game wiring completes; queue them.
        this.queuedMessages.push(msg);
      }
    });

    conn.on('close', () => {
      this.rejectAllPendingWaiters(new Error('Connection closed'));
      if (this.disconnectHandler) this.disconnectHandler();
    });

    conn.on('error', () => {
      this.rejectAllPendingWaiters(new Error('Connection errored'));
      if (this.disconnectHandler) this.disconnectHandler();
    });
  }

  private rejectAllPendingWaiters(err: Error): void {
    if (this.pendingWaiters.length === 0) return;
    const waiters = [...this.pendingWaiters];
    this.pendingWaiters = [];
    waiters.forEach((waiter) => {
      window.clearTimeout(waiter.timeoutId);
      waiter.reject(err);
    });
  }

  private waitForMessage<T extends NetMessage['type']>(
    type: T,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<Extract<NetMessage, { type: T }>> {
    const queuedIndex = this.queuedMessages.findIndex((msg) => msg.type === type);
    if (queuedIndex !== -1) {
      const [msg] = this.queuedMessages.splice(queuedIndex, 1);
      return Promise.resolve(msg as Extract<NetMessage, { type: T }>);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingWaiters = this.pendingWaiters.filter((waiter) => waiter !== waiterRef);
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      const waiterRef: MessageWaiter = {
        predicate: (msg) => msg.type === type,
        resolve: (msg) => resolve(msg as Extract<NetMessage, { type: T }>),
        reject,
        timeoutId,
      };
      this.pendingWaiters.push(waiterRef);
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

  sendHello(hostColor: PieceColor, setup: SetupMode): void {
    this.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      hostColor,
      setup,
    });
  }

  sendReady(): void {
    this.send({ type: 'ready' });
  }

  sendResign(): void {
    this.send({ type: 'resign' });
  }

  waitForHello(): Promise<HelloMessage> {
    return this.waitForMessage('hello', HANDSHAKE_TIMEOUT_MS, 'Timed out waiting for handshake hello');
  }

  waitForReady(): Promise<ReadyMessage> {
    return this.waitForMessage('ready', HANDSHAKE_TIMEOUT_MS, 'Timed out waiting for handshake ready');
  }

  waitForStart(): Promise<StartMessage> {
    return this.waitForMessage('start', HANDSHAKE_TIMEOUT_MS, 'Timed out waiting for host start signal');
  }

  isProtocolCompatible(version: number): boolean {
    return version === PROTOCOL_VERSION;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    if (this.queuedMessages.length > 0) {
      const pending = [...this.queuedMessages];
      this.queuedMessages = [];
      pending.forEach((msg) => this.messageHandler?.(msg));
    }
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
    this.queuedMessages = [];
    this.wiredConn = null;
    this.rejectAllPendingWaiters(new Error('Disconnected'));
  }
}