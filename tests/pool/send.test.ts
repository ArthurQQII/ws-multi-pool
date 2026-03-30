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
    sockets[0].send.mockImplementationOnce((_d: unknown, cb?: (err?: Error) => void) => {
      cb?.(new Error('write fail'));
    });
    const cb = vi.fn();
    pool.send('data', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});
