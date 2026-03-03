import type * as Party from "partykit/server";

interface Room {
  id: string;
  hostWs: Party.Connection;
  hostPeerId: string;
  hostColor: string;
  setup: string;
  createdAt: number;
}

interface QueueEntry {
  ws: Party.Connection;
  peerId: string;
  setup: string;
  joinedAt: number;
}

interface Invite {
  hostWs: Party.Connection;
  hostPeerId: string;
  hostColor: string;
  setup: string;
  code: string;
}

export default class LobbyServer implements Party.Server {
  rooms = new Map<string, Room>();
  queue: QueueEntry[] = [];
  invites = new Map<string, Invite>();

  wsToRoom = new Map<Party.Connection, string>();
  wsInQueue = new Set<Party.Connection>();
  wsToInvite = new Map<Party.Connection, string>();

  roomSeq = 0;

  constructor(readonly room: Party.Room) {}

  genRoomId(): string {
    return (++this.roomSeq).toString(36).padStart(4, '0');
  }

  genInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  broadcastRoomList(): void {
    const list = Array.from(this.rooms.values()).map(r => ({
      id: r.id,
      hostColor: r.hostColor,
      setup: r.setup,
      createdAt: r.createdAt,
    }));
    const msg = JSON.stringify({ type: 'roomList', rooms: list });
    this.room.broadcast(msg);
  }

  cleanup(ws: Party.Connection): void {
    const roomId = this.wsToRoom.get(ws);
    if (roomId) {
      this.rooms.delete(roomId);
      this.wsToRoom.delete(ws);
      this.broadcastRoomList();
    }

    if (this.wsInQueue.has(ws)) {
      const idx = this.queue.findIndex(e => e.ws === ws);
      if (idx !== -1) this.queue.splice(idx, 1);
      this.wsInQueue.delete(ws);
    }

    const invCode = this.wsToInvite.get(ws);
    if (invCode) {
      this.invites.delete(invCode);
      this.wsToInvite.delete(ws);
    }
  }

  send(ws: Party.Connection, msg: object): void {
    ws.send(JSON.stringify(msg));
  }

  onClose(connection: Party.Connection) {
    this.cleanup(connection);
  }

  onError(connection: Party.Connection) {
    this.cleanup(connection);
  }

  onMessage(message: string, ws: Party.Connection) {
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }

    switch (msg.type) {
      case 'createRoom': {
        this.cleanup(ws);
        const id = this.genRoomId();
        this.rooms.set(id, {
          id,
          hostWs: ws,
          hostPeerId: msg.peerId,
          hostColor: msg.hostColor,
          setup: msg.setup,
          createdAt: Date.now(),
        });
        this.wsToRoom.set(ws, id);
        this.send(ws, { type: 'roomCreated', roomId: id });
        this.broadcastRoomList();
        break;
      }

      case 'listRooms': {
        const list = Array.from(this.rooms.values()).map(r => ({
          id: r.id,
          hostColor: r.hostColor,
          setup: r.setup,
          createdAt: r.createdAt,
        }));
        this.send(ws, { type: 'roomList', rooms: list });
        break;
      }

      case 'joinRoom': {
        const room = this.rooms.get(msg.roomId);
        if (!room) {
          this.send(ws, { type: 'error', message: 'Room not found or already filled' });
          break;
        }
        this.send(ws, {
          type: 'roomJoined',
          hostPeerId: room.hostPeerId,
          hostColor: room.hostColor,
          setup: room.setup,
        });
        this.send(room.hostWs, { type: 'roomFilled' });
        this.rooms.delete(room.id);
        this.wsToRoom.delete(room.hostWs);
        this.broadcastRoomList();
        break;
      }

      case 'leaveRoom': {
        const rid = this.wsToRoom.get(ws);
        if (rid) {
          this.rooms.delete(rid);
          this.wsToRoom.delete(ws);
          this.broadcastRoomList();
        }
        break;
      }

      case 'joinQueue': {
        this.cleanup(ws);
        const matchIdx = this.queue.findIndex(e => e.setup === msg.setup);
        if (matchIdx !== -1) {
          const opponent = this.queue.splice(matchIdx, 1)[0];
          this.wsInQueue.delete(opponent.ws);
          const hostColor = Math.random() < 0.5 ? 'white' : 'black';
          this.send(opponent.ws, {
            type: 'queueMatched',
            role: 'host',
            hostPeerId: opponent.peerId,
            hostColor,
            setup: msg.setup,
          });
          this.send(ws, {
            type: 'queueMatched',
            role: 'guest',
            hostPeerId: opponent.peerId,
            hostColor,
            setup: msg.setup,
          });
        } else {
          this.queue.push({ ws, peerId: msg.peerId, setup: msg.setup, joinedAt: Date.now() });
          this.wsInQueue.add(ws);
          this.send(ws, { type: 'queueWaiting' });
        }
        break;
      }

      case 'cancelQueue': {
        const qi = this.queue.findIndex(e => e.ws === ws);
        if (qi !== -1) this.queue.splice(qi, 1);
        this.wsInQueue.delete(ws);
        break;
      }

      case 'createInvite': {
        this.cleanup(ws);
        let code = this.genInviteCode();
        while (this.invites.has(code)) code = this.genInviteCode();
        this.invites.set(code, {
          hostWs: ws,
          hostPeerId: msg.peerId,
          hostColor: msg.hostColor,
          setup: msg.setup,
          code,
        });
        this.wsToInvite.set(ws, code);
        this.send(ws, { type: 'inviteCreated', code });
        break;
      }

      case 'cancelInvite': {
        const ic = this.wsToInvite.get(ws);
        if (ic) {
          this.invites.delete(ic);
          this.wsToInvite.delete(ws);
        }
        break;
      }

      case 'acceptInvite': {
        const invite = this.invites.get((msg.code ?? '').toUpperCase());
        if (!invite) {
          this.send(ws, { type: 'error', message: 'Invalid or expired invite code' });
          break;
        }
        this.send(ws, {
          type: 'inviteMatched',
          hostPeerId: invite.hostPeerId,
          hostColor: invite.hostColor,
          setup: invite.setup,
        });
        this.send(invite.hostWs, { type: 'inviteFilled' });
        this.invites.delete(invite.code);
        this.wsToInvite.delete(invite.hostWs);
        break;
      }
    }
  }
}
