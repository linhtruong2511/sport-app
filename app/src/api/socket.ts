import { io, type Socket } from 'socket.io-client';

export type SocketRoomPayload =
  | { channel: 'availability'; branchId: number; date: string }
  | { channel: 'booking'; bookingCode: string }
  | { channel: 'branch'; branchId: number };

let socket: Socket | null = null;

function ensureSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
    });
  }
  return socket;
}

export function getSocket(): Socket {
  return ensureSocket();
}

export function connectSocket(token?: string | null): Socket {
  const s = ensureSocket();
  const nextToken = token ?? null;
  const prevToken = (s.auth as { token?: string | null } | undefined)?.token ?? null;

  s.auth = nextToken ? { token: nextToken } : {};

  if (s.connected) {
    if (prevToken !== nextToken) {
      s.disconnect().connect();
    }
  } else {
    s.connect();
  }

  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
  }
}

export function subscribeRoom(payload: SocketRoomPayload): void {
  ensureSocket().emit('subscribe', payload);
}

export function unsubscribeRoom(payload: SocketRoomPayload): void {
  if (socket) {
    socket.emit('unsubscribe', payload);
  }
}
