/**
 * Keeps decoding inside real time on slow machines.
 *
 * The engine always decodes the newest window, so audio never queues up; on
 * a slow CPU the cost is staleness (a decode that takes longer than the hop
 * delays the next update). The pacer stretches hop lengths (`paceScale`)
 * until each decode fits in `targetFraction` of its hop, and relaxes them
 * again when the machine has headroom. Tiers are the discrete scales it
 * moves between, so the behaviour is predictable and easy to report.
 */
export const PACE_TIERS = [1, 1.5, 2, 3, 4] as const;

/**
 * Decode time to report for a window of `windowSec` when hops are budgeted
 * for windows of `baseWindowSec`. A longer window (kirtan's periodic global
 * check) counts at the cost of a normal one: its extra time comes once every
 * few hops, and counting it in full kept the pacer from ever relaxing.
 */
export function decodeCostMs(inferMs: number, windowSec: number, baseWindowSec: number): number {
  return windowSec > baseWindowSec ? (inferMs * baseWindowSec) / windowSec : inferMs;
}

export interface PacerOptions {
  /** A decode should take at most this fraction of the hop. */
  targetFraction: number;
  /** Below this fraction for `relaxAfter` decodes in a row, step down a tier. */
  relaxFraction: number;
  relaxAfter: number;
  /** Over target for this many decodes in a row, step up a tier. */
  tightenAfter: number;
  /** Never run faster than this scale (tests use it to act like a slow computer). */
  minScale: number;
}

export const DEFAULT_PACER_OPTIONS: PacerOptions = {
  targetFraction: 0.7,
  relaxFraction: 0.35,
  relaxAfter: 20,
  tightenAfter: 3,
  minScale: 1,
};

export class Pacer {
  readonly opts: PacerOptions;
  private readonly floor: number;
  private tier: number;
  private over = 0;
  private under = 0;

  constructor(opts: Partial<PacerOptions> = {}) {
    this.opts = { ...DEFAULT_PACER_OPTIONS, ...opts };
    const i = PACE_TIERS.findIndex((s) => s >= this.opts.minScale);
    this.floor = i < 0 ? PACE_TIERS.length - 1 : i;
    this.tier = this.floor;
  }

  get scale(): number {
    return PACE_TIERS[this.tier];
  }

  get tierIndex(): number {
    return this.tier;
  }

  /** Pick a starting tier from a self-test decode of `probeSec` audio. */
  calibrate(probeMs: number, probeSec: number, hopSec: number, windowSec: number): void {
    const expectedMs = (probeMs / probeSec) * windowSec;
    this.tier = this.floor;
    while (this.tier < PACE_TIERS.length - 1 && expectedMs > this.opts.targetFraction * hopSec * 1000 * this.scale) this.tier++;
    this.over = this.under = 0;
  }

  /** Report one decode; returns the (possibly new) scale. */
  observe(inferMs: number, baseHopSec: number): number {
    const budget = baseHopSec * this.scale * 1000;
    const frac = inferMs / budget;
    if (frac > this.opts.targetFraction) {
      this.over++;
      this.under = 0;
      if (this.over >= this.opts.tightenAfter && this.tier < PACE_TIERS.length - 1) {
        this.tier++;
        this.over = 0;
      }
    } else if (frac < this.opts.relaxFraction) {
      this.under++;
      this.over = 0;
      if (this.under >= this.opts.relaxAfter && this.tier > this.floor) {
        this.tier--;
        this.under = 0;
      }
    } else {
      this.over = this.under = 0;
    }
    return this.scale;
  }
}
