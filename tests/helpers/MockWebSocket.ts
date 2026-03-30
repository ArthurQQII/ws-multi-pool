import { EventEmitter } from 'events';
import { vi } from 'vitest';
import type { WebSocketFactory } from '../../src/types/index.js';

/**
 * A fully controllable mock of a `ws` WebSocket instance.
 *
 * Tests obtain instances via {@link createMockFactory} and call the
 * `simulate*` helpers to drive connection lifecycle events.
 */
export class MockWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;

  readonly send = vi.fn((_data: unknown, callback?: (err?: Error) => void): void => {
    callback?.();
  });

  readonly close = vi.fn((): void => {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSING;
    // Simulate async close (mirrors real ws behaviour)
    process.nextTick(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, Buffer.from(''));
    });
  });

  readonly terminate = vi.fn((): void => {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', 1006, Buffer.from(''));
  });

  readonly ping = vi.fn((): void => {
    // no-op by default; tests can override per-instance
  });

  // ---------------------------------------------------------------------------
  // Simulation helpers
  // ---------------------------------------------------------------------------

  /** Fires the `open` event and sets `readyState` to OPEN. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  /** Fires the `message` event with the given payload. */
  simulateMessage(data: string | Buffer, isBinary = false): void {
    this.emit('message', typeof data === 'string' ? Buffer.from(data) : data, isBinary);
  }

  /** Fires the `close` event and sets `readyState` to CLOSED. */
  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  /** Fires the `error` event. */
  simulateError(err: Error): void {
    this.emit('error', err);
  }

  /** Fires the `pong` event (simulates a server's response to a ping). */
  simulatePong(): void {
    this.emit('pong', Buffer.from(''));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a {@link WebSocketFactory}-compatible function that hands out the
 * pre-created {@link MockWebSocket} instances in FIFO order.
 *
 * @example
 * ```ts
 * const sockets = Array.from({ length: 3 }, () => new MockWebSocket());
 * const pool = new WebSocketPool('ws://test', {
 *   wsFactory: createMockFactory(sockets),
 *   poolSize: 3,
 * });
 * sockets[0].simulateOpen();
 * ```
 */
export function createMockFactory(sockets: MockWebSocket[]): WebSocketFactory {
  let index = 0;
  return () => {
    const sock = sockets[index % sockets.length];
    index++;
    // Cast: MockWebSocket intentionally implements the subset used by the pool.
    return sock as unknown as ReturnType<WebSocketFactory>;
  };
}
