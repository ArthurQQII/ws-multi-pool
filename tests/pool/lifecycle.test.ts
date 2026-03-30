import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketPool } from '../../src/pool/WebSocketPool.js';
import { makePool, openAll } from '../helpers/index.js';

describe('WebSocketPool – lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ---- Construction --------------------------------------------------------

  it('throws when url is empty', () => {
    expect(() => new WebSocketPool('')).toThrow(TypeError);
  });

  it('creates the correct number of connections', () => {
    const { pool } = makePool(4);
    expect(pool.totalConnections).toBe(4);
  });

  it('starts with 0 open connections', () => {
    const { pool } = makePool(3);
    expect(pool.openConnections).toBe(0);
  });

  it('applies default poolSize of 5', () => {
    const { pool } = makePool(5);
    expect(pool.totalConnections).toBe(5);
  });

  // ---- Open / close tracking -----------------------------------------------

  it('increments openConnections when a socket opens', () => {
    const { pool, sockets } = makePool(3);
    sockets[0].simulateOpen();
    expect(pool.openConnections).toBe(1);
    sockets[1].simulateOpen();
    expect(pool.openConnections).toBe(2);
  });

  it('decrements openConnections when a socket closes', () => {
    const { pool, sockets } = makePool(2);
    openAll(sockets, 2);
    expect(pool.openConnections).toBe(2);
    sockets[0].simulateClose();
    expect(pool.openConnections).toBe(1);
  });

  it('openConnections never goes below 0', () => {
    const { pool, sockets } = makePool(1);
    sockets[0].simulateClose();
    expect(pool.openConnections).toBe(0);
  });

  // ---- Events --------------------------------------------------------------

  it('emits "open" event with connectionId', () => {
    const { pool, sockets } = makePool(2);
    const onOpen = vi.fn();
    pool.on('open', onOpen);
    sockets[0].simulateOpen();
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it('emits "close" event with connectionId, code, reason', () => {
    const { pool, sockets } = makePool(2);
    const onClose = vi.fn();
    pool.on('close', onClose);
    openAll(sockets, 2);
    sockets[0].simulateClose(1001, 'going away');
    expect(onClose).toHaveBeenCalledWith(0, 1001, expect.any(Buffer));
  });

  it('emits "error" event with error and connectionId', () => {
    const { pool, sockets } = makePool(2);
    const onError = vi.fn();
    pool.on('error', onError);
    const err = new Error('oops');
    sockets[0].simulateError(err);
    expect(onError).toHaveBeenCalledWith(err, 0);
  });

  it('emits "message" event with data, isBinary, connectionId', () => {
    const { pool, sockets } = makePool(2);
    const onMsg = vi.fn();
    pool.on('message', onMsg);
    openAll(sockets, 2);
    sockets[1].simulateMessage('hello');
    expect(onMsg).toHaveBeenCalledOnce();
    const [data, isBinary, id] = onMsg.mock.calls[0];
    expect(data.toString()).toBe('hello');
    expect(isBinary).toBe(false);
    expect(id).toBe(1);
  });

  it('emits "pool:ready" when all connections are open', () => {
    const { pool, sockets } = makePool(3);
    const onReady = vi.fn();
    pool.on('pool:ready', onReady);
    sockets[0].simulateOpen();
    sockets[1].simulateOpen();
    expect(onReady).not.toHaveBeenCalled();
    sockets[2].simulateOpen();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('emits "pool:empty" when all connections are closed', () => {
    const { pool, sockets } = makePool(2);
    const onEmpty = vi.fn();
    pool.on('pool:empty', onEmpty);
    openAll(sockets, 2);
    sockets[0].simulateClose();
    expect(onEmpty).not.toHaveBeenCalled();
    sockets[1].simulateClose();
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it('emits pool:ready again after a full close/reopen cycle', async () => {
    const { pool, sockets } = makePool(2);
    const readyCalls: number[] = [];
    pool.on('pool:ready', () => readyCalls.push(readyCalls.length + 1));

    openAll(sockets, 2);
    expect(readyCalls).toHaveLength(1);

    sockets[0].simulateClose();
    sockets[1].simulateClose();

    // Reconnect cycle
    await vi.advanceTimersByTimeAsync(200);
    sockets[2].simulateOpen();
    sockets[3].simulateOpen();

    expect(readyCalls).toHaveLength(2);
  });
});
