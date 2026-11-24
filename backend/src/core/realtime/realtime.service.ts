import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export interface DomainEvent {
  rooms: string[];
  event: string;
  payload: unknown;
}

@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  flush(events: DomainEvent[]): void {
    if (!this.server || events.length === 0) {
      return;
    }

    for (const ev of events) {
      if (ev.rooms.length === 0) {
        continue;
      }
      this.server.to(ev.rooms).emit(ev.event, ev.payload);
    }
  }
}
