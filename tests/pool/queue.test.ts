import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePool } from '../helpers/index.js';

describe('WebSocketPool – message queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('queues messages when no connections are open', () => {
    const { pool } = makePool(3);
    pool.send('queued');
    expect(pool.getStats().queuedMessages).toBe(1);
  });

  it('queues multiple messages', () => {
    const { pool } = makePool(2);
    pool.send('a');
    pool.send('b');
    pool.send('c');
    expect(pool.getStats().queuedMessages).toBe(3);
  });

  it('flushes queued messages when a connection opens', () => {
    const { pool, sockets } = makePool(2);
    pool.send('first');
    pool.send('second');
    expect(pool.getStats().queuedMessages).toBe(2);
    sockets[0].simulateOpen();
    expect(pool.getStats().queuedMessages).toBe(0);
    expect(sockets[0].send.mock.calls.length).toBe(2);
  });

  it('emits "drain" event with number of messages sent', () => {
    const { pool, sockets } = makePool(2);
    const onDrain = vi.fn();
    pool.on('drain', onDrain);
    pool.send('a');
    pool.send('b');
    sockets[0].simulateOpen();
    expect(onDrain).toHaveBeenCalledWith(2);
  });

  it('distributes queued messages round-robin during flush', () => {
    const { pool, sockets } = makePool(2);
    pool.send('a');
    pool.send('b');
    pool.send('c');
    pool.send('d');

    sockets[0].simulateOpen();
    sockets[1].simulateOpen();

    const total = sockets[0].send.mock.calls.length + sockets[1].send.mock.calls.length;
    expect(total).toBe(4);
  });

  it('drops oldest queued message when queue is full', () => {
    const { pool } = makePool(2, { messageQueueSize: 3 });
    const cbs = Array.from({ length: 4 }, () => vi.fn());
    pool.send('msg0', cbs[0]);
    pool.send('msg1', cbs[1]);
    pool.send('msg2', cbs[2]);
    pool.send('msg3', cbs[3]); // drops msg0
    expect(pool.getStats().queuedMessages).toBe(3);
    expect(cbs[0]).toHaveBeenCalledWith(expect.any(Error));
    expect(cbs[0].mock.calls[0][0].message).toContain('dropped');
  });

  it('calls callback with error when messageQueueSize is 0', () => {
    const { pool } = makePool(2, { messageQueueSize: 0 });
    const cb = vi.fn();
    pool.send('data', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(pool.getStats().queuedMessages).toBe(0);
  });

  it('does not throw when queuing without callback and queue is disabled', () => {
    const { pool } = makePool(2, { messageQueueSize: 0 });
    expect(() => pool.send('data')).not.toThrow();
  });

  it('handles multiple queue/drain cycles', async () => {
    const { pool, sockets } = makePool(1);
    const drainCounts: number[] = [];
    pool.on('drain', (n) => drainCounts.push(n));

    // Cycle 1
    pool.send('a');
    pool.send('b');
    sockets[0].simulateOpen();
    expect(pool.getStats().queuedMessages).toBe(0);

    // Close and cycle 2
    sockets[0].simulateClose();
    pool.send('c');
    pool.send('d');
    pool.send('e');

    // Advance timers so the pool's reconnect timer fires and creates sockets[1]
    await vi.advanceTimersByTimeAsync(200);
    sockets[1].simulateOpen();
    expect(pool.getStats().queuedMessages).toBe(0);
    expect(drainCounts).toEqual([2, 3]);
  });

  it('clears queue on close()', async () => {
    const { pool } = makePool(2);
    pool.send('queued');
    expect(pool.getStats().queuedMessages).toBe(1);
    const p = pool.close();
    await vi.runAllTimersAsync();
    await p;
    expect(pool.getStats().queuedMessages).toBe(0);
  });

  it('clears queue on destroy()', () => {
    const { pool } = makePool(2);
    pool.send('queued');
    pool.destroy();
    expect(pool.getStats().queuedMessages).toBe(0);
  });

  it('preserves callback order during flush', () => {
    const { pool, sockets } = makePool(1);
    const order: number[] = [];
    pool.send('a', () => order.push(1));
    pool.send('b', () => order.push(2));
    pool.send('c', () => order.push(3));
    sockets[0].simulateOpen();
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops flushing and requeues remainder if connections close mid-flush', () => {
    const { pool, sockets } = makePool(1);
    
    // First message callback simulates a sudden network close
    pool.send('a', () => {
      sockets[0].simulateClose(1006);
    });
    pool.send('b');
    pool.send('c');

    expect(pool.getStats().queuedMessages).toBe(3);

    // Triggers _flushQueue
    sockets[0].simulateOpen();

    // 'a' is sent, callback fires synchronously in our mock, closing the socket.
    // Loop tries to send 'b', discovers no open connections, and requeues 'b' and 'c'.
    expect(pool.getStats().queuedMessages).toBe(2);
  });
});
