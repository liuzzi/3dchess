import type { PieceColor, SetupMode } from './types';

export interface RoomInfo {
  id: string;
  hostColor: PieceColor;
  setup: SetupMode;
  createdAt: number;
}

export type LobbyClientMessage =
  | { type: 'createRoom'; peerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'listRooms' }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'joinQueue'; peerId: string; setup: SetupMode }
  | { type: 'cancelQueue' }
  | { type: 'createInvite'; peerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'cancelInvite' }
  | { type: 'acceptInvite'; code: string };

export type LobbyServerMessage =
  | { type: 'roomCreated'; roomId: string }
  | { type: 'roomList'; rooms: RoomInfo[] }
  | { type: 'roomJoined'; hostPeerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'roomFilled' }
  | { type: 'queueWaiting' }
  | { type: 'queueMatched'; role: 'host' | 'guest'; hostPeerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'inviteCreated'; code: string }
  | { type: 'inviteMatched'; hostPeerId: string; hostColor: PieceColor; setup: SetupMode }
  | { type: 'inviteFilled' }
  | { type: 'error'; message: string };
