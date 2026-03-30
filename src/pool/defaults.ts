import { WebSocket } from 'ws';
import { noopLogger } from '../utils/logger.js';
import type { Logger, PoolOptions, ResolvedPoolOptions, WebSocketFactory } from '../types/index.js';

export const POOL_DEFAULTS = {
  poolSize: 5,
  reconnectInterval: 1_000,
  maxReconnectInterval: 30_000,
  reconnectBackoffMultiplier: 2,
  heartbeatInterval: 0,
  heartbeatTimeout: 5_000,
  messageQueueSize: 100,
} as const;

const defaultWsFactory: WebSocketFactory = (url, options) =>
  // The ws constructor has several overloads; casting satisfies all of them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new WebSocket(url, options as any);

export function resolveOptions(opts: PoolOptions): ResolvedPoolOptions {
  const logger: Logger =
    opts.logger === false ? noopLogger : (opts.logger ?? noopLogger);

  return {
    poolSize: opts.poolSize ?? POOL_DEFAULTS.poolSize,
    reconnectInterval: opts.reconnectInterval ?? POOL_DEFAULTS.reconnectInterval,
    maxReconnectInterval: opts.maxReconnectInterval ?? POOL_DEFAULTS.maxReconnectInterval,
    reconnectBackoffMultiplier:
      opts.reconnectBackoffMultiplier ?? POOL_DEFAULTS.reconnectBackoffMultiplier,
    heartbeatInterval: opts.heartbeatInterval ?? POOL_DEFAULTS.heartbeatInterval,
    heartbeatTimeout: opts.heartbeatTimeout ?? POOL_DEFAULTS.heartbeatTimeout,
    messageQueueSize: opts.messageQueueSize ?? POOL_DEFAULTS.messageQueueSize,
    logger,
    wsFactory: opts.wsFactory ?? defaultWsFactory,
    wsOptions: opts.wsOptions,
  };
}
