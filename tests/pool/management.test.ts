import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePool, openAll } from '../helpers/index.js';

describe('WebSocketPool – management', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ---- getStats() ----------------------------------------------------------

  it('total matches poolSize', () => {
    const { pool } = makePool(5);
    expect(pool.getStats().total).toBe(5);
  });

  it('reports open count accurately', () => {
    const { pool, sockets } = makePool(4);
    sockets[0].simulateOpen();
    sockets[1].simulateOpen();
    const stats = pool.getStats();
    expect(stats.open).toBe(2);
  });

  it('reports queued message count', () => {
    const { pool } = makePool(2);
    pool.send('a');
    pool.send('b');
    expect(pool.getStats().queuedMessages).toBe(2);
  });

  it('open + connecting + closed = total', () => {
    const { pool, sockets } = makePool(4);
    sockets[0].simulateOpen();
    const stats = pool.getStats();
    expect(stats.open + stats.connecting + stats.closed).toBe(stats.total);
  });

  it('counts connecting connections', () => {
    const { pool } = makePool(3);
    // All 3 should be in connecting state (factory was called but no open event)
    const stats = pool.getStats();
    expect(stats.connecting).toBe(3);
  });

  it('tracks state transitions correctly', () => {
    const { pool, sockets } = makePool(2);
    expect(pool.getStats().connecting).toBe(2);
    sockets[0].simulateOpen();
    expect(pool.getStats().open).toBe(1);
    expect(pool.getStats().connecting).toBe(1);
    sockets[0].simulateClose();
    expect(pool.getStats().open).toBe(0);
  });

  // ---- close() -------------------------------------------------------------

  it('closes all connections and resolves', async () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    const p = pool.close();
    await vi.runAllTimersAsync();
    await p;
    expect(pool.openConnections).toBe(0);
  });

  it('discards queued messages on close', async () => {
    const { pool } = makePool(2);
    pool.send('queued');
    expect(pool.getStats().queuedMessages).toBe(1);
    const p = pool.close();
    await vi.runAllTimersAsync();
    await p;
    expect(pool.getStats().queuedMessages).toBe(0);
  });

  it('close() resolves even if connections are already closed', async () => {
    const { pool } = makePool(2);
    const p = pool.close();
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  // ---- destroy() -----------------------------------------------------------

  it('destroys all connections', () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    pool.destroy();
    expect(sockets[0].terminate).toHaveBeenCalled();
    expect(sockets[1].terminate).toHaveBeenCalled();
    expect(sockets[2].terminate).toHaveBeenCalled();
  });

  it('discards queued messages on destroy', () => {
    const { pool } = makePool(2);
    pool.send('queued');
    pool.destroy();
    expect(pool.getStats().queuedMessages).toBe(0);
  });

  it('marks pool as destroyed (send returns error)', () => {
    const { pool } = makePool(1);
    pool.destroy();
    const cb = vi.fn();
    pool.send('data', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});
