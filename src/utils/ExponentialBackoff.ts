/**
 * Computes exponentially increasing delay values with optional jitter.
 *
 * Each call to `next()` advances the internal attempt counter so subsequent
 * calls return progressively longer delays, capped at `maxDelay`.  Call
 * `reset()` to start over from the initial delay.
 *
 * Jitter is applied using a full-jitter strategy: the returned value is a
 * random number in `[0, computedDelay]`. This spreads reconnect attempts
 * across time when many clients recover simultaneously.
 */
export class ExponentialBackoff {
  private attempt = 0;

  constructor(
    private readonly initialDelay: number,
    private readonly maxDelay: number,
    private readonly multiplier: number = 2,
    private readonly jitter: boolean = true,
  ) {
    if (initialDelay <= 0) throw new RangeError('initialDelay must be > 0');
    if (maxDelay < initialDelay) throw new RangeError('maxDelay must be >= initialDelay');
    if (multiplier <= 1) throw new RangeError('multiplier must be > 1');
  }

  /**
   * Returns the next delay in milliseconds and increments the attempt counter.
   */
  next(): number {
    const base = Math.min(this.initialDelay * this.multiplier ** this.attempt, this.maxDelay);
    this.attempt++;
    return this.jitter ? Math.random() * base : base;
  }

  /** Resets the attempt counter back to zero. */
  reset(): void {
    this.attempt = 0;
  }

  /** The number of times `next()` has been called since construction or last `reset()`. */
  get attempts(): number {
    return this.attempt;
  }
}
