import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/errors";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

/**
 * Small in-memory fixed-window rate limiter. Intended for local single-process
 * deployments; not a replacement for a distributed limiter.
 */
export function rateLimit(options: { max: number; windowMs: number; key?: string }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const identity =
      req.auth?.role === "user" ? req.auth.userId : req.auth?.role === "guest" ? req.auth.guestId : req.ip;
    const key = `${options.key ?? req.path}:${identity ?? "anonymous"}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      return next(new HttpError(429, "Too many requests. Please wait a moment and try again."));
    }
    next();
  };
}
