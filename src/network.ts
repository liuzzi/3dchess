import Peer, { DataConnection } from 'peerjs';
import { PieceColor, PieceType, Position3D, SetupMode } from './types';

const PEER_OPEN_TIMEOUT_MS = 15000;
const CONNECTION_TIMEOUT_MS = 25000;
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
  host(): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out initializing online host'));
      }, PEER_OPEN_TIMEOUT_MS);
      this.peer = new Peer();

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
  waitForGuest(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('Host peer is not initialized'));
        return;
      }

      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out waiting for opponent to connect'));
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

      const watchConnection = (conn: DataConnection) => {
        this.conn = conn;

        if (conn.open) {
          resolveOnce();
          return;
        }

        conn.on('open', () => resolveOnce());
        conn.on('error', () => rejectOnce(new Error('Opponent connection failed')));
        conn.on('close', () => rejectOnce(new Error('Opponent disconnected before game start')));
      };

      if (this.conn) {
        watchConnection(this.conn);
        return;
      }

      this.peer.once('connection', (conn) => {
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
  join(hostPeerId: string): Promise<void> {
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

      this.peer = new Peer();

      this.peer.on('open', () => {
        const conn = this.peer!.connect(hostPeerId, { reliable: true });
        this.conn = conn;
        this.wireConnection(conn);

        conn.on('open', () => {
          resolveOnce();
        });
        conn.on('error', () => {
          rejectOnce(new Error('Unable to open connection to host'));
        });
        conn.on('close', () => {
          rejectOnce(new Error('Host closed connection before game start'));
        });
      });

      this.peer.on('error', (err) => {
        rejectOnce(err instanceof Error ? err : new Error('Guest peer signaling error'));
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
