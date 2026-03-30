# ws-multi-pool

> High-performance multiplexed WebSocket connection pool for Node.js

[![CI](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurQQII/ws-multi-pool/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ws-multi-pool.svg)](https://www.npmjs.com/package/ws-multi-pool)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## Why?

When two servers communicate over a single WebSocket connection, that pipe becomes a throughput bottleneck. **ws-multi-pool** solves this by maintaining a fixed-size pool of `N` concurrent WebSocket connections to the same server and distributing outgoing traffic across them via round-robin.

This is especially useful for:

- **High-throughput server-to-server communication** where a single socket can't saturate the link
- **Resilience** — if one connection drops, the remaining `N-1` connections continue serving traffic while the failed one reconnects
- **Burst absorption** — the message queue buffers sends while connections recover

## Features

- **Round-robin load balancing** across a configurable number of connections
- **Automatic reconnection** with exponential backoff and jitter
- **Message queuing** — buffers sends when all connections are down, flushes on recovery
- **Heartbeat** — optional WebSocket ping/pong to detect zombie connections
- **Broadcast** — fan-out a message to all open connections
- **Fully typed** — written in TypeScript with strict types and typed events
- **Dual format** — ships ESM + CJS with full `.d.ts` declarations
- **Zero dependencies** beyond [`ws`](https://github.com/websockets/ws)

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
```

## API

### `new WebSocketPool(url, options?)`

Creates a pool of WebSocket connections and immediately starts connecting.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `poolSize` | `number` | `5` | Number of concurrent WebSocket connections |
| `reconnectInterval` | `number` | `1000` | Initial reconnect delay in ms |
| `maxReconnectInterval` | `number` | `30000` | Maximum reconnect delay after exponential backoff |
| `reconnectBackoffMultiplier` | `number` | `2` | Multiplier applied to the delay on each retry |
| `heartbeatInterval` | `number` | `0` | Ping interval in ms (`0` = disabled) |
| `heartbeatTimeout` | `number` | `5000` | Time to wait for a pong before terminating |
| `messageQueueSize` | `number` | `100` | Max buffered messages when disconnected (`0` = disabled) |
| `logger` | `Logger \| false` | noop | Logger instance, or `false` to silence |
| `wsFactory` | `WebSocketFactory` | built-in | Custom factory for creating WebSocket instances (useful for testing) |
| `wsOptions` | `ws.ClientOptions` | — | Options forwarded to the underlying `ws` constructor |

### `pool.send(data, callback?)`

Sends `data` on the next available open connection using round-robin.

If no connections are open the message is added to an internal queue (up to `messageQueueSize`). When a connection recovers, queued messages are flushed automatically.

```ts
pool.send('hello');
pool.send(Buffer.from([0x01, 0x02]));
pool.send('with callback', (err) => {
  if (err) console.error('send failed:', err);
});
```

### `pool.broadcast(data)`

Sends `data` to **all** currently open connections. Returns `Promise<PromiseSettledResult<void>[]>` so you can inspect per-connection outcomes.

```ts
const results = await pool.broadcast(JSON.stringify({ type: 'ping' }));
const failures = results.filter((r) => r.status === 'rejected');
```

### `pool.getStats()`

Returns a snapshot of the pool's current state.

```ts
const stats = pool.getStats();
// { total: 5, open: 4, connecting: 1, closed: 0, queuedMessages: 0 }
```

### `pool.close()`

Gracefully closes all connections and returns a `Promise<void>` that resolves once every socket has closed. Queued messages are discarded.

```ts
await pool.close();
```

### `pool.destroy()`

Immediately terminates all connections without waiting for the closing handshake. The pool cannot be reused after calling `destroy()`.

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
| `drain` | `(messagesSent)` | Queued messages were flushed after recovery |
| `pool:ready` | `()` | All connections in the pool are open |
| `pool:empty` | `()` | All connections in the pool are closed |

```ts
pool.on('pool:ready', () => console.log('All connections established'));
pool.on('pool:empty', () => console.log('All connections lost'));
pool.on('drain', (n) => console.log(`Flushed ${n} queued messages`));
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

[ISC](LICENSE)
