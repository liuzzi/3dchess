import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface Room {
  id: string;
  hostWs: WebSocket;
  hostPeerId: string;
  hostColor: string;
  setup: string;
  createdAt: number;
}

interface QueueEntry {
  ws: WebSocket;
  peerId: string;
  setup: string;
  joinedAt: number;
}

interface Invite {
  hostWs: WebSocket;
  hostPeerId: string;
  hostColor: string;
  setup: string;
  code: string;
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function attachLobby(server: Server, path = '/lobby-ws'): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === path) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  const rooms = new Map<string, Room>();
  const queue: QueueEntry[] = [];
  const invites = new Map<string, Invite>();

  const wsToRoom = new Map<WebSocket, string>();
  const wsInQueue = new Set<WebSocket>();
  const wsToInvite = new Map<WebSocket, string>();

  let roomSeq = 0;

  function genRoomId(): string {
    return (++roomSeq).toString(36).padStart(4, '0');
  }

  function genInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  function broadcastRoomList(): void {
    const list = Array.from(rooms.values()).map(r => ({
      id: r.id,
      hostColor: r.hostColor,
      setup: r.setup,
      createdAt: r.createdAt,
    }));
    const msg = JSON.stringify({ type: 'roomList', rooms: list });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  function cleanup(ws: WebSocket): void {
    const roomId = wsToRoom.get(ws);
    if (roomId) {
      rooms.delete(roomId);
      wsToRoom.delete(ws);
      broadcastRoomList();
    }

    if (wsInQueue.has(ws)) {
      const idx = queue.findIndex(e => e.ws === ws);
      if (idx !== -1) queue.splice(idx, 1);
      wsInQueue.delete(ws);
    }

    const invCode = wsToInvite.get(ws);
    if (invCode) {
      invites.delete(invCode);
      wsToInvite.delete(ws);
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'createRoom': {
          cleanup(ws);
          const id = genRoomId();
          rooms.set(id, {
            id,
            hostWs: ws,
            hostPeerId: msg.peerId,
            hostColor: msg.hostColor,
            setup: msg.setup,
            createdAt: Date.now(),
          });
          wsToRoom.set(ws, id);
          send(ws, { type: 'roomCreated', roomId: id });
          broadcastRoomList();
          break;
        }

        case 'listRooms': {
          const list = Array.from(rooms.values()).map(r => ({
            id: r.id,
            hostColor: r.hostColor,
            setup: r.setup,
            createdAt: r.createdAt,
          }));
          send(ws, { type: 'roomList', rooms: list });
          break;
        }

        case 'joinRoom': {
          const room = rooms.get(msg.roomId);
          if (!room) {
            send(ws, { type: 'error', message: 'Room not found or already filled' });
            break;
          }
          send(ws, {
            type: 'roomJoined',
            hostPeerId: room.hostPeerId,
            hostColor: room.hostColor,
            setup: room.setup,
          });
          send(room.hostWs, { type: 'roomFilled' });
          rooms.delete(room.id);
          wsToRoom.delete(room.hostWs);
          broadcastRoomList();
          break;
        }

        case 'leaveRoom': {
          const rid = wsToRoom.get(ws);
          if (rid) {
            rooms.delete(rid);
            wsToRoom.delete(ws);
            broadcastRoomList();
          }
          break;
        }

        case 'joinQueue': {
          cleanup(ws);
          const matchIdx = queue.findIndex(e => e.setup === msg.setup);
          if (matchIdx !== -1) {
            const opponent = queue.splice(matchIdx, 1)[0];
            wsInQueue.delete(opponent.ws);
            const hostColor = Math.random() < 0.5 ? 'white' : 'black';
            send(opponent.ws, {
              type: 'queueMatched',
              role: 'host',
              hostPeerId: opponent.peerId,
              hostColor,
              setup: msg.setup,
            });
            send(ws, {
              type: 'queueMatched',
              role: 'guest',
              hostPeerId: opponent.peerId,
              hostColor,
              setup: msg.setup,
            });
          } else {
            queue.push({ ws, peerId: msg.peerId, setup: msg.setup, joinedAt: Date.now() });
            wsInQueue.add(ws);
            send(ws, { type: 'queueWaiting' });
          }
          break;
        }

        case 'cancelQueue': {
          const qi = queue.findIndex(e => e.ws === ws);
          if (qi !== -1) queue.splice(qi, 1);
          wsInQueue.delete(ws);
          break;
        }

        case 'createInvite': {
          cleanup(ws);
          let code = genInviteCode();
          while (invites.has(code)) code = genInviteCode();
          invites.set(code, {
            hostWs: ws,
            hostPeerId: msg.peerId,
            hostColor: msg.hostColor,
            setup: msg.setup,
            code,
          });
          wsToInvite.set(ws, code);
          send(ws, { type: 'inviteCreated', code });
          break;
        }

        case 'cancelInvite': {
          const ic = wsToInvite.get(ws);
          if (ic) {
            invites.delete(ic);
            wsToInvite.delete(ws);
          }
          break;
        }

        case 'acceptInvite': {
          const invite = invites.get((msg.code ?? '').toUpperCase());
          if (!invite) {
            send(ws, { type: 'error', message: 'Invalid or expired invite code' });
            break;
          }
          send(ws, {
            type: 'inviteMatched',
            hostPeerId: invite.hostPeerId,
            hostColor: invite.hostColor,
            setup: invite.setup,
          });
          send(invite.hostWs, { type: 'inviteFilled' });
          invites.delete(invite.code);
          wsToInvite.delete(invite.hostWs);
          break;
        }
      }
    });

    ws.on('close', () => cleanup(ws));
    ws.on('error', () => cleanup(ws));
  });

  return wss;
}
