import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE, GUEST_COOKIE, clearAuthCookies, parseCookieHeader } from "../utils/cookies";
import { verifyToken } from "../utils/jwt";
import { forbidden, unauthorized } from "../utils/errors";
import type { AuthContext, GuestTokenPayload, UserTokenPayload } from "../types/auth";

/** Reads user/guest cookies and attaches `req.auth` when valid. Never rejects. */
export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.cookie;
  if (!header) return next();

  const cookies = parseCookieHeader(header);

  const userToken = cookies[AUTH_COOKIE];
  if (userToken) {
    const payload = verifyToken<UserTokenPayload>(userToken);
    if (payload && payload.role === "user" && payload.sub) {
      req.auth = {
        role: "user",
        userId: payload.sub,
        name: payload.name,
        email: payload.email,
      };
      return next();
    }
  }

  const guestToken = cookies[GUEST_COOKIE];
  if (guestToken) {
    const payload = verifyToken<GuestTokenPayload>(guestToken);
    if (payload && payload.role === "guest" && payload.sub && payload.roomId) {
      req.auth = {
        role: "guest",
        guestId: payload.sub,
        name: payload.name,
        roomId: payload.roomId,
      };
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    clearAuthCookies(res);
    return next(unauthorized());
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (req.auth.role !== "user") return next(forbidden("Create an account to access this feature"));
  next();
}

export function currentAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
