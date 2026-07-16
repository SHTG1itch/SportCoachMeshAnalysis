/** Counts events in a rolling time window. Used to prevent a deterministic
 * renderer crash from turning automatic recovery into an infinite reload loop. */
export class RecentEventCounter {
  private readonly timestamps: number[] = [];

  constructor(private readonly windowMs: number) {
    if (!(windowMs > 0)) throw new Error("Event window must be positive");
  }

  record(now = Date.now()): number {
    this.timestamps.push(now);
    while (
      this.timestamps.length > 0 &&
      this.timestamps[0] < now - this.windowMs
    ) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }
}
