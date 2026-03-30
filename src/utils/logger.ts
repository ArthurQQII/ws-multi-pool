import type { Logger } from '../types/index.js';

const PREFIX = '[ws-multi-pool]';

/**
 * A simple console-backed logger that prefixes every message with the
 * package name.  Pass an instance to {@link PoolOptions.logger} to enable
 * built-in diagnostic output.
 */
export function createConsoleLogger(prefix: string = PREFIX): Logger {
  return {
    /* eslint-disable no-console */
    debug: (msg, ...args) => console.debug(`${prefix} ${msg}`, ...args),
    info: (msg, ...args) => console.info(`${prefix} ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`${prefix} ${msg}`, ...args),
    error: (msg, ...args) => console.error(`${prefix} ${msg}`, ...args),
    /* eslint-enable no-console */
  };
}

/** A logger that discards every message.  Used when `logger` is falsy. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
