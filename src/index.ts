// Core
export { WebSocketPool } from './pool/index.js';
export { PooledConnection } from './connection/index.js';

// Utilities
export { createConsoleLogger, noopLogger } from './utils/logger.js';
export { TypedEventEmitter } from './utils/TypedEventEmitter.js';
export { ExponentialBackoff } from './utils/ExponentialBackoff.js';

// Types
export type {
  PoolOptions,
  ResolvedPoolOptions,
  PoolStats,
  PoolEvents,
  ConnectionEvents,
  Logger,
  SendData,
  SendCallback,
  WebSocketFactory,
  QueuedMessage,
} from './types/index.js';
export type { ConnectionState } from './connection/index.js';
