import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeConnection } from '../helpers/index.js';

describe('PooledConnection – heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a ping at the configured interval', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 200,
    });
    conn.connect();
    sockets[0].simulateOpen();

    await vi.advanceTimersByTimeAsync(110);
    expect(sockets[0].ping).toHaveBeenCalledOnce();
  });

  it('sends multiple pings over time', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 50,
    });
    conn.connect();
    sockets[0].simulateOpen();

    // Simulate pong after each ping to prevent termination
    sockets[0].ping.mockImplementation(() => {
      process.nextTick(() => sockets[0].simulatePong());
    });

    await vi.advanceTimersByTimeAsync(350);
    expect(sockets[0].ping.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('terminates the socket when pong is not received within timeout', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 50,
    });
    conn.connect();
    sockets[0].simulateOpen();

    await vi.advanceTimersByTimeAsync(200);
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
  });

  it('does NOT terminate when pong is received in time', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 200,
    });
    conn.connect();
    sockets[0].simulateOpen();

    await vi.advanceTimersByTimeAsync(110);
    sockets[0].simulatePong();

    await vi.advanceTimersByTimeAsync(150);
    expect(sockets[0].terminate).not.toHaveBeenCalled();
  });

  it('stops heartbeat when connection closes', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 50,
      reconnectInterval: 10_000,
      maxReconnectInterval: 30_000,
    });
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1001);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets[0].terminate).not.toHaveBeenCalled();
  });

  it('does not start heartbeat when interval is 0', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 0,
    });
    conn.connect();
    sockets[0].simulateOpen();

    await vi.advanceTimersByTimeAsync(5000);
    expect(sockets[0].ping).not.toHaveBeenCalled();
  });

  it('restarts heartbeat after reconnect', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 200,
      reconnectInterval: 30,
    });
    conn.connect();
    sockets[0].simulateOpen();

    await vi.advanceTimersByTimeAsync(110);
    expect(sockets[0].ping).toHaveBeenCalledOnce();

    // Simulate pong then close to trigger reconnect
    sockets[0].simulatePong();
    sockets[0].simulateClose(1006);

    await vi.advanceTimersByTimeAsync(60); // reconnect
    sockets[1].simulateOpen();

    await vi.advanceTimersByTimeAsync(110);
    expect(sockets[1].ping).toHaveBeenCalledOnce();
  });

  it('stops heartbeat on destroy', async () => {
    const { conn, sockets } = makeConnection({
      heartbeatInterval: 100,
      heartbeatTimeout: 50,
    });
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();

    await vi.advanceTimersByTimeAsync(500);
    // terminate is called by destroy(), not by heartbeat timeout
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
  });
});
