import { WebSocketPool } from '../../src/pool/WebSocketPool.js';
import { noopLogger } from '../../src/utils/logger.js';
import { MockWebSocket, createMockFactory } from './MockWebSocket.js';

export function makePool(
  poolSize: number,
  extra: Record<string, unknown> = {},
): { pool: WebSocketPool; sockets: MockWebSocket[] } {
  const sockets = Array.from({ length: poolSize * 5 }, () => new MockWebSocket());
  const pool = new WebSocketPool('ws://test', {
    poolSize,
    reconnectInterval: 50,
    maxReconnectInterval: 500,
    messageQueueSize: 10,
    logger: noopLogger,
    wsFactory: createMockFactory(sockets),
    ...extra,
  });
  return { pool, sockets };
}

export function openAll(sockets: MockWebSocket[], count: number): void {
  for (let i = 0; i < count; i++) {
    sockets[i].simulateOpen();
  }
}
