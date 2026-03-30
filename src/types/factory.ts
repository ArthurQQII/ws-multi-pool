import type { ClientOptions, WebSocket } from 'ws';

export type WebSocketFactory = (
  url: string,
  options?: ClientOptions | string | string[],
) => WebSocket;
