import { EventEmitter } from 'events';

/**
 * A thin wrapper around Node's EventEmitter that provides compile-time type
 * safety for event names and their argument tuples.
 *
 * Usage:
 * ```ts
 * interface MyEvents {
 *   data:  [payload: string];
 *   error: [err: Error];
 *   done:  [];
 * }
 *
 * class MyEmitter extends TypedEventEmitter<MyEvents> {}
 * ```
 */
export class TypedEventEmitter<TEvents extends Record<string, unknown[]>> extends EventEmitter {
  override on<K extends string & keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends string & keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends string & keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends string & keyof TEvents>(event: K, ...args: TEvents[K]): boolean {
    return super.emit(event, ...args);
  }

  override removeAllListeners<K extends string & keyof TEvents>(event?: K): this {
    return super.removeAllListeners(event);
  }
}
