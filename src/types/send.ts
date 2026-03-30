import type { WebSocket } from 'ws';

export type SendData = Parameters<WebSocket['send']>[0];
export type SendCallback = (error?: Error) => void;

export interface QueuedMessage {
  data: SendData;
  callback?: SendCallback;
}
