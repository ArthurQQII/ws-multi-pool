# ws-multi-pool

> High-performance multiplexed WebSocket connection pool for Node.js

[![CI](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ws-multi-pool.svg)](https://www.npmjs.com/package/ws-multi-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why?

When two servers communicate over a single WebSocket connection, that single TCP pipe can quickly become a throughput bottleneck. **ws-multi-pool** solves this by maintaining a fixed-size pool of `N` concurrent WebSocket connections to the very same endpoint and distributing outgoing traffic across them seamlessly via round-robin. 

Designed as a **1:1 conceptual drop-in replacement** tailored for scale, you interact with `WebSocketPool` exactly as you would a standard single `ws` connection — it takes the exact same arguments, forwards the same connection options, natively emits the same HTTP handshake events, and accepts standard binary and compression sending frames. Internally, however, it masks away all the complexity of connection elasticity.

This architecture is critical for:

- **High-throughput server-to-server streams** where a single core/socket can't saturate the available network link.
- **Microservice resilience** — if one connection violently drops, the remaining `N-1` connections continue serving traffic transparently while the failed socket recovers with automated jitter backoff.
- **Traffic Burst Absorption** — sudden spikes in traffic are absorbed by the internal queue buffers seamlessly if connections temporarily flutter.

## Features

- **Round-robin load balancing** across a configurable number of connections.
- **Automatic reconnection** with full-jitter exponential backoff and configurable retry limits.
- **Message queuing** — buffers sends with parameters fully intact when all connections are down; safely flushes on recovery.
- **Heartbeat & Pinging** — built-in automated heartbeat detection, plus manual `ping()` / `broadcastPing()` capabilities.
- **Complete Feature Parity** — fully maps underlying native `ws` HTTP handshake hooks, `SendOptions` configurations, and `Buffer` types.
- **Native broadcast** — fan-out a payload or configuration event selectively to all open connections simultaneously.
- **Fully typed** — written organically in strict TypeScript, bubbling precise error definitions and structured typed events.
- **Dual format** — ships ESM + CJS with full `.d.ts` declarations automatically ready out of the box.
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

// React perfectly to incoming data
pool.on('message', (data, isBinary, connectionId) => {
  console.log(`[conn ${connectionId}]`, data.toString());
});

// Send a standard message (automatically load-balances across pipes)
pool.send(JSON.stringify({ type: 'subscribe', channel: 'trades' }));

// Send a compressed binary message, just as you would organically in `ws`
pool.send(Buffer.from('binary-data'), { compress: true });
```

## API

### `new WebSocketPool(url, options?)`

Creates a pool of WebSocket connections and immediately starts connecting them to the target URL asynchronously.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `poolSize` | `number` | `5` | Number of concurrent WebSocket connections |
| `reconnectInterval` | `number` | `1000` | Initial reconnect string delay in ms |
| `maxReconnectInterval` | `number` | `30000` | Maximum limit on the jitter backoff delay in ms |
| `reconnectBackoffMultiplier` | `number` | `2` | Multiplier applied dynamically on each failed retry |
| `maxReconnectAttempts` | `number` | `Infinity`| Total consecutive failures allowed before giving up on a socket |
| `heartbeatInterval` | `number` | `0` | Ping interval in ms (`0` = disabled) |
| `heartbeatTimeout` | `number` | `5000` | Time to wait for a pong before fatally terminating |
| `messageQueueSize` | `number` | `100` | Max buffered payloads while disconnected (`0` = disabled) |
| `logger` | `Logger \| false` | noop | Logger interface format, or `false` to silence |
| `wsFactory` | `WebSocketFactory` | built-in | Extension point for mocking WebSocket instances |
| `wsOptions` | `ws.ClientOptions` | — | Native headers & configs forwarded to the underlying `ws` client |

### `pool.send(data, options?, callback?)`

Sends `data` on the next available open connection using round-robin distribution.

Functions identically to standard `ws.send`. You can pass `options` (`{ binary, compress, mask, fin }`) to configure the raw frame. If no connections are open, the payload alongside its designated options and callback are buffered directly into the queue.

```ts
pool.send('hello');
pool.send(Buffer.from([0x01, 0x02]), { binary: true });
pool.send('with callback', (err) => {
  if (err) console.error('send failed:', err);
});
```

### `pool.broadcast(data, options?)`

Sends `data` to **all** currently open connections. Returns `Promise<PromiseSettledResult<void>[]>` so developers can gracefully inspect per-connection transaction outcomes. Uniquely useful for setting global Subscription states or emitting active authorization headers independently across every pipe.

```ts
const results = await pool.broadcast(JSON.stringify({ action: 'auth' }));
const failures = results.filter((r) => r.status === 'rejected');
```

### `pool.ping(data?, mask?, cb?)`

Ping the next available connection with standard WS masking. Ideal for calculating granular response latency.

### `pool.broadcastPing(data?, mask?)`

Fans a ping payload out to all live connections simultaneously to verify sweeping network synchronicity.

### `pool.getStats()`

Returns a snapshot of the pool's current connectivity distributions.

```ts
const stats = pool.getStats();
// { total: 5, open: 4, connecting: 1, closed: 0, queuedMessages: 0 }
```

### `pool.close()`

Gracefully attempts a closing handshake on all connections and returns a `Promise<void>` that cleanly resolves once every socket is torn down. Pending queues are strictly dropped.

```ts
await pool.close();
```

### `pool.destroy()`

Immediately terminates all connections fatally, skipping the graceful shutdown. The pool class becomes unusable organically.

```ts
pool.destroy();
```

### Events

The `WebSocketPool` instance mirrors Native HTTP/WS socket lifecycles seamlessly.

| Event | Callback Signature | Description |
|---|---|---|
| `message` | `(data, isBinary, connectionId)` | Message frame parsed over any active pool connection |
| `unexpected-response`| `(request, response, connectionId)`| Handshake was organically rejected by proxy/server (e.g., 401) |
| `upgrade` | `(response, connectionId)` | Handshake was accepted gracefully containing Response payload |
| `ping` | `(data, connectionId)` | Target server pushed an inbound native ping frame |
| `pong` | `(data, connectionId)` | Target server replied directly to an outbound ping |
| `open` | `(connectionId)` | An atomic socket connection was fully successfully opened |
| `close` | `(connectionId, code, reason)` | An atomic socket connection closed gracefully by protocol |
| `error` | `(error, connectionId)` | An atomic socket encountered a lethal exception |
| `drain` | `(messagesSent)` | Pending queue flush was triggered upon a recovery node opening |
| `pool:ready` | `()` | Every designated connection within the pool parameter has opened |
| `pool:empty` | `()` | Every designated connection within the pool parameter is shut |

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
