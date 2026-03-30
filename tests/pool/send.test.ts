import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePool, openAll } from '../helpers/index.js';

describe('WebSocketPool – send', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends to the first open connection', () => {
    const { pool, sockets } = makePool(3);
    sockets[1].simulateOpen();
    const cb = vi.fn();
    pool.send('hello', cb);
    expect(sockets[1].send).toHaveBeenCalledWith('hello', cb);
  });

  it('round-robins across open connections', () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    pool.send('a');
    pool.send('b');
    pool.send('c');
    const counts = [sockets[0], sockets[1], sockets[2]].map(
      (s) => s.send.mock.calls.length,
    );
    expect(counts).toEqual([1, 1, 1]);
  });

  it('skips closed connections in round-robin', () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    sockets[0].simulateClose(1001);
    for (let i = 0; i < 6; i++) pool.send(`msg${i}`);
    expect(sockets[0].send).not.toHaveBeenCalled();
    expect(sockets[1].send.mock.calls.length + sockets[2].send.mock.calls.length).toBe(6);
  });

  it('wraps robin index around at pool boundary', () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);

    // Send 5 messages: should go 0,1,0,1,0
    for (let i = 0; i < 5; i++) pool.send(`msg${i}`);
    expect(sockets[0].send.mock.calls.length).toBe(3);
    expect(sockets[1].send.mock.calls.length).toBe(2);
  });

  it('sends without callback and does not throw', () => {
    const { pool, sockets } = makePool(1);
    sockets[0].simulateOpen();
    expect(() => pool.send('data')).not.toThrow();
    expect(sockets[0].send).toHaveBeenCalledOnce();
  });

  it('calls callback with error when pool is destroyed', () => {
    const { pool } = makePool(2);
    pool.destroy();
    const cb = vi.fn();
    pool.send('data', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('destroyed');
  });

  it('calls callback with error when pool is destroyed (with options)', () => {
    const { pool } = makePool(2);
    pool.destroy();
    const cb = vi.fn();
    pool.send('data', { binary: true }, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('destroyed');
  });

  it('single open connection receives all messages', () => {
    const { pool, sockets } = makePool(3);
    sockets[2].simulateOpen(); // only connection #2 is open
    for (let i = 0; i < 5; i++) pool.send(`msg${i}`);
    expect(sockets[2].send.mock.calls.length).toBe(5);
    expect(sockets[0].send).not.toHaveBeenCalled();
    expect(sockets[1].send).not.toHaveBeenCalled();
  });

  it('distributes evenly over many sends', () => {
    const { pool, sockets } = makePool(3);
    openAll(sockets, 3);
    for (let i = 0; i < 300; i++) pool.send(`msg${i}`);
    const counts = [sockets[0], sockets[1], sockets[2]].map(
      (s) => s.send.mock.calls.length,
    );
    expect(counts).toEqual([100, 100, 100]);
  });

  it('passes send errors back via callback', () => {
    const { pool, sockets } = makePool(1);
    sockets[0].simulateOpen();
    sockets[0].send.mockImplementationOnce((_d: unknown, _opts: unknown, cb?: unknown) => {
      // loosely determine if cb is the 2nd or 3rd arg
      if (typeof _opts === 'function') _opts(new Error('write fail'));
      else if (typeof cb === 'function') cb(new Error('write fail'));
    });
    const cb = vi.fn();
    pool.send('data', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  // ---- Options -------------------------------------------------------------

  it('passes options through to connection', () => {
    const { pool, sockets } = makePool(1);
    sockets[0].simulateOpen();
    const cb = vi.fn();
    const options = { binary: true };
    pool.send('hello', options, cb);
    expect(sockets[0].send).toHaveBeenCalledWith('hello', options, cb);
  });

  it('queues messages with their options if no connections open', () => {
    const { pool, sockets } = makePool(1);
    const cb = vi.fn();
    const options = { compress: true };
    pool.send('hello', options, cb);

    sockets[0].simulateOpen();
    expect(sockets[0].send).toHaveBeenCalledWith('hello', options, cb);
  });

  // ---- ping() --------------------------------------------------------------

  it('ping() hits the next open connection', () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    
    const cb = vi.fn();
    pool.ping(Buffer.from('pool ping'), true, cb);
    expect(sockets[0].ping).toHaveBeenCalledWith(Buffer.from('pool ping'), true, cb);
    
    pool.ping();
    expect(sockets[1].ping).toHaveBeenCalledOnce();
  });

  it('ping() throws via callback if pool is destroyed', () => {
    const { pool } = makePool(1);
    pool.destroy();
    const cb = vi.fn();
    pool.ping(undefined, undefined, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('destroyed');
  });

  it('ping() throws via callback if no connections are open', () => {
    const { pool } = makePool(1);
    const cb = vi.fn();
    pool.ping(undefined, undefined, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('No open connections to ping');
  });
});
