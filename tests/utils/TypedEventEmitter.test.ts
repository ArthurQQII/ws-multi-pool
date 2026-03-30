import { describe, it, expect, vi } from 'vitest';
import { TypedEventEmitter } from '../../src/utils/TypedEventEmitter.js';

interface TestEvents extends Record<string, unknown[]> {
  data: [payload: string];
  error: [err: Error, code: number];
  done: [];
}

describe('TypedEventEmitter', () => {
  it('on() and emit() work together', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('data', handler);
    emitter.emit('data', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('once() fires only once', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.once('data', handler);
    emitter.emit('data', 'first');
    emitter.emit('data', 'second');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('first');
  });

  it('off() removes a specific listener', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('data', handler);
    emitter.off('data', handler);
    emitter.emit('data', 'ignored');
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit() returns true when listeners exist', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    emitter.on('data', () => {});
    expect(emitter.emit('data', 'test')).toBe(true);
  });

  it('emit() returns false when no listeners exist', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    expect(emitter.emit('data', 'test')).toBe(false);
  });

  it('removeAllListeners() clears all listeners for an event', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('data', a);
    emitter.on('data', b);
    emitter.removeAllListeners('data');
    emitter.emit('data', 'test');
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('supports multiple listeners on the same event', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('data', a);
    emitter.on('data', b);
    emitter.emit('data', 'both');
    expect(a).toHaveBeenCalledWith('both');
    expect(b).toHaveBeenCalledWith('both');
  });

  it('different events do not interfere', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const dataHandler = vi.fn();
    const doneHandler = vi.fn();
    emitter.on('data', dataHandler);
    emitter.on('done', doneHandler);
    emitter.emit('data', 'hello');
    expect(dataHandler).toHaveBeenCalled();
    expect(doneHandler).not.toHaveBeenCalled();
  });

  it('handles events with multiple arguments', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('error', handler);
    const err = new Error('fail');
    emitter.emit('error', err, 500);
    expect(handler).toHaveBeenCalledWith(err, 500);
  });

  it('handles events with no arguments', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('done', handler);
    emitter.emit('done');
    expect(handler).toHaveBeenCalledWith();
  });

  it('methods return this for chaining', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = () => {};
    const result = emitter.on('data', handler);
    expect(result).toBe(emitter);
    expect(emitter.off('data', handler)).toBe(emitter);
    expect(emitter.removeAllListeners('data')).toBe(emitter);
  });
});
