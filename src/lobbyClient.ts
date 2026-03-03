import type { LobbyClientMessage, LobbyServerMessage } from './lobbyTypes';
import type { PieceColor, SetupMode } from './types';

type MessageHandler = (msg: LobbyServerMessage) => void;
type DisconnectHandler = () => void;

const CONNECT_TIMEOUT_MS = 10_000;

export class LobbyClient {
  private ws: WebSocket | null = null;
  private handler: MessageHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;

  connect(url?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = url ?? this.defaultUrl();
      this.ws = new WebSocket(wsUrl);

      const timer = window.setTimeout(() => {
        reject(new Error('Lobby connection timed out'));
      }, CONNECT_TIMEOUT_MS);

      this.ws.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };

      this.ws.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Failed to connect to lobby server'));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as LobbyServerMessage;
          this.handler?.(msg);
        } catch { /* ignore malformed */ }
      };

      this.ws.onclose = () => {
        this.disconnectHandler?.();
      };
    });
  }

  private defaultUrl(): string {
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}/lobby-ws`;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandler = handler;
  }

  private send(msg: LobbyClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  createRoom(peerId: string, hostColor: PieceColor, setup: SetupMode): void {
    this.send({ type: 'createRoom', peerId, hostColor, setup });
  }

  listRooms(): void {
    this.send({ type: 'listRooms' });
  }

  joinRoom(roomId: string): void {
    this.send({ type: 'joinRoom', roomId });
  }

  leaveRoom(): void {
    this.send({ type: 'leaveRoom' });
  }

  joinQueue(peerId: string, setup: SetupMode): void {
    this.send({ type: 'joinQueue', peerId, setup });
  }

  cancelQueue(): void {
    this.send({ type: 'cancelQueue' });
  }

  createInvite(peerId: string, hostColor: PieceColor, setup: SetupMode): void {
    this.send({ type: 'createInvite', peerId, hostColor, setup });
  }

  cancelInvite(): void {
    this.send({ type: 'cancelInvite' });
  }

  acceptInvite(code: string): void {
    this.send({ type: 'acceptInvite', code });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.handler = null;
    this.disconnectHandler = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
