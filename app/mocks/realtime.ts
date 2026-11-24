/**
 * Socket.IO giả lập — SDD mục 5.7.
 *
 * MSW không chặn được WebSocket/Socket.IO, nên ở chế độ mock frontend dùng
 * `createMockSocket()` thay cho `io()`. Đối tượng trả về có các hàm hay dùng
 * của socket.io-client: on / off / once / emit / connect / disconnect / connected / auth.
 *
 * Sự kiện được phát từ các handler mock (tạo đơn, thanh toán, hủy, job nền...)
 * và đồng bộ sang các tab khác qua BroadcastChannel.
 */

export type RealtimeEvent =
  | 'slot.updated'
  | 'booking.updated'
  | 'booking.paid'
  | 'payment_request.expired'
  | 'notification.created'
  | 'reconciliation.created'
  | 'auth.revoked'
  | 'connect'
  | 'disconnect';

type Listener = (payload: any) => void;

interface Envelope {
  event: string;
  rooms: string[];
  payload: unknown;
}

const CHANNEL_NAME = 'sporthub-mock-realtime';

function decodeToken(token?: string | null): { sub: number; role: string; branchId: number | null } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export class MockSocket {
  connected = false;
  id = `mock-${Math.random().toString(36).slice(2, 10)}`;
  auth: { token?: string | null } = {};
  private listeners = new Map<string, Set<Listener>>();
  private rooms = new Set<string>();

  connect(): this {
    this.rooms.clear();
    const claims = decodeToken(this.auth.token);
    if (claims) {
      this.rooms.add(`user:${claims.sub}`);
      if (claims.role === 'STAFF' && claims.branchId != null) this.rooms.add(`branch:${claims.branchId}`);
    }
    this.connected = true;
    setTimeout(() => this.fire('connect', undefined), 0);
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.rooms.clear();
    this.fire('disconnect', 'io client disconnect');
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  on(event: RealtimeEvent | string, cb: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return this;
  }

  once(event: RealtimeEvent | string, cb: Listener): this {
    const wrap: Listener = (p) => {
      this.off(event, wrap);
      cb(p);
    };
    return this.on(event, wrap);
  }

  off(event?: RealtimeEvent | string, cb?: Listener): this {
    if (!event) this.listeners.clear();
    else if (!cb) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(cb);
    return this;
  }

  /** Hỗ trợ emit('subscribe' | 'unsubscribe', { channel, branchId, date, bookingCode }) */
  emit(event: string, payload?: { channel?: string; branchId?: number; date?: string; bookingCode?: string }): this {
    if (!payload?.channel) return this;
    const room =
      payload.channel === 'availability'
        ? `availability:${payload.branchId}:${payload.date}`
        : payload.channel === 'booking'
          ? `booking:${payload.bookingCode}`
          : payload.channel === 'branch'
            ? `branch:${payload.branchId}`
            : null;
    if (!room) return this;
    if (event === 'subscribe') this.rooms.add(room);
    if (event === 'unsubscribe') this.rooms.delete(room);
    return this;
  }

  /** @internal — được gọi bởi publish() */
  deliver(env: Envelope): void {
    if (!this.connected) return;
    if (env.rooms.some((r) => this.rooms.has(r))) this.fire(env.event, env.payload);
  }

  /** Danh sách phòng đang tham gia (để debug) */
  get joinedRooms(): string[] {
    return [...this.rooms];
  }

  private fire(event: string, payload: unknown) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error('[mock-socket] listener error', e);
      }
    });
  }
}

/** Một socket dùng chung cho cả tab */
export const mockSocket = new MockSocket();

/**
 * Thay cho `io(url, { auth: { token } })`.
 * Ví dụ: const socket = createMockSocket({ auth: { token: accessToken } });
 */
export function createMockSocket(opts?: { auth?: { token?: string | null }; autoConnect?: boolean }): MockSocket {
  mockSocket.auth = opts?.auth ?? {};
  if (opts?.autoConnect !== false) mockSocket.connect();
  return mockSocket;
}

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent<Envelope>) => mockSocket.deliver(e.data);
  }
} catch {
  channel = null;
}

let muted = false;
/** Tắt phát sự kiện (dùng khi dựng dữ liệu seed) */
export const setPublishMuted = (value: boolean) => {
  muted = value;
};

/** Phía "server" mock: phát sự kiện tới các phòng */
export function publish(event: RealtimeEvent, rooms: string[], payload: unknown): void {
  if (muted) return;
  const env: Envelope = { event, rooms, payload: JSON.parse(JSON.stringify(payload)) };
  // Phát sau khi response trả về để giống thứ tự thực tế
  setTimeout(() => {
    mockSocket.deliver(env);
    channel?.postMessage(env);
  }, 50);
}
