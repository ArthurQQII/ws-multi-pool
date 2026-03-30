import { describe, it, expect, vi } from 'vitest';
import { createConsoleLogger, noopLogger } from '../../src/utils/logger.js';

describe('createConsoleLogger', () => {
  it('calls console.debug for debug()', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.debug('test %s', 'arg');
    expect(spy).toHaveBeenCalledWith('[ws-multi-pool] test %s', 'arg');
    spy.mockRestore();
  });

  it('calls console.info for info()', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.info('hello');
    expect(spy).toHaveBeenCalledWith('[ws-multi-pool] hello');
    spy.mockRestore();
  });

  it('calls console.warn for warn()', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.warn('warning');
    expect(spy).toHaveBeenCalledWith('[ws-multi-pool] warning');
    spy.mockRestore();
  });

  it('calls console.error for error()', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.error('err');
    expect(spy).toHaveBeenCalledWith('[ws-multi-pool] err');
    spy.mockRestore();
  });

  it('uses custom prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createConsoleLogger('[custom]');
    logger.info('msg');
    expect(spy).toHaveBeenCalledWith('[custom] msg');
    spy.mockRestore();
  });

  it('uses default prefix when none provided', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.info('msg');
    expect(spy.mock.calls[0][0]).toContain('[ws-multi-pool]');
    spy.mockRestore();
  });
});

describe('noopLogger', () => {
  it('debug() does not throw', () => {
    expect(() => noopLogger.debug('test')).not.toThrow();
  });

  it('info() does not throw', () => {
    expect(() => noopLogger.info('test')).not.toThrow();
  });

  it('warn() does not throw', () => {
    expect(() => noopLogger.warn('test')).not.toThrow();
  });

  it('error() does not throw', () => {
    expect(() => noopLogger.error('test')).not.toThrow();
  });

  it('all methods return undefined', () => {
    expect(noopLogger.debug('test')).toBeUndefined();
    expect(noopLogger.info('test')).toBeUndefined();
    expect(noopLogger.warn('test')).toBeUndefined();
    expect(noopLogger.error('test')).toBeUndefined();
  });

  it('does not call console methods', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    noopLogger.info('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
