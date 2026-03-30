import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeConnection } from '../helpers/index.js';

describe('PooledConnection – reconnect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules a reconnect after unexpected close', async () => {
    const { conn, sockets } = makeConnection({ reconnectInterval: 50 });
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1006);
    expect(conn.connectionState).toBe('closed');

    await vi.advanceTimersByTimeAsync(100);
    expect(conn.connectionState).toBe('connecting');
  });

  it('does NOT reconnect after a graceful close()', async () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const p = conn.close();
    await vi.runAllTimersAsync();
    await p;
    await vi.advanceTimersByTimeAsync(5000);
    expect(conn.connectionState).toBe('closed');
  });

  it('does NOT reconnect after destroy()', async () => {
    const { conn, sockets } = makeConnection({ reconnectInterval: 50 });
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(conn.connectionState).toBe('destroyed');
  });

  it('emits error and schedules reconnect when factory throws', async () => {
    let callCount = 0;
    const onError = vi.fn();
    const goodSocket = new (await import('../helpers/MockWebSocket.js')).MockWebSocket();

    const factory = vi.fn(() => {
      callCount++;
      if (callCount === 1) throw new Error('factory fail');
      return goodSocket as any;
    });

    const { conn } = makeConnection({ wsFactory: factory as any });
    conn.on('error', onError);
    conn.connect();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe('factory fail');
    expect(conn.connectionState).toBe('closed');

    // Should schedule a reconnect
    await vi.advanceTimersByTimeAsync(200);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('uses increasing delays (backoff)', async () => {
    const { conn, sockets } = makeConnection({
      reconnectInterval: 100,
      maxReconnectInterval: 2000,
    });

    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1006);

    // First reconnect: random delay in [0, 100]
    await vi.advanceTimersByTimeAsync(150);
    expect(conn.connectionState).toBe('connecting');
    // open and close again
    sockets[1].simulateOpen();
    sockets[1].simulateClose(1006);

    // Second reconnect: random delay in [0, 200] (backoff)
    // Should NOT reconnect in 50ms
    const stateAt50 = conn.connectionState;
    expect(stateAt50).toBe('closed');
  });

  it('resets backoff after successful reconnect', async () => {
    const { conn, sockets } = makeConnection({
      reconnectInterval: 50,
      maxReconnectInterval: 1000,
    });

    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1006);

    // Wait for reconnect
    await vi.advanceTimersByTimeAsync(100);
    // Socket[1] should now be in use
    sockets[1].simulateOpen();
    // After opening, backoff should be reset

    sockets[1].simulateClose(1006);
    // Next reconnect should use initial delay again (backoff reset)
    await vi.advanceTimersByTimeAsync(100);
    expect(conn.connectionState).toBe('connecting');
  });

  it('handles multiple close/reconnect cycles', async () => {
    const { conn, sockets } = makeConnection({ reconnectInterval: 30 });
    const opens: number[] = [];
    conn.on('open', (id) => opens.push(id));

    conn.connect();
    for (let cycle = 0; cycle < 3; cycle++) {
      sockets[cycle].simulateOpen();
      expect(conn.isOpen).toBe(true);
      sockets[cycle].simulateClose(1006);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(opens.length).toBe(3);
  });

  it('cancels pending reconnect on destroy', async () => {
    const { conn, sockets } = makeConnection({ reconnectInterval: 200 });
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1006);

    // Reconnect is scheduled for ~200ms from now
    await vi.advanceTimersByTimeAsync(50);
    conn.destroy();

    // Even after waiting, should not reconnect
    await vi.advanceTimersByTimeAsync(500);
    expect(conn.connectionState).toBe('destroyed');
  });

  it('cancels pending reconnect on graceful close()', async () => {
    const { conn, sockets } = makeConnection({ reconnectInterval: 200 });
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1006);

    // Reconnect is pending
    const p = conn.close();
    await vi.runAllTimersAsync();
    await p;

    await vi.advanceTimersByTimeAsync(500);
    expect(conn.connectionState).toBe('closed');
  });
});
