import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePool, openAll } from '../helpers/index.js';

describe('WebSocketPool – broadcast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends to all open connections', async () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    const results = await pool.broadcast('ping');
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(sockets[0].send).toHaveBeenCalledWith('ping', expect.any(Function));
    expect(sockets[1].send).toHaveBeenCalledWith('ping', expect.any(Function));
    expect(sockets[2].send).toHaveBeenCalledWith('ping', expect.any(Function));
  });

  it('returns empty array when no connections are open', async () => {
    const { pool } = makePool(3);
    const results = await pool.broadcast('ping');
    expect(results).toHaveLength(0);
  });

  it('only sends to open connections', async () => {
    const { pool, sockets } = makePool(3);
    sockets[0].simulateOpen();
    // sockets[1] and [2] are still connecting
    const results = await pool.broadcast('ping');
    expect(results).toHaveLength(1);
    expect(sockets[0].send).toHaveBeenCalled();
    expect(sockets[1].send).not.toHaveBeenCalled();
    expect(sockets[2].send).not.toHaveBeenCalled();
  });

  it('returns rejected entries for failed sends', async () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    sockets[0].send.mockImplementationOnce((_d: unknown, _opts: unknown, cb?: unknown) => {
      // conditionally call the correct callback depending on args
      if (typeof _opts === 'function') _opts(new Error('write fail'));
      else if (typeof cb === 'function') cb(new Error('write fail'));
    });
    const results = await pool.broadcast('ping');
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
  });

  it('broadcasts to all open connections with options', async () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    const options = { binary: true };
    await pool.broadcast('data', options);
    expect(sockets[0].send).toHaveBeenCalledWith('data', options, expect.any(Function));
    expect(sockets[1].send).toHaveBeenCalledWith('data', options, expect.any(Function));
  });

  // ---- broadcastPing() -----------------------------------------------------

  it('broadcastPing() hits all open connections', async () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    const results = await pool.broadcastPing(Buffer.from('hey'), true);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(sockets[0].ping).toHaveBeenCalledWith(Buffer.from('hey'), true, expect.any(Function));
    expect(sockets[1].ping).toHaveBeenCalledWith(Buffer.from('hey'), true, expect.any(Function));
    expect(sockets[2].ping).toHaveBeenCalledWith(Buffer.from('hey'), true, expect.any(Function));
  });

  it('broadcastPing() returns empty array when no connections open', async () => {
    const { pool } = makePool(3);
    const results = await pool.broadcastPing();
    expect(results).toHaveLength(0);
  });

  it('handles mixed open/closed connections', async () => {
    const { pool, sockets } = makePool(4);
    sockets[0].simulateOpen();
    sockets[2].simulateOpen();
    // sockets[1] and [3] still connecting
    const results = await pool.broadcast('data');
    expect(results).toHaveLength(2);
  });

  it('can broadcast Buffer data', async () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    const buf = Buffer.from('binary');
    const results = await pool.broadcast(buf);
    expect(results).toHaveLength(2);
    expect(sockets[0].send.mock.calls[0][0]).toBe(buf);
  });
});
