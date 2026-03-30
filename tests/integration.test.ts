import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketPool } from '../src/pool/WebSocketPool.js';
import { createConsoleLogger } from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

interface TestServer {
  wss: WebSocketServer;
  url: string;
}

function startServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, url: `ws://127.0.0.1:${addr.port}` });
    });
    wss.on('error', reject);
  });
}

function stopServer(s: TestServer): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const c of s.wss.clients) c.terminate();
    s.wss.close((err) => (err ? reject(err) : resolve()));
  });
}

function waitFor(
  condition: () => boolean,
  intervalMs = 20,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      if (condition()) return resolve();
      if (Date.now() - start >= timeoutMs) return reject(new Error(`Timed out after ${timeoutMs}ms`));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Each test gets its OWN server to eliminate cross-test interference
// ---------------------------------------------------------------------------

describe('WebSocketPool – integration', () => {
  let server: TestServer;

  beforeEach(async () => { server = await startServer(); });
  afterEach(async () => { await stopServer(server); });

  // ---- Connectivity --------------------------------------------------------

  it('connects all pool connections to the server', async () => {
    const pool = new WebSocketPool(server.url, { poolSize: 3, reconnectInterval: 100, logger: false });
    try {
      await waitFor(() => pool.openConnections === 3);
      expect(pool.getStats().open).toBe(3);
    } finally { pool.destroy(); }
  });

  // ---- Send / receive ------------------------------------------------------

  it('delivers sent messages to the server', async () => {
    const received: string[] = [];
    server.wss.on('connection', (ws) => { ws.on('message', (d) => received.push(d.toString())); });
    const pool = new WebSocketPool(server.url, { poolSize: 2, logger: false });
    try {
      await waitFor(() => pool.openConnections === 2);
      pool.send('hello');
      pool.send('world');
      await waitFor(() => received.length >= 2);
      expect(received).toContain('hello');
      expect(received).toContain('world');
    } finally { pool.destroy(); }
  });

  it('receives messages sent by the server (echo)', async () => {
    const received: string[] = [];
    server.wss.on('connection', (ws) => { ws.on('message', (d) => ws.send(d.toString())); });
    const pool = new WebSocketPool(server.url, { poolSize: 2, logger: false });
    pool.on('message', (d) => received.push(d.toString()));
    try {
      await waitFor(() => pool.openConnections === 2);
      pool.send('ping1');
      pool.send('ping2');
      await waitFor(() => received.length >= 2);
      expect(received).toContain('ping1');
      expect(received).toContain('ping2');
    } finally { pool.destroy(); }
  });

  it('receives binary messages correctly', async () => {
    const received: { isBinary: boolean; data: Buffer }[] = [];
    server.wss.on('connection', (ws) => {
      ws.on('message', () => ws.send(Buffer.from([0xDE, 0xAD]), { binary: true }));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    pool.on('message', (data, isBinary) => received.push({ data: Buffer.from(data as Buffer), isBinary }));
    try {
      await waitFor(() => pool.openConnections === 1);
      pool.send('trigger');
      await waitFor(() => received.length >= 1);
      expect(received[0].isBinary).toBe(true);
      expect(received[0].data[0]).toBe(0xDE);
    } finally { pool.destroy(); }
  });

  // ---- Distribution --------------------------------------------------------

  it('distributes sends across connections', async () => {
    const perSocket = new Map<WebSocket, number>();
    server.wss.on('connection', (ws) => {
      perSocket.set(ws, 0);
      ws.on('message', () => perSocket.set(ws, (perSocket.get(ws) ?? 0) + 1));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 3, logger: false });
    try {
      await waitFor(() => pool.openConnections === 3);
      for (let i = 0; i < 9; i++) pool.send(`msg${i}`);
      await waitFor(() => [...perSocket.values()].reduce((a, b) => a + b, 0) >= 9);
      const counts = [...perSocket.values()];
      expect(counts.every((c) => c > 0)).toBe(true);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(9);
    } finally { pool.destroy(); }
  });

  // ---- Reconnection --------------------------------------------------------

  it('reconnects after a server-initiated close', async () => {
    let openCount = 0;
    const pool = new WebSocketPool(server.url, { poolSize: 1, reconnectInterval: 50, maxReconnectInterval: 200, logger: false });
    pool.on('open', () => openCount++);
    try {
      await waitFor(() => openCount >= 1, 20, 5000);
      for (const c of server.wss.clients) c.terminate();
      await waitFor(() => openCount >= 2, 20, 5000);
      expect(pool.openConnections).toBe(1);
    } finally { pool.destroy(); }
  });

  it('reconnects multiple times in succession', async () => {
    let openCount = 0;
    const pool = new WebSocketPool(server.url, { poolSize: 1, reconnectInterval: 50, maxReconnectInterval: 200, logger: false });
    pool.on('open', () => openCount++);
    try {
      await waitFor(() => openCount >= 1, 20, 5000);
      // Terminate ALL server-side sockets for this pool
      for (const c of server.wss.clients) c.terminate();
      await waitFor(() => openCount >= 2, 20, 5000);
      for (const c of server.wss.clients) c.terminate();
      await waitFor(() => openCount >= 3, 20, 5000);
      expect(openCount).toBeGreaterThanOrEqual(3);
    } finally { pool.destroy(); }
  });

  // ---- Message queuing -----------------------------------------------------

  it('buffers messages sent before connections open and flushes them', async () => {
    const received: string[] = [];
    server.wss.on('connection', (ws) => { ws.on('message', (d) => received.push(d.toString())); });
    const pool = new WebSocketPool(server.url, { poolSize: 1, messageQueueSize: 5, reconnectInterval: 50, logger: false });
    pool.send('queued-1');
    pool.send('queued-2');
    try {
      await waitFor(() => received.length >= 2, 20, 4000);
      expect(received).toContain('queued-1');
      expect(received).toContain('queued-2');
    } finally { pool.destroy(); }
  });

  // ---- Broadcast -----------------------------------------------------------

  it('broadcasts to all connections end-to-end', async () => {
    const received: string[] = [];
    server.wss.on('connection', (ws) => { ws.on('message', (d) => received.push(d.toString())); });
    const pool = new WebSocketPool(server.url, { poolSize: 3, logger: false });
    try {
      await waitFor(() => pool.openConnections === 3);
      const results = await pool.broadcast('bcast');
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      await waitFor(() => received.filter((m) => m === 'bcast').length >= 3);
    } finally { pool.destroy(); }
  });

  // ---- Graceful close ------------------------------------------------------

  it('closes all connections cleanly', async () => {
    const pool = new WebSocketPool(server.url, { poolSize: 3, logger: false });
    await waitFor(() => pool.openConnections === 3);
    await pool.close();
    expect(pool.openConnections).toBe(0);
  });

  // ---- Stats ---------------------------------------------------------------

  it('getStats() reports correct values', async () => {
    const pool = new WebSocketPool(server.url, { poolSize: 4, logger: false });
    try {
      await waitFor(() => pool.openConnections === 4);
      const stats = pool.getStats();
      expect(stats.total).toBe(4);
      expect(stats.open).toBe(4);
    } finally { pool.destroy(); }
  });

  // ---- Logger smoke test ---------------------------------------------------

  it('works with createConsoleLogger without errors', async () => {
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: createConsoleLogger('[test]') });
    try {
      await waitFor(() => pool.openConnections === 1);
    } finally { pool.destroy(); }
  });

  // ---- Large messages ------------------------------------------------------

  it('handles large messages', async () => {
    const received: string[] = [];
    server.wss.on('connection', (ws) => { ws.on('message', (d) => ws.send(d)); });
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    pool.on('message', (d) => received.push(d.toString()));
    try {
      await waitFor(() => pool.openConnections === 1);
      const big = 'x'.repeat(100_000);
      pool.send(big);
      await waitFor(() => received.length >= 1, 20, 5000);
      expect(received[0]).toBe(big);
    } finally { pool.destroy(); }
  });
});
