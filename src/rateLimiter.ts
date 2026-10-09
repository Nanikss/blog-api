import { Request, RequestHandler } from "express";
import { Clock } from "./clock";
import { ApiError } from "./errors";

export interface TokenBucketOptions {
  /** Maximum burst size. */
  capacity: number;
  /** One token is added back every `refillEveryMs` milliseconds. */
  refillEveryMs: number;
  clock: Clock;
  /** Once this many keys are tracked, buckets that have refilled completely are dropped. */
  maxKeys?: number;
}

export type TakeResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-process token bucket keyed by an arbitrary string. Refill is computed lazily
 * on each call, so there are no timers. A full bucket behaves exactly like a missing
 * one, which is what makes eviction safe.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: TokenBucketOptions) {}

  take(key: string): TakeResult {
    const now = this.options.clock();
    const bucket = this.refill(this.buckets.get(key), now);
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > (this.options.maxKeys ?? 10_000)) this.evictFull(now);

    if (allowed) return { allowed: true };
    const msUntilNextToken = (1 - bucket.tokens) * this.options.refillEveryMs;
    return { allowed: false, retryAfterSeconds: Math.ceil(msUntilNextToken / 1000) };
  }

  /** Number of keys currently tracked. */
  get size() {
    return this.buckets.size;
  }

  private refill(bucket: Bucket | undefined, now: number): Bucket {
    const { capacity, refillEveryMs } = this.options;
    if (!bucket) return { tokens: capacity, updatedAt: now };
    const earned = Math.max(0, now - bucket.updatedAt) / refillEveryMs;
    return { tokens: Math.min(capacity, bucket.tokens + earned), updatedAt: now };
  }

  private evictFull(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (this.refill(bucket, now).tokens >= this.options.capacity) this.buckets.delete(key);
    }
  }
}

export function rateLimit(limiter: TokenBucketLimiter, keyOf: (req: Request) => string): RequestHandler {
  return (req, res, next) => {
    const result = limiter.take(keyOf(req));
    if (result.allowed) return next();
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    next(new ApiError(429, "RATE_LIMITED", "Too many attempts; try again later"));
  };
}
