/**
 * SSE-Verbindungs-Hub für verbundene Mobilgeräte (/mobile/v1/stream).
 * Hält offene Event-Streams pro deviceId, sendet Heartbeats und trennt widerrufene Geräte sofort.
 */
import type { Response } from 'express';

export interface SseClient {
  deviceId: number;
  res: Response;
}

export function createSseHub(heartbeatMs = 25_000) {
  const byDevice = new Map<number, Set<Response>>();

  const timer = setInterval(() => {
    for (const set of byDevice.values()) {
      for (const res of set) {
        try {
          res.write('event: ping\ndata: {}\n\n');
        } catch {
          set.delete(res);
        }
      }
    }
  }, heartbeatMs);
  timer.unref();

  return {
    subscribe(deviceId: number, res: Response) {
      let set = byDevice.get(deviceId);
      if (!set) {
        set = new Set();
        byDevice.set(deviceId, set);
      }
      set.add(res);
      const cleanup = () => {
        set?.delete(res);
        if (set?.size === 0) byDevice.delete(deviceId);
      };
      res.on('close', cleanup);
      res.on('error', cleanup);
      return cleanup;
    },

    disconnectDevice(deviceId: number) {
      const set = byDevice.get(deviceId);
      if (!set) return;
      for (const res of set) {
        try {
          res.end();
        } catch {}
      }
      byDevice.delete(deviceId);
    },

    sendToDevice(deviceId: number, event: string, data: unknown, id?: number) {
      const set = byDevice.get(deviceId);
      if (!set?.size) return 0;
      const frame = `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      let sent = 0;
      for (const res of set) {
        try {
          res.write(frame);
          sent++;
        } catch {
          set.delete(res);
        }
      }
      if (set.size === 0) byDevice.delete(deviceId);
      return sent;
    },

    connectedDeviceIds(): number[] {
      return [...byDevice.keys()];
    },

    closeAll() {
      clearInterval(timer);
      for (const id of [...byDevice.keys()]) this.disconnectDevice(id);
    },
  };
}

export type SseHub = ReturnType<typeof createSseHub>;
