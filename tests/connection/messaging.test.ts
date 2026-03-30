import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeConnection } from '../helpers/index.js';

describe('PooledConnection – messaging', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ---- send() --------------------------------------------------------------

  it('sends data with callback when open', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const cb = vi.fn();
    conn.send('payload', cb);
    expect(sockets[0].send).toHaveBeenCalledWith('payload', cb);
  });

  it('sends data without callback when open', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.send('payload');
    expect(sockets[0].send).toHaveBeenCalledOnce();
    expect(sockets[0].send.mock.calls[0][0]).toBe('payload');
  });

  it('sends Buffer data', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const buf = Buffer.from('binary');
    conn.send(buf);
    expect(sockets[0].send.mock.calls[0][0]).toBe(buf);
  });

  it('calls callback with error when in idle state', () => {
    const { conn } = makeConnection();
    const cb = vi.fn();
    conn.send('payload', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('not open');
  });

  it('calls callback with error when in connecting state', () => {
    const { conn } = makeConnection();
    conn.connect();
    const cb = vi.fn();
    conn.send('payload', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls callback with error when in closed state', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose();
    const cb = vi.fn();
    conn.send('payload', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls callback with error when in destroyed state', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    conn.destroy();
    const cb = vi.fn();
    conn.send('payload', cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not throw when sending without callback on closed connection', () => {
    const { conn } = makeConnection();
    expect(() => conn.send('payload')).not.toThrow();
  });

  // ---- message event -------------------------------------------------------

  it('re-emits text messages with isBinary=false and connectionId', () => {
    const { conn, sockets } = makeConnection();
    const onMessage = vi.fn();
    conn.on('message', onMessage);
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateMessage('hello');
    expect(onMessage).toHaveBeenCalledOnce();
    const [data, isBinary, id] = onMessage.mock.calls[0];
    expect(data.toString()).toBe('hello');
    expect(isBinary).toBe(false);
    expect(id).toBe(0);
  });

  it('re-emits binary messages with isBinary=true', () => {
    const { conn, sockets } = makeConnection();
    const onMessage = vi.fn();
    conn.on('message', onMessage);
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateMessage(Buffer.from([0x01, 0x02]), true);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0][1]).toBe(true);
  });

  it('preserves message order', () => {
    const { conn, sockets } = makeConnection();
    const received: string[] = [];
    conn.on('message', (data) => received.push(data.toString()));
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateMessage('a');
    sockets[0].simulateMessage('b');
    sockets[0].simulateMessage('c');
    expect(received).toEqual(['a', 'b', 'c']);
  });

  // ---- error event ---------------------------------------------------------

  it('re-emits errors with connectionId', () => {
    const { conn, sockets } = makeConnection();
    const onError = vi.fn();
    conn.on('error', onError);
    conn.connect();
    sockets[0].simulateError(new Error('boom'));
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 0);
    expect(onError.mock.calls[0][0].message).toBe('boom');
  });

  // ---- close event ---------------------------------------------------------

  it('emits close with connectionId, code, and reason', () => {
    const { conn, sockets } = makeConnection();
    const onClose = vi.fn();
    conn.on('close', onClose);
    conn.connect();
    sockets[0].simulateOpen();
    sockets[0].simulateClose(1001, 'going away');
    expect(onClose).toHaveBeenCalledWith(0, 1001, expect.any(Buffer));
  });

  // ---- Send Options --------------------------------------------------------

  it('sends data with options and callback', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const cb = vi.fn();
    const options = { binary: true, compress: false };
    conn.send('payload', options, cb);
    expect(sockets[0].send).toHaveBeenCalledWith('payload', options, cb);
  });

  it('sends data with options only', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const options = { fin: false };
    conn.send('payload', options);
    // Our mock mockWebSocket matches the specific argument count
    expect(sockets[0].send).toHaveBeenCalledWith('payload', options, undefined);
  });

  // ---- ping() --------------------------------------------------------------

  it('ping() calls native ping', () => {
    const { conn, sockets } = makeConnection();
    conn.connect();
    sockets[0].simulateOpen();
    const cb = vi.fn();
    conn.ping(Buffer.from('data'), true, cb);
    expect(sockets[0].ping).toHaveBeenCalledWith(Buffer.from('data'), true, cb);
  });

  it('ping() throws error via callback if not open', () => {
    const { conn } = makeConnection();
    const cb = vi.fn();
    conn.ping(undefined, undefined, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('not open');
  });

  // ---- Extended native events ----------------------------------------------

  it('emits unexpected-response with request, response, and id', () => {
    const { conn, sockets } = makeConnection();
    const onResponse = vi.fn();
    conn.on('unexpected-response', onResponse);
    conn.connect();
    const req = { mockReq: true };
    const res = { mockRes: true };
    sockets[0].simulateUnexpectedResponse(req, res);
    expect(onResponse).toHaveBeenCalledWith(req, res, 0);
  });

  it('emits upgrade with response and id', () => {
    const { conn, sockets } = makeConnection();
    const onUpgrade = vi.fn();
    conn.on('upgrade', onUpgrade);
    conn.connect();
    const res = { mockRes: true };
    sockets[0].simulateUpgrade(res);
    expect(onUpgrade).toHaveBeenCalledWith(res, 0);
  });

  it('emits ping with data and id', () => {
    const { conn, sockets } = makeConnection();
    const onPing = vi.fn();
    conn.on('ping', onPing);
    conn.connect();
    sockets[0].simulatePing(Buffer.from('hey'));
    expect(onPing).toHaveBeenCalledWith(Buffer.from('hey'), 0);
  });

  it('emits pong with data and id', () => {
    const { conn, sockets } = makeConnection();
    const onPong = vi.fn();
    conn.on('pong', onPong);
    conn.connect();
    sockets[0].simulatePong(Buffer.from('hey'));
    expect(onPong).toHaveBeenCalledWith(Buffer.from('hey'), 0);
  });
});
