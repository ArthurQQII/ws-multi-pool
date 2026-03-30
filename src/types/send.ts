import type { WebSocket } from 'ws';

export type SendData = Parameters<WebSocket['send']>[0];
export type SendCallback = (error?: Error) => void;

export interface SendOptions {
  mask?: boolean;
  binary?: boolean;
  compress?: boolean;
  fin?: boolean;
}

export interface QueuedMessage {
  data: SendData;
  options?: SendOptions;
  callback?: SendCallback;
}
