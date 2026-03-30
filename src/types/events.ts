import type { RawData } from 'ws';
import type { IncomingMessage, ClientRequest } from 'http';

export interface PoolEvents extends Record<string, unknown[]> {
  /** Emitted when a pooled connection opens. */
  open: [connectionId: number];
  /** Emitted when a pooled connection closes. */
  close: [connectionId: number, code: number, reason: Buffer];
  /** Emitted when a pooled connection encounters an error. */
  error: [error: Error, connectionId: number];
  /** Emitted when a message is received on any pooled connection. */
  message: [data: RawData, isBinary: boolean, connectionId: number];
  /** Emitted after buffered messages are flushed when a connection recovers. */
  drain: [messagesSent: number];
  /** Emitted when every connection in the pool is open. */
  'pool:ready': [];
  /** Emitted when every connection in the pool is closed. */
  'pool:empty': [];
  /** Emitted when the server rejects the HTTP handshake. */
  'unexpected-response': [request: ClientRequest, response: IncomingMessage, connectionId: number];
  /** Emitted when the server accepts the HTTP handshake. */
  upgrade: [response: IncomingMessage, connectionId: number];
  /** Emitted when the server sends a raw ping frame. */
  ping: [data: Buffer, connectionId: number];
  /** Emitted when the server sends a raw pong frame. */
  pong: [data: Buffer, connectionId: number];
}

export interface ConnectionEvents extends Record<string, unknown[]> {
  open: [connectionId: number];
  close: [connectionId: number, code: number, reason: Buffer];
  error: [error: Error, connectionId: number];
  message: [data: RawData, isBinary: boolean, connectionId: number];
  'unexpected-response': [request: ClientRequest, response: IncomingMessage, connectionId: number];
  upgrade: [response: IncomingMessage, connectionId: number];
  ping: [data: Buffer, connectionId: number];
  pong: [data: Buffer, connectionId: number];
}
