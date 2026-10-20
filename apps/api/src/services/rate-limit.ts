import type { FastifyRequest } from "fastify";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter kept in memory. A per-client limit stops casual guessing; a global limit
 * bounds brute force even if a caller rotates its forwarded address.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perClientLimit: number,
    private readonly globalLimit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the request should be rejected. */
  take(request: FastifyRequest, scope: string): boolean {
    const now = Date.now();

    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) {
          this.buckets.delete(key);
        }
      }
    }

    return this.consume(`${scope}:global`, this.globalLimit, now)
      && this.consume(`${scope}:${getClientAddress(request)}`, this.perClientLimit, now);
  }

  private consume(key: string, limit: number, now: number): boolean {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    bucket.count += 1;
    return bucket.count <= limit;
  }
}

// Browser traffic reaches the API through the web container's rewrite, which forwards the client address.
function getClientAddress(request: FastifyRequest): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim();
  return firstForwarded || request.ip;
}
