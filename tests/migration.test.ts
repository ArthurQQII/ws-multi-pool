/**
 * Migration tests: websocket (WebSocket-Node) → ws-multi-pool
 *
 * Each describe block covers one capability. Inside, the first `it` shows
 * the OLD approach using the `websocket` package's WebSocketClient, and the
 * second `it` shows the EQUIVALENT using ws-multi-pool — both passing against
 * the same kind of real WebSocket server.
 *
 * These tests serve as living proof that the two approaches are interchangeable
 * for every common use-case.
 */

import { describe, it, expect } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import websocketPkg from 'websocket';
import { WebSocketPool } from '../src/pool/WebSocketPool.js';

const { client: WebSocketClient } = websocketPkg;

// ---------------------------------------------------------------------------
// Shared server helpers
// ---------------------------------------------------------------------------

interface TestServer {
  wss: WebSocketServer;
  url: string;
}

function startServer(handler?: (ws: WebSocket) => void): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, url: `ws://127.0.0.1:${addr.port}` });
    });
    if (handler) wss.on('connection', handler);
    wss.on('error', reject);
  });
}

function stopServer(s: TestServer): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const c of s.wss.clients) c.terminate();
    s.wss.close((err) => (err ? reject(err) : resolve()));
  });
}

function waitFor(condition: () => boolean, intervalMs = 20, timeoutMs = 4000): Promise<void> {
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
// 1. Connect to a server
// ---------------------------------------------------------------------------

describe('Migration — connect to a server', () => {
  it('[websocket] WebSocketClient connects via client.connect(url)', async () => {
    const server = await startServer();
    try {
      const connected = await new Promise<boolean>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', () => resolve(true));
        client.on('connectFailed', (err) => reject(err));
        client.connect(server.url);
      });
      expect(connected).toBe(true);
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] WebSocketPool connects automatically on construction', async () => {
    const server = await startServer();
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    try {
      await waitFor(() => pool.openConnections === 1);
      expect(pool.openConnections).toBe(1);
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Send a UTF-8 text message
// ---------------------------------------------------------------------------

describe('Migration — send a text message', () => {
  it('[websocket] connection.sendUTF() delivers text to the server', async () => {
    const received: string[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(d.toString()));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.sendUTF('hello from websocket');
          // Give the server a moment to receive it then close
          setTimeout(() => { conn.close(); resolve(); }, 100);
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      await waitFor(() => received.length >= 1);
      expect(received).toContain('hello from websocket');
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] pool.send() delivers text to the server', async () => {
    const received: string[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(d.toString()));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    try {
      await waitFor(() => pool.openConnections === 1);
      pool.send('hello from ws-multi-pool');
      await waitFor(() => received.length >= 1);
      expect(received).toContain('hello from ws-multi-pool');
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Send binary data
// ---------------------------------------------------------------------------

describe('Migration — send binary data', () => {
  it('[websocket] connection.sendBytes() delivers a Buffer to the server', async () => {
    const received: Buffer[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(Buffer.from(d as Buffer)));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.sendBytes(Buffer.from([0x01, 0x02, 0x03]));
          setTimeout(() => { conn.close(); resolve(); }, 100);
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      await waitFor(() => received.length >= 1);
      expect(received[0]).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] pool.send(buffer) delivers a Buffer to the server', async () => {
    const received: Buffer[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(Buffer.from(d as Buffer)));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    try {
      await waitFor(() => pool.openConnections === 1);
      pool.send(Buffer.from([0x01, 0x02, 0x03]));
      await waitFor(() => received.length >= 1);
      expect(received[0]).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Receive messages from the server
// ---------------------------------------------------------------------------

describe('Migration — receive messages from the server', () => {
  it('[websocket] connection message event delivers msg.utf8Data for text', async () => {
    const server = await startServer((ws) => {
      ws.send('server says hello');
    });
    try {
      const msg = await new Promise<string>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.on('message', (m) => {
            if (m.type === 'utf8') resolve(m.utf8Data!);
          });
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      expect(msg).toBe('server says hello');
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] pool "message" event delivers data as Buffer/string', async () => {
    const server = await startServer((ws) => {
      ws.send('server says hello');
    });
    const received: string[] = [];
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    pool.on('message', (data) => received.push(data.toString()));
    try {
      await waitFor(() => received.length >= 1);
      expect(received[0]).toBe('server says hello');
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Echo round-trip (send → server echoes → client receives)
// ---------------------------------------------------------------------------

describe('Migration — echo round-trip', () => {
  it('[websocket] sends a message and receives the echo', async () => {
    const server = await startServer((ws) => {
      // Echo back as a text string so the websocket client receives msg.type === 'utf8'
      ws.on('message', (d) => ws.send(d.toString()));
    });
    try {
      const echo = await new Promise<string>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.on('message', (m) => {
            if (m.type === 'utf8') resolve(m.utf8Data!);
          });
          conn.sendUTF('ping');
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      expect(echo).toBe('ping');
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] sends a message and receives the echo', async () => {
    const received: string[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => ws.send(d));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 1, logger: false });
    pool.on('message', (d) => received.push(d.toString()));
    try {
      await waitFor(() => pool.openConnections === 1);
      pool.send('ping');
      await waitFor(() => received.length >= 1);
      expect(received[0]).toBe('ping');
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Handle connection failure
// ---------------------------------------------------------------------------

describe('Migration — handle connection failure', () => {
  // Use a port with nothing listening
  const deadUrl = 'ws://127.0.0.1:19999';

  it('[websocket] connectFailed fires when server is unreachable', async () => {
    const err = await new Promise<Error>((resolve) => {
      const client = new WebSocketClient();
      client.on('connectFailed', (e) => resolve(e));
      client.connect(deadUrl);
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('[ws-multi-pool] "error" event fires when server is unreachable', async () => {
    const errors: Error[] = [];
    const pool = new WebSocketPool(deadUrl, {
      poolSize: 1,
      reconnectInterval: 50,
      maxReconnectInterval: 100,
      maxReconnectAttempts: 1,
      logger: false,
    });
    pool.on('error', (e) => errors.push(e));
    try {
      await waitFor(() => errors.length >= 1, 20, 5000);
      expect(errors[0]).toBeInstanceOf(Error);
    } finally {
      pool.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Graceful close
// ---------------------------------------------------------------------------

describe('Migration — close the connection', () => {
  it('[websocket] connection.close() fires the close event', async () => {
    const server = await startServer();
    try {
      const closed = await new Promise<boolean>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.on('close', () => resolve(true));
          conn.close();
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      expect(closed).toBe(true);
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] pool.close() closes all connections cleanly', async () => {
    const server = await startServer();
    const pool = new WebSocketPool(server.url, { poolSize: 2, logger: false });
    try {
      await waitFor(() => pool.openConnections === 2);
      await pool.close();
      expect(pool.openConnections).toBe(0);
    } finally {
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Automatic reconnection (ws-multi-pool advantage)
// ---------------------------------------------------------------------------

describe('Migration — automatic reconnection', () => {
  it('[websocket] requires manual reconnect logic on close', async () => {
    // With the websocket package you must manually call client.connect() again
    // inside the connection "close" handler. This test proves it works but
    // shows the boilerplate involved.
    let connectCount = 0;
    const server = await startServer();
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocketClient();
        const connect = (): void => client.connect(server.url);

        client.on('connect', (conn) => {
          connectCount++;
          if (connectCount === 1) {
            // Simulate server dropping the connection
            conn.on('close', () => {
              if (connectCount < 2) connect(); // manual reconnect
            });
            for (const c of server.wss.clients) c.terminate();
          } else {
            conn.close();
            resolve();
          }
        });
        client.on('connectFailed', reject);
        connect();
      });
      expect(connectCount).toBe(2);
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] reconnects automatically — no user code required', async () => {
    let openCount = 0;
    const server = await startServer();
    const pool = new WebSocketPool(server.url, {
      poolSize: 1,
      reconnectInterval: 50,
      maxReconnectInterval: 200,
      logger: false,
    });
    pool.on('open', () => openCount++);
    try {
      await waitFor(() => openCount >= 1, 20, 3000);
      // Drop the connection server-side — pool reconnects on its own
      for (const c of server.wss.clients) c.terminate();
      await waitFor(() => openCount >= 2, 20, 5000);
      expect(openCount).toBeGreaterThanOrEqual(2);
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Connection pooling (ws-multi-pool advantage)
// ---------------------------------------------------------------------------

describe('Migration — connection pooling', () => {
  it('[websocket] single connection handles one message at a time', async () => {
    // WebSocketClient manages exactly one connection — no built-in pooling.
    const received: string[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(d.toString()));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new WebSocketClient();
        client.on('connect', (conn) => {
          conn.sendUTF('msg-A');
          conn.sendUTF('msg-B');
          setTimeout(() => { conn.close(); resolve(); }, 150);
        });
        client.on('connectFailed', reject);
        client.connect(server.url);
      });
      await waitFor(() => received.length >= 2);
      // Both arrive but via a single underlying socket — no built-in pooling
      expect(received).toContain('msg-A');
      expect(received).toContain('msg-B');
    } finally {
      await stopServer(server);
    }
  });

  it('[ws-multi-pool] multiple connections handle messages concurrently', async () => {
    const received: string[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (d) => received.push(d.toString()));
    });
    const pool = new WebSocketPool(server.url, { poolSize: 3, logger: false });
    try {
      await waitFor(() => pool.openConnections === 3);
      // 3 open connections maintained in parallel
      expect(server.wss.clients.size).toBe(3);

      for (let i = 0; i < 9; i++) pool.send(`msg-${i}`);
      await waitFor(() => received.length >= 9);
      expect(received).toHaveLength(9);
    } finally {
      pool.destroy();
      await stopServer(server);
    }
  });
});
