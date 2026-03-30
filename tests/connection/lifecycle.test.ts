import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PooledConnection } from '../../src/connection/PooledConnection.js';
import { MockWebSocket, createMockFactory, makeConnection, makeOptions } from '../helpers/index.js';

describe('PooledConnection – lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ---- Initial state -------------------------------------------------------

  it('starts in idle state', () => {
    const { conn } = makeConnection();
    expect(conn.connectionState).toBe('idle');
    expect(conn.isOpen).toBe(false);
  });

  it('exposes the assigned id', () => {
    const sockets = [new MockWebSocket()];
    const conn = new PooledConnection('ws://test', 42, makeOptions({ wsFactory: createMockFactory(sockets) }));
    expect(conn.id).toBe(42);
  });

  it('readyState is CLOSED before connect', () => {
    const { conn } = makeConnection();
    // WebSocket.CLOSED === 3
    expect(conn.readyState).toBe(3);
  });

  // ---- connect() -----------------------------------------------------------

  it('transitions to connecting state', () => {
    const { conn } = makeConnection();
    conn.connect();
    expect(conn.connectionState).toBe('connecting');
  });

  it('creates a WebSocket via the factory', () => {
    const sockets = [new MockWebSocket()];
    const factory = vi.fn(createMockFactory(sockets));
    const conn = new PooledConnection('ws://test', 0, makeOptions({ wsFactory: factory }));
    conn.connect();
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith('ws://test', undefined);
  });

  it('passes wsOptions to the factory', () => {
    const sockets = [new MockWebSocket()];
    const factory = vi.fn(createMockFactory(sockets));
    const opts = makeOptions({ wsFactory: factory, wsOptions: 'wss' });
    const conn = new PooledConnection('ws://test', 0, opts);
    conn.connect();
    expect(factory).toHaveBeenCalledWith('ws://test', 'wss');
  });

  it('is a no-op when already connecting', () => {
    const sockets = Array.from({ length: 5 }, () => new MockWebSocket());
    const factory = vi.fn(createMockFactory(sockets));
    const conn = new PooledConnection('ws://test', 0, makeOptions({ wsFactory: factory }));
    conn.connect();
    conn.connect();
    expect(factory).toHaveBeenCalledOnce();
  });

  it('is a no-op when already open', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    expect(conn.connectionState).toBe('open');
    conn.connect();
    expect(conn.connectionState).toBe('open');
  });

  it('is a no-op after destroy', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    conn.connect();
    expect(conn.connectionState).toBe('destroyed');
  });

  // ---- open ----------------------------------------------------------------

  it('emits open with connectionId when socket opens', () => {
    const { conn, sockets } = makeConnection();
    const onOpen = vi.fn();
    conn.on('open', onOpen);
    conn.connect();
    sockets[0].simulateOpen();
    expect(onOpen).toHaveBeenCalledWith(0);
    expect(conn.isOpen).toBe(true);
    expect(conn.connectionState).toBe('open');
  });

  // ---- close() -------------------------------------------------------------

  it('resolves once the socket emits close', async () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const p = conn.close();
    await vi.runAllTimersAsync();
    await p;
    expect(conn.connectionState).toBe('closed');
  });

  it('resolves immediately if not connected', async () => {
    const { conn } = makeConnection();
    await expect(conn.close()).resolves.toBeUndefined();
    expect(conn.connectionState).toBe('closed');
  });

  it('resolves immediately if already destroyed', async () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it('resolves if underlying socket is already CLOSED', async () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].readyState = MockWebSocket.CLOSED;
    await expect(conn.close()).resolves.toBeUndefined();
    expect(conn.connectionState).toBe('closed');
  });

  // ---- destroy() -----------------------------------------------------------

  it('sets state to destroyed', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    expect(conn.connectionState).toBe('destroyed');
  });

  it('calls terminate on the underlying socket', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
  });

  it('removes all listeners from the underlying socket', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const spy = vi.spyOn(sockets[0], 'removeAllListeners');
    conn.destroy();
    expect(spy).toHaveBeenCalled();
  });

  it('can be called multiple times without error', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    expect(() => conn.destroy()).not.toThrow();
  });
});
