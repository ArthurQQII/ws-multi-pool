export interface PoolStats {
  /** Total connections in the pool */
  total: number;
  /** Connections currently open */
  open: number;
  /** Connections currently in the process of connecting */
  connecting: number;
  /** Connections not currently open or connecting (includes idle, closing, closed, and destroyed states) */
  closed: number;
  /** Messages buffered in the send queue */
  queuedMessages: number;
}
