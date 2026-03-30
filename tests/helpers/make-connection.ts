import { PooledConnection } from '../../src/connection/PooledConnection.js';
import type { ResolvedPoolOptions } from '../../src/types/index.js';
import { noopLogger } from '../../src/utils/logger.js';
import { MockWebSocket, createMockFactory } from './MockWebSocket.js';

export function makeOptions(overrides: Partial<ResolvedPoolOptions> = {}): ResolvedPoolOptions {
  return {
    poolSize: 3,
    reconnectInterval: 50,
    maxReconnectInterval: 500,
    reconnectBackoffMultiplier: 2,
    maxReconnectAttempts: Infinity,
    heartbeatInterval: 0,
    heartbeatTimeout: 200,
    messageQueueSize: 10,
    logger: noopLogger,
    wsFactory: createMockFactory([new MockWebSocket()]),
    wsOptions: undefined,
    ...overrides,
  };
}

export function makeConnection(overrides: Partial<ResolvedPoolOptions> = {}): {
  conn: PooledConnection;
  sockets: MockWebSocket[];
} {
  const sockets = Array.from({ length: 10 }, () => new MockWebSocket());
  const opts = makeOptions({ wsFactory: createMockFactory(sockets), ...overrides });
  const conn = new PooledConnection('ws://test', 0, opts);
  return { conn, sockets };
}
