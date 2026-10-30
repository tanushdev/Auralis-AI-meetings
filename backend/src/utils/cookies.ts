import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

export const AUTH_COOKIE = "auth_token";
export const GUEST_COOKIE = "guest_token";

function baseOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function setAuthCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(AUTH_COOKIE, token, baseOptions(maxAgeMs));
}

export function setGuestCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(GUEST_COOKIE, token, baseOptions(maxAgeMs));
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.clearCookie(GUEST_COOKIE, { path: "/" });
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal Cookie-header parser (avoids an ESM-only dependency in this CJS app). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}
