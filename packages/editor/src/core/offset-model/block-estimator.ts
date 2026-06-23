/**
 * BlockEstimator — per-type, content-aware, in-session-calibrated seed heights
 * (docs/025 §5.3). The sibling of the geometry tree: it produces the seed each
 * block carries until it is measured, and the geometry model (treap) never knows
 * it exists. Keeping estimation out of the tree is the §6.2 separation.
 *
 * The seed ladder, best signal first:
 *
 *   analytic(content)  →  per-type bucket mean  →  global mean
 *
 * Analytic where the document model already predicts height — text from its
 * character count and the content width, code from its line count. For blocks
 * with no content signal (images here carry no dimensions; embeds, dividers,
 * structural containers) the ladder falls to the per-type bucket mean, and with
 * no samples at all to the global mean / default — which is exactly the old
 * single-estimate baseline, so the worst case never regresses (docs/025 §5.3).
 *
 * Calibration is "structural formula × one learned correction factor per type"
 * rather than a full a+b·feature regression: simpler, and robust by construction
 * because the per-sample correction is clamped before it moves the factor (the
 * outlier-resistant calibration of docs/025 §5.3, §9.3). The factor is an EMA, so
 * a single giant block or a mid-layout reading cannot drag a type's estimate.
 * The caller is responsible for only feeding real, post-`fonts.ready`
 * measurements into {@link observe} (the estimator trusts what it is told).
 */

export type BlockMetrics =
  | { readonly kind: "text"; readonly typeKey: string; readonly chars: number }
  | { readonly kind: "code"; readonly typeKey: string; readonly lines: number }
  | {
      readonly kind: "image";
      readonly typeKey: string;
      // height / width, so height ≈ contentWidth · aspectRatio.
      readonly aspectRatio: number;
    }
  | { readonly kind: "opaque"; readonly typeKey: string };

export type BlockEstimatorOptions = {
  readonly contentWidth?: number;
  readonly defaultHeight?: number;
  readonly avgCharWidth?: number;
  readonly lineHeight?: number;
  readonly textChrome?: number;
  readonly codeLineHeight?: number;
  readonly codeChrome?: number;
  readonly imageChrome?: number;
  readonly alpha?: number; // EMA smoothing
  readonly ratioMin?: number; // per-sample correction clamp
  readonly ratioMax?: number;
};

type ResolvedOptions = Required<BlockEstimatorOptions>;

const DEFAULTS: ResolvedOptions = {
  alpha: 0.25,
  avgCharWidth: 8,
  codeChrome: 24,
  codeLineHeight: 20,
  contentWidth: 720,
  defaultHeight: 40, // matches DEFAULT_BLOCK_ESTIMATE so cold start == old baseline
  imageChrome: 8,
  lineHeight: 24,
  ratioMax: 4,
  ratioMin: 0.25,
  textChrome: 16,
};

const MIN_CONTENT_WIDTH = 16;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function ema(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev);
}

export class BlockEstimator {
  private readonly o: ResolvedOptions;
  private contentWidth: number;
  // Per-type multiplicative correction on the analytic formula (text/code/image).
  private readonly factors = new Map<string, number>();
  // Per-type mean height for blocks with no analytic signal (opaque tier).
  private readonly buckets = new Map<string, number>();
  // EMA of every measured height, the last-resort tier.
  private globalEma = 0;
  private globalCount = 0;

  constructor(options: BlockEstimatorOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.contentWidth = Math.max(
      MIN_CONTENT_WIDTH,
      options.contentWidth ?? DEFAULTS.contentWidth,
    );
  }

  /** Width changes are a document-wide reflow; the caller re-seeds after this. */
  setContentWidth(width: number): void {
    this.contentWidth = Math.max(MIN_CONTENT_WIDTH, width);
  }

  getContentWidth(): number {
    return this.contentWidth;
  }

  /** The global last-resort mean (or the default when nothing is measured). */
  globalMean(): number {
    return this.globalCount > 0 ? this.globalEma : this.o.defaultHeight;
  }

  // The structural prediction at correction factor 1 — the analytic guess before
  // calibration. Width-adaptive for text and image by construction.
  private analyticRaw(metrics: BlockMetrics): number {
    switch (metrics.kind) {
      case "text": {
        const charsPerLine = Math.max(
          1,
          this.contentWidth / this.o.avgCharWidth,
        );
        const lines = Math.max(1, Math.ceil(metrics.chars / charsPerLine));
        return lines * this.o.lineHeight + this.o.textChrome;
      }
      case "code":
        return (
          Math.max(1, metrics.lines) * this.o.codeLineHeight + this.o.codeChrome
        );
      case "image":
        return (
          Math.max(1, this.contentWidth * metrics.aspectRatio) +
          this.o.imageChrome
        );
      case "opaque":
        return this.o.defaultHeight;
    }
  }

  /** The seed height for a block: the ladder (docs/025 §5.3). */
  seed(metrics: BlockMetrics): number {
    if (metrics.kind === "opaque") {
      const bucket = this.buckets.get(metrics.typeKey);
      return Math.max(1, bucket ?? this.globalMean());
    }
    const raw = this.analyticRaw(metrics);
    const factor = this.factors.get(metrics.typeKey) ?? 1;
    return Math.max(1, raw * factor);
  }

  /**
   * Fold one real measurement into the per-type calibration. Real only: never
   * pass a seed back in, or the estimator would chase its own tail (docs/025
   * §5.3). The caller also gates this on `document.fonts.ready`.
   */
  observe(metrics: BlockMetrics, measuredHeight: number): void {
    if (!(measuredHeight > 0) || !Number.isFinite(measuredHeight)) return;

    // Global tier: EMA of everything measured.
    this.globalEma =
      this.globalCount === 0
        ? measuredHeight
        : ema(this.globalEma, measuredHeight, this.o.alpha);
    this.globalCount += 1;

    if (metrics.kind === "opaque") {
      const prev = this.buckets.get(metrics.typeKey);
      this.buckets.set(
        metrics.typeKey,
        prev === undefined
          ? measuredHeight
          : ema(prev, measuredHeight, this.o.alpha),
      );
      return;
    }

    // Analytic tier: clamp the per-sample correction BEFORE it moves the factor,
    // so one outlier (a giant block, a pre-layout reading) cannot drag the type.
    const raw = this.analyticRaw(metrics);
    const ratio = clamp(
      measuredHeight / Math.max(1, raw),
      this.o.ratioMin,
      this.o.ratioMax,
    );
    const prev = this.factors.get(metrics.typeKey);
    this.factors.set(
      metrics.typeKey,
      prev === undefined ? ratio : ema(prev, ratio, this.o.alpha),
    );
  }
}
