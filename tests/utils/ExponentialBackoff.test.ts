import { describe, it, expect, beforeEach } from 'vitest';
import { ExponentialBackoff } from '../../src/utils/ExponentialBackoff.js';

describe('ExponentialBackoff', () => {
  describe('constructor validation', () => {
    it('throws when initialDelay is <= 0', () => {
      expect(() => new ExponentialBackoff(0, 1000)).toThrow(RangeError);
      expect(() => new ExponentialBackoff(-1, 1000)).toThrow(RangeError);
    });

    it('throws when maxDelay < initialDelay', () => {
      expect(() => new ExponentialBackoff(1000, 500)).toThrow(RangeError);
    });

    it('throws when multiplier <= 1', () => {
      expect(() => new ExponentialBackoff(100, 5000, 1)).toThrow(RangeError);
      expect(() => new ExponentialBackoff(100, 5000, 0.5)).toThrow(RangeError);
    });

    it('constructs successfully with valid arguments', () => {
      expect(() => new ExponentialBackoff(100, 5000)).not.toThrow();
    });
  });

  describe('next() without jitter', () => {
    let backoff: ExponentialBackoff;

    beforeEach(() => {
      // jitter=false for deterministic tests
      backoff = new ExponentialBackoff(100, 10_000, 2, false);
    });

    it('returns initialDelay on first call', () => {
      expect(backoff.next()).toBe(100);
    });

    it('doubles the delay on each successive call', () => {
      expect(backoff.next()).toBe(100);   // attempt 0 → 100 * 2^0 = 100
      expect(backoff.next()).toBe(200);   // attempt 1 → 100 * 2^1 = 200
      expect(backoff.next()).toBe(400);
      expect(backoff.next()).toBe(800);
    });

    it('caps at maxDelay', () => {
      const small = new ExponentialBackoff(100, 500, 2, false);
      small.next(); // 100
      small.next(); // 200
      small.next(); // 400
      expect(small.next()).toBe(500); // would be 800, capped to 500
      expect(small.next()).toBe(500);
    });

    it('tracks the attempt counter', () => {
      expect(backoff.attempts).toBe(0);
      backoff.next();
      expect(backoff.attempts).toBe(1);
      backoff.next();
      expect(backoff.attempts).toBe(2);
    });
  });

  describe('reset()', () => {
    it('resets attempt counter to zero', () => {
      const backoff = new ExponentialBackoff(100, 10_000, 2, false);
      backoff.next();
      backoff.next();
      backoff.next();
      expect(backoff.attempts).toBe(3);

      backoff.reset();
      expect(backoff.attempts).toBe(0);
    });

    it('returns initialDelay again after reset', () => {
      const backoff = new ExponentialBackoff(100, 10_000, 2, false);
      backoff.next();
      backoff.next();
      backoff.reset();
      expect(backoff.next()).toBe(100);
    });
  });

  describe('next() with jitter (default)', () => {
    it('returns values within [0, computedDelay]', () => {
      const backoff = new ExponentialBackoff(1000, 30_000); // jitter=true by default
      for (let i = 0; i < 10; i++) {
        const delay = backoff.next();
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(30_000);
      }
    });

    it('never exceeds maxDelay even with jitter', () => {
      const backoff = new ExponentialBackoff(1000, 5_000);
      for (let i = 0; i < 20; i++) {
        expect(backoff.next()).toBeLessThanOrEqual(5_000);
      }
    });
  });
});
