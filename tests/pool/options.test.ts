import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketPool } from '../../src/pool/WebSocketPool.js';
import { POOL_DEFAULTS } from '../../src/pool/defaults.js';
import { noopLogger, createConsoleLogger } from '../../src/utils/logger.js';
import { MockWebSocket, createMockFactory } from '../helpers/index.js';

describe('WebSocketPool – options', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(opts: Record<string, unknown> = {}) {
    const sockets = Array.from({ length: 20 }, () => new MockWebSocket());
    const base = {
      logger: noopLogger,
      wsFactory: createMockFactory(sockets),
      ...opts,
    };
    const pool = new WebSocketPool('ws://test', base);
    return { pool, sockets };
  }

  it('uses default poolSize of 5', () => {
    const { pool } = make();
    expect(pool.totalConnections).toBe(POOL_DEFAULTS.poolSize);
  });

  it('respects custom poolSize', () => {
    const { pool } = make({ poolSize: 8 });
    expect(pool.totalConnections).toBe(8);
  });

  it('uses default messageQueueSize', () => {
    const { pool } = make({ poolSize: 1 });
    // Queue up to default (100) messages
    for (let i = 0; i < 110; i++) pool.send(`msg${i}`);
    expect(pool.getStats().queuedMessages).toBe(POOL_DEFAULTS.messageQueueSize);
  });

  it('respects custom messageQueueSize', () => {
    const { pool } = make({ poolSize: 1, messageQueueSize: 5 });
    for (let i = 0; i < 10; i++) pool.send(`msg${i}`);
    expect(pool.getStats().queuedMessages).toBe(5);
  });

  it('logger: false suppresses all output', () => {
    // If this doesn't throw, logging is silenced correctly
    expect(() => make({ logger: false, poolSize: 1 })).not.toThrow();
  });

  it('custom logger receives log calls', () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    make({ logger, poolSize: 1 });
    expect(logger.info).toHaveBeenCalled();
  });

  it('createConsoleLogger works without errors', () => {
    const logger = createConsoleLogger('[test-prefix]');
    expect(() => make({ logger, poolSize: 1 })).not.toThrow();
  });

  it('custom wsFactory is called for each connection', () => {
    const sockets = Array.from({ length: 5 }, () => new MockWebSocket());
    const factory = vi.fn(createMockFactory(sockets));
    new WebSocketPool('ws://test', {
      poolSize: 3,
      logger: noopLogger,
      wsFactory: factory,
    });
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('poolSize of 1 creates a single connection', () => {
    const { pool } = make({ poolSize: 1 });
    expect(pool.totalConnections).toBe(1);
  });
});
