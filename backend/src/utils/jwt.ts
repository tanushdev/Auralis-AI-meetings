import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { GuestTokenPayload, UserTokenPayload } from "../types/auth";

const ISSUER = "ai-meeting-platform";

function sign(payload: UserTokenPayload | GuestTokenPayload, expiresIn: string): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: expiresIn as SignOptions["expiresIn"],
    issuer: ISSUER,
  });
}

export function signUserToken(payload: UserTokenPayload): string {
  return sign(payload, env.jwtExpiresIn);
}

export function signGuestToken(payload: GuestTokenPayload): string {
  return sign(payload, env.guestTokenExpiresIn);
}

export function verifyToken<T extends UserTokenPayload | GuestTokenPayload>(token: string): T | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: ISSUER });
    if (!decoded || typeof decoded === "string") return null;
    return decoded as T;
  } catch {
    return null;
  }
}

/** Converts values like "7d", "12h", "30m" into milliseconds. */
export function durationToMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const factor = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * factor;
}
