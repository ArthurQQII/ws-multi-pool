# ws-multi-pool

> High-performance multiplexed WebSocket connection pool for Node.js

[![CI](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ws-multi-pool.svg)](https://www.npmjs.com/package/ws-multi-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why?

When two servers communicate over a single WebSocket connection, that single TCP pipe can quickly become a throughput bottleneck. **ws-multi-pool** solves this by maintaining a fixed-size pool of `N` concurrent WebSocket connections to the same endpoint and distributing outgoing traffic across them via round-robin.

You interact with `WebSocketPool` much like a standard `ws` connection — it accepts the same constructor arguments, forwards the same connection options, emits the same HTTP handshake events, and supports binary and compressed frames. Internally it handles connection elasticity transparently.

This is especially useful for:

- **High-throughput server-to-server streams** where a single socket can't saturate the available network link.
- **Resilience** — if one connection drops, the remaining `N-1` connections continue serving traffic while the failed socket reconnects with exponential backoff.
- **Burst absorption** — sudden traffic spikes are absorbed by the internal message queue when connections are temporarily unavailable.

## Features

- **Round-robin load balancing** across a configurable number of connections.
- **Automatic reconnection** with full-jitter exponential backoff and configurable retry limits.
- **Message queuing** — buffers sends (including options and callbacks) when all connections are down; flushes on recovery.
- **Heartbeat** — built-in ping/pong keep-alive, plus manual `ping()` / `broadcastPing()`.
- **`ws` feature parity** — forwards `SendOptions`, HTTP handshake events (`upgrade`, `unexpected-response`), and `ping`/`pong` frames.
- **Broadcast** — fan out a message to all open connections simultaneously.
- **Fully typed** — written in strict TypeScript with typed events and precise error definitions.
- **Dual format** — ships ESM + CJS with full `.d.ts` declarations.
- **Zero dependencies** beyond [`ws`](https://github.com/websockets/ws).

## Installation

```bash
# npm
npm install ws-multi-pool

# pnpm
pnpm add ws-multi-pool

# yarn
yarn add ws-multi-pool
```

> **Requires Node.js >= 18**

## Quick Start

```ts
import { WebSocketPool, createConsoleLogger } from 'ws-multi-pool';

const pool = new WebSocketPool('ws://example.com/feed', {
  poolSize: 4,
  logger: createConsoleLogger(),
});

pool.on('message', (data, isBinary, connectionId) => {
  console.log(`[conn ${connectionId}]`, data.toString());
});

pool.send(JSON.stringify({ type: 'subscribe', channel: 'trades' }));

// Send a compressed binary frame
pool.send(Buffer.from('binary-data'), { compress: true });
```

## API

### `new WebSocketPool(url, options?)`

Creates a pool of WebSocket connections and immediately starts connecting them to the target URL asynchronously.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `poolSize` | `number` | `5` | Number of concurrent WebSocket connections |
| `reconnectInterval` | `number` | `1000` | Initial reconnect delay in ms |
| `maxReconnectInterval` | `number` | `30000` | Maximum reconnect delay after exponential backoff |
| `reconnectBackoffMultiplier` | `number` | `2` | Multiplier applied to the delay on each retry |
| `maxReconnectAttempts` | `number` | `Infinity` | Maximum consecutive reconnect attempts before giving up |
| `heartbeatInterval` | `number` | `0` | Ping interval in ms (`0` = disabled) |
| `heartbeatTimeout` | `number` | `5000` | Time to wait for a pong before terminating |
| `messageQueueSize` | `number` | `100` | Max buffered messages when disconnected (`0` = disabled) |
| `logger` | `Logger \| false` | noop | Logger instance, or `false` to silence all output |
| `wsFactory` | `WebSocketFactory` | built-in | Custom factory for creating WebSocket instances (useful for testing) |
| `wsOptions` | `ws.ClientOptions \| string \| string[]` | — | Second argument forwarded to the `ws` constructor (protocols or client options) |

### `pool.send(data, options?, callback?)`

Sends `data` on the next available open connection using round-robin.

Accepts the same arguments as `ws.send`: an optional `options` object (`{ binary, compress, mask, fin }`) and an optional callback. If no connections are open, the message (including its options and callback) is buffered in the queue. If the queue is full, the oldest pending message is dropped and its callback (if any) is called with an error.

```ts
pool.send('hello');
pool.send(Buffer.from([0x01, 0x02]), { binary: true });
pool.send('with callback', (err) => {
  if (err) console.error('send failed:', err);
});
```

### `pool.broadcast(data, options?)`

Sends `data` to **all** currently open connections. Returns `Promise<PromiseSettledResult<void>[]>` so you can inspect per-connection outcomes.

```ts
const results = await pool.broadcast(JSON.stringify({ action: 'auth' }));
const failures = results.filter((r) => r.status === 'rejected');
```

### `pool.ping(data?, mask?, cb?)`

Sends a ping frame on the next available open connection. Passes an error to `cb` if the pool is destroyed or no connections are open.

### `pool.broadcastPing(data?, mask?)`

Sends a ping frame to **all** currently open connections. Returns `Promise<PromiseSettledResult<void>[]>`.

### `pool.getStats()`

Returns a snapshot of connection counts and queue depth.

```ts
const stats = pool.getStats();
// { total: 5, open: 4, connecting: 1, closed: 0, queuedMessages: 0 }
```

### `pool.close()`

Gracefully closes all connections and returns a `Promise<void>` that resolves once every socket has closed. Queued messages are discarded. The pool cannot be reused after calling `close()`.

```ts
await pool.close();
```

### `pool.destroy()`

Immediately terminates all connections without a closing handshake. The pool cannot be reused after calling `destroy()`.

```ts
pool.destroy();
```

### Events

| Event | Callback Signature | Description |
|---|---|---|
| `message` | `(data, isBinary, connectionId)` | Message received on any connection |
| `open` | `(connectionId)` | A pooled connection opened |
| `close` | `(connectionId, code, reason)` | A pooled connection closed |
| `error` | `(error, connectionId)` | A pooled connection encountered an error |
| `drain` | `(messagesSent)` | Queued messages were flushed after a connection recovered |
| `pool:ready` | `()` | All connections are open (fires each time the pool reaches full capacity) |
| `pool:empty` | `()` | All connections are closed |
| `unexpected-response` | `(request, response, connectionId)` | Server rejected the HTTP upgrade (e.g. 401) |
| `upgrade` | `(response, connectionId)` | Server accepted the HTTP upgrade |
| `ping` | `(data, connectionId)` | Server sent a ping frame |
| `pong` | `(data, connectionId)` | Server sent a pong frame |

```ts
pool.on('unexpected-response', (req, res, id) => console.log('Auth check failed directly: ', res.statusCode));
pool.on('pool:ready', () => console.log('All connections scaled and linked'));
```

## Advanced Usage

### Custom Logger

Plug in your own logger (e.g. pino, winston) by implementing the `Logger` interface:

```ts
import pino from 'pino';

const log = pino();

const pool = new WebSocketPool('ws://example.com', {
  logger: {
    debug: (msg, ...args) => log.debug(msg, ...args),
    info:  (msg, ...args) => log.info(msg, ...args),
    warn:  (msg, ...args) => log.warn(msg, ...args),
    error: (msg, ...args) => log.error(msg, ...args),
  },
});
```

### Heartbeat / Keep-Alive

Enable periodic ping/pong to detect connections that have silently died:

```ts
const pool = new WebSocketPool('ws://example.com', {
  heartbeatInterval: 30_000, // Send a ping every 30 seconds
  heartbeatTimeout: 5_000,   // Terminate if no pong within 5 seconds
});
```

### Message Queuing

When all connections are down, messages are buffered and flushed once a connection recovers:

```ts
const pool = new WebSocketPool('ws://example.com', {
  messageQueueSize: 500,
});

pool.on('drain', (count) => {
  console.log(`Sent ${count} buffered messages`);
});
```

Set `messageQueueSize: 0` to disable queuing (messages will be dropped immediately).

### Custom WebSocket Factory (Testing)

Inject a mock WebSocket for unit testing:

```ts
const pool = new WebSocketPool('ws://mock', {
  wsFactory: (url) => new MockWebSocket(url) as any,
});
```

## Exports

```ts
// Classes
import { WebSocketPool, PooledConnection } from 'ws-multi-pool';

// Utilities
import { createConsoleLogger, noopLogger, ExponentialBackoff, TypedEventEmitter } from 'ws-multi-pool';

// Types
import type {
  PoolOptions,
  PoolStats,
  PoolEvents,
  ConnectionEvents,
  ConnectionState,
  Logger,
  SendData,
  SendOptions,
  SendCallback,
  WebSocketFactory,
} from 'ws-multi-pool';
```

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build
pnpm build

# Test coverage
pnpm test:coverage
```

## License

[MIT](LICENSE)
