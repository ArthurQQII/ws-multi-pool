import type { RawData } from 'ws';
import type { IncomingMessage, ClientRequest } from 'http';
import { PooledConnection } from '../connection/PooledConnection.js';
import { TypedEventEmitter } from '../utils/TypedEventEmitter.js';
import { resolveOptions } from './defaults.js';
import type {
  PoolEvents,
  PoolOptions,
  PoolStats,
  QueuedMessage,
  ResolvedPoolOptions,
  SendCallback,
  SendData,
  SendOptions,
} from '../types/index.js';

/**
 * Maintains a fixed-size pool of WebSocket connections to a single URL and
 * distributes outgoing messages across them using round-robin selection.
 *
 * Key behaviours:
 * - Each connection reconnects automatically with exponential backoff.
 * - When no connection is available, messages are buffered up to
 *   {@link PoolOptions.messageQueueSize} and flushed once a connection opens.
 * - An optional heartbeat mechanism (ping/pong) detects zombie connections.
 *
 * @example
 * ```ts
 * const pool = new WebSocketPool('ws://example.com/stream', {
 *   poolSize: 3,
 *   logger: createConsoleLogger(),
 * });
 *
 * pool.on('message', (data) => console.log('received:', data));
 * pool.send('hello');
 * ```
 */
export class WebSocketPool extends TypedEventEmitter<PoolEvents> {
  private readonly connections: PooledConnection[];
  private readonly resolvedOptions: ResolvedPoolOptions;
  private readonly messageQueue: QueuedMessage[] = [];
  private robinIndex = 0;
  private openCount = 0;
  private isDestroyed = false;

  constructor(
    private readonly url: string,
    options: PoolOptions = {},
  ) {
    super();
    if (!url) throw new TypeError('url is required');

    this.resolvedOptions = resolveOptions(options);

    const { poolSize, logger } = this.resolvedOptions;
    logger.info(`Initializing pool of ${poolSize} connections to ${url}`);

    this.connections = Array.from(
      { length: poolSize },
      (_, i) => new PooledConnection(url, i, this.resolvedOptions),
    );

    this._attachConnectionHandlers();

    for (const conn of this.connections) {
      conn.connect();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Number of currently open connections. */
  get openConnections(): number {
    return this.openCount;
  }

  /** Total number of connections in the pool. */
  get totalConnections(): number {
    return this.connections.length;
  }

  /**
   * Sends `data` on the next available open connection using round-robin.
   *
   * If no connection is currently open, the message is added to an internal
   * queue (up to {@link PoolOptions.messageQueueSize}) and will be sent once a
   * connection recovers.  If the queue is full the oldest pending message is
   * silently dropped.
   *
   * Pass a `callback` to be notified of send errors.
   */
  send(data: SendData, cb?: SendCallback): void;
  send(data: SendData, options: SendOptions, cb?: SendCallback): void;
  send(data: SendData, optionsOrCallback?: SendOptions | SendCallback, callback?: SendCallback): void {
    if (this.isDestroyed) {
      const err = new Error('Pool has been destroyed');
      if (typeof optionsOrCallback === 'function') optionsOrCallback(err);
      else callback?.(err);
      return;
    }

    const connection = this._nextOpenConnection();
    if (connection) {
      if (typeof optionsOrCallback === 'function') {
        connection.send(data, optionsOrCallback);
      } else if (optionsOrCallback !== undefined) {
        connection.send(data, optionsOrCallback, callback);
      } else {
        connection.send(data);
      }
      return;
    }

    const options = typeof optionsOrCallback !== 'function' ? optionsOrCallback : undefined;
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

    this._enqueue({ data, options, callback: cb });
  }

  /**
   * Sends `data` to **all** currently open connections and returns a
   * `Promise.allSettled` result so callers can inspect per-connection
   * outcomes.
   */
  broadcast(data: SendData, options?: SendOptions): Promise<PromiseSettledResult<void>[]> {
    const openConns = this.connections.filter((c) => c.isOpen);
    return Promise.allSettled(
      openConns.map(
        (c) =>
          new Promise<void>((resolve, reject) => {
            const cb = (err?: Error): void => {
              if (err) reject(err);
              else resolve();
            };
            if (options) {
              c.send(data, options, cb);
            } else {
              c.send(data, cb);
            }
          }),
      ),
    );
  }

  /**
   * Sends a ping frame on the next available open connection using round-robin.
   * If no connections are open, passes an error to the callback synchronously directly.
   */
  ping(data?: SendData, mask?: boolean, cb?: (err?: Error) => void): void {
    if (this.isDestroyed) {
      cb?.(new Error('Pool has been destroyed'));
      return;
    }
    const connection = this._nextOpenConnection();
    if (connection) {
      connection.ping(data, mask, cb as undefined | ((err: Error) => void));
      return;
    }
    cb?.(new Error('No open connections to ping'));
  }

  /**
   * Sends a ping frame to **all** currently open connections.
   */
  broadcastPing(data?: SendData, mask?: boolean): Promise<PromiseSettledResult<void>[]> {
    const openConns = this.connections.filter((c) => c.isOpen);
    return Promise.allSettled(
      openConns.map(
        (c) =>
          new Promise<void>((resolve, reject) => {
            c.ping(data, mask, (err?: Error): void => {
              if (err) reject(err);
              else resolve();
            });
          }),
      ),
    );
  }

  /**
   * Returns a snapshot of connection counts and queue depth.
   */
  getStats(): PoolStats {
    let open = 0;
    let connecting = 0;
    let closed = 0;

    for (const conn of this.connections) {
      const s = conn.connectionState;
      if (s === 'open') open++;
      else if (s === 'connecting') connecting++;
      else closed++;
    }

    return {
      total: this.connections.length,
      open,
      connecting,
      closed,
      queuedMessages: this.messageQueue.length,
    };
  }

  /**
   * Gracefully closes all connections and resolves once every socket has
   * closed.  Queued messages are discarded.
   */
  async close(): Promise<void> {
    this.messageQueue.length = 0;
    await Promise.all(this.connections.map((c) => c.close()));
  }

  /**
   * Immediately terminates all connections without waiting for the closing
   * handshake.  Queued messages are discarded.  The pool cannot be reused
   * after calling `destroy()`.
   */
  destroy(): void {
    this.isDestroyed = true;
    this.messageQueue.length = 0;
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.openCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _attachConnectionHandlers(): void {
    for (const conn of this.connections) {
      conn.on('open', (id) => {
        this.openCount++;
        this.emit('open', id);
        if (this.openCount === this.connections.length) {
          this.emit('pool:ready');
        }
        this._flushQueue();
      });

      conn.on('close', (id, code, reason) => {
        this.openCount = Math.max(0, this.openCount - 1);
        this.emit('close', id, code, reason);
        if (this.openCount === 0) {
          this.emit('pool:empty');
        }
      });

      conn.on('error', (err, id) => {
        this.emit('error', err, id);
      });

      conn.on('message', (data: RawData, isBinary: boolean, id: number) => {
        this.emit('message', data, isBinary, id);
      });

      conn.on('unexpected-response', (request: ClientRequest, response: IncomingMessage, id: number) => {
        this.emit('unexpected-response', request, response, id);
      });

      conn.on('upgrade', (response: IncomingMessage, id: number) => {
        this.emit('upgrade', response, id);
      });

      conn.on('ping', (data: Buffer, id: number) => {
        this.emit('ping', data, id);
      });

      conn.on('pong', (data: Buffer, id: number) => {
        this.emit('pong', data, id);
      });
    }
  }

  /**
   * Returns the next open connection using round-robin, or `null` if none
   * are currently open.
   */
  private _nextOpenConnection(): PooledConnection | null {
    const total = this.connections.length;
    const start = this.robinIndex;

    for (let i = 0; i < total; i++) {
      const idx = (start + i) % total;
      const conn = this.connections[idx];
      if (conn.isOpen) {
        this.robinIndex = (idx + 1) % total;
        return conn;
      }
    }

    return null;
  }

  private _enqueue(msg: QueuedMessage): void {
    const { messageQueueSize, logger } = this.resolvedOptions;

    if (messageQueueSize === 0) {
      logger.warn('No open connections and message queuing is disabled – dropping message');
      msg.callback?.(new Error('No open connections'));
      return;
    }

    if (this.messageQueue.length >= messageQueueSize) {
      const dropped = this.messageQueue.shift();
      logger.warn('Message queue full – dropped oldest queued message');
      dropped?.callback?.(new Error('Message dropped: queue full'));
    }

    this.messageQueue.push(msg);
    logger.debug(`Message queued (queue depth: ${this.messageQueue.length})`);
  }

  /**
   * Attempts to drain the message queue by distributing pending messages
   * across open connections.  Any messages that cannot be sent (because all
   * connections are suddenly gone) are left in the queue.
   */
  private _flushQueue(): void {
    if (this.messageQueue.length === 0) return;

    const pending = this.messageQueue.splice(0);
    let sent = 0;

    for (const msg of pending) {
      const conn = this._nextOpenConnection();
      if (!conn) {
        this.messageQueue.unshift(...pending.slice(sent));
        break;
      }
      if (msg.options) {
        conn.send(msg.data, msg.options, msg.callback);
      } else {
        conn.send(msg.data, msg.callback);
      }
      sent++;
    }

    if (sent > 0) {
      this.resolvedOptions.logger.debug(`Flushed ${sent} queued message(s)`);
      this.emit('drain', sent);
    }
  }
}
