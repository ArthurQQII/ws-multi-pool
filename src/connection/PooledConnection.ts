import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { ExponentialBackoff } from '../utils/ExponentialBackoff.js';
import { TypedEventEmitter } from '../utils/TypedEventEmitter.js';
import type { IncomingMessage, ClientRequest } from 'http';
import type { ConnectionEvents, ResolvedPoolOptions, SendCallback, SendData, SendOptions } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'destroyed';

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

/**
 * Wraps a single WebSocket connection with automatic reconnection, exponential
 * backoff, and an optional heartbeat mechanism.
 *
 * Consumers should not instantiate this class directly; use {@link WebSocketPool}
 * instead.
 */
export class PooledConnection extends TypedEventEmitter<ConnectionEvents> {
  public readonly id: number;

  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pongHandler: (() => void) | null = null;
  private readonly backoff: ExponentialBackoff;
  private readonly options: ResolvedPoolOptions;

  constructor(
    private readonly url: string,
    id: number,
    options: ResolvedPoolOptions,
  ) {
    super();
    this.id = id;
    this.options = options;
    this.backoff = new ExponentialBackoff(
      options.reconnectInterval,
      options.maxReconnectInterval,
      options.reconnectBackoffMultiplier,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** `true` when the underlying socket is in the OPEN state. */
  get isOpen(): boolean {
    return this.state === 'open';
  }

  /** Current `readyState` of the underlying WebSocket, or `CLOSED` if none exists. */
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  /** Current lifecycle state of this connection. */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Creates and connects the underlying WebSocket.  Safe to call when already
   * connecting or open – the call is a no-op in those cases.
   */
  connect(): void {
    if (this.state === 'destroyed' || this.state === 'connecting' || this.state === 'open') {
      return;
    }

    this.state = 'connecting';
    this.options.logger.debug(`Connection #${this.id}: connecting to ${this.url}`);

    try {
      this.ws = this.options.wsFactory(this.url, this.options.wsOptions);
      this._attachHandlers();
    } catch (err) {
      this.state = 'closed';
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.logger.error(`Connection #${this.id}: failed to create socket`, error.message);
      this.emit('error', error, this.id);
      this._scheduleReconnect();
    }
  }

  /**
   * Sends data on this connection.
   * Calls `callback` with an `Error` if the connection is not open.
   */
  send(data: SendData, cb?: SendCallback): void;
  send(data: SendData, options: SendOptions, cb?: SendCallback): void;
  send(data: SendData, optionsOrCallback?: SendOptions | SendCallback, callback?: SendCallback): void {
    if (!this.ws || this.state !== 'open') {
      const err = new Error(`Connection #${this.id} is not open (state: ${this.state})`);
      if (typeof optionsOrCallback === 'function') optionsOrCallback(err);
      else callback?.(err);
      return;
    }

    if (typeof optionsOrCallback === 'function') {
      this.ws.send(data, optionsOrCallback as (err?: Error) => void);
    } else if (optionsOrCallback !== undefined) {
      // Pass callback even when undefined so ws uses the 3-arg overload and
      // honours the SendOptions (compress, binary, etc.).
      this.ws.send(data, optionsOrCallback, callback as (err?: Error) => void);
    } else {
      this.ws.send(data);
    }
  }

  /**
   * Sends a ping frame on this connection.
   */
  ping(data?: SendData, mask?: boolean, cb?: (err: Error) => void): void {
    if (!this.ws || this.state !== 'open') {
      cb?.(new Error(`Connection #${this.id} is not open (state: ${this.state})`));
      return;
    }
    this.ws.ping(data, mask, cb);
  }

  /**
   * Gracefully closes the connection and resolves once the socket has closed.
   * Reconnection is suppressed.
   */
  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.state === 'destroyed') {
        resolve();
        return;
      }

      this._clearTimers();

      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.state = 'closed';
        resolve();
        return;
      }

      this.state = 'closing';
      this.ws.once('close', () => {
        this.state = 'closed';
        resolve();
      });
      this.ws.close();
    });
  }

  /**
   * Immediately terminates the connection and disables all reconnect logic.
   * The connection cannot be reused after calling `destroy()`.
   */
  destroy(): void {
    this.state = 'destroyed';
    this._clearTimers();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _attachHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.state = 'open';
      this.backoff.reset();
      this.options.logger.info(`Connection #${this.id}: open`);
      this._startHeartbeat();
      this.emit('open', this.id);
    });

    this.ws.on('message', (data: RawData, isBinary: boolean) => {
      this.emit('message', data, isBinary, this.id);
    });

    this.ws.on('unexpected-response', (request: ClientRequest, response: IncomingMessage) => {
      this.emit('unexpected-response', request, response, this.id);
    });

    this.ws.on('upgrade', (response: IncomingMessage) => {
      this.emit('upgrade', response, this.id);
    });

    this.ws.on('ping', (data: Buffer) => {
      this.emit('ping', data, this.id);
    });

    this.ws.on('pong', (data: Buffer) => {
      this.emit('pong', data, this.id);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this._stopHeartbeat();

      if (this.state === 'closing' || this.state === 'destroyed') {
        this.state = 'closed';
        this.emit('close', this.id, code, reason);
        return;
      }

      this.state = 'closed';
      this.options.logger.warn(
        `Connection #${this.id}: closed (code=${code}). Scheduling reconnect.`,
      );
      this.emit('close', this.id, code, reason);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      this.options.logger.error(`Connection #${this.id}: error – ${err.message}`);
      this.emit('error', err, this.id);
    });
  }

  private _scheduleReconnect(): void {
    if (this.state === 'destroyed') return;
    this._clearReconnectTimer();

    if (this.backoff.attempts >= this.options.maxReconnectAttempts) {
      this.options.logger.error(
        `Connection #${this.id}: reached max reconnect attempts (${this.options.maxReconnectAttempts}) – giving up`,
      );
      this.emit('error', new Error(`Connection #${this.id} reached max reconnect attempts`), this.id);
      this.destroy();
      return;
    }

    const delay = this.backoff.next();
    this.options.logger.debug(
      `Connection #${this.id}: reconnecting in ${Math.round(delay)}ms ` +
        `(attempt #${this.backoff.attempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private _startHeartbeat(): void {
    const { heartbeatInterval, heartbeatTimeout } = this.options;
    if (heartbeatInterval <= 0) return;

    this._stopHeartbeat(); // Clear any stale timers from a previous connection.

    this.pongHandler = () => {
      if (this.heartbeatTimeoutTimer !== null) {
        clearTimeout(this.heartbeatTimeoutTimer);
        this.heartbeatTimeoutTimer = null;
      }
    };
    this.ws?.on('pong', this.pongHandler);

    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.state !== 'open') return;

      this.ws.ping();

      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.options.logger.warn(
          `Connection #${this.id}: heartbeat timeout after ${heartbeatTimeout}ms – terminating`,
        );
        this.ws?.terminate();
      }, heartbeatTimeout);
    }, heartbeatInterval);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer !== null) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
    if (this.pongHandler !== null && this.ws !== null) {
      this.ws.off('pong', this.pongHandler);
      this.pongHandler = null;
    }
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _clearTimers(): void {
    this._clearReconnectTimer();
    this._stopHeartbeat();
  }
}
