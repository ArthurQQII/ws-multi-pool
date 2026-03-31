import type { ClientOptions } from 'ws';
import type { Logger } from './logger.js';
import type { WebSocketFactory } from './factory.js';

export interface PoolOptions {
  /** Number of WebSocket connections in the pool. @default 5 */
  poolSize?: number;

  /** Initial reconnect delay in milliseconds. @default 1000 */
  reconnectInterval?: number;

  /** Maximum reconnect delay in milliseconds after backoff. @default 30000 */
  maxReconnectInterval?: number;

  /** Exponential backoff multiplier applied to reconnect delay. @default 2 */
  reconnectBackoffMultiplier?: number;

  /** Maximum consecutive reconnect attempts before giving up. @default Infinity */
  maxReconnectAttempts?: number;

  /** Interval between heartbeat pings in ms. Set to 0 to disable. @default 0 */
  heartbeatInterval?: number;

  /** Maximum time in ms to wait for a pong before terminating the connection. @default 5000 */
  heartbeatTimeout?: number;

  /** Maximum number of messages to buffer when no connections are open.
   *  Set to 0 to disable queuing. @default 100 */
  messageQueueSize?: number;

  /** Logger instance. Pass `false` to silence all output. @default noopLogger */
  logger?: Logger | false;

  /** Custom WebSocket factory – useful for testing. @default `(url, opts) => new WebSocket(url, opts)` */
  wsFactory?: WebSocketFactory;

  /** Second argument forwarded to the `ws` WebSocket constructor.
   *  Can be a subprotocol string / array (`string | string[]`) or a
   *  `ClientOptions` object for TLS, headers, etc. */
  wsOptions?: ClientOptions | string | string[];
}

/** All options with defaults applied and optional fields resolved. */
export interface ResolvedPoolOptions {
  poolSize: number;
  reconnectInterval: number;
  maxReconnectInterval: number;
  reconnectBackoffMultiplier: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  messageQueueSize: number;
  logger: Logger;
  wsFactory: WebSocketFactory;
  wsOptions: ClientOptions | string | string[] | undefined;
}
