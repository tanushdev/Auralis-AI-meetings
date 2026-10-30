import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { User } from "../models/User";
import { Meeting } from "../models/Meeting";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { validate } from "../middleware/error";
import { badRequest, conflict, unauthorized } from "../utils/errors";
import { DAY_MS, GUEST_COOKIE, clearAuthCookies, setAuthCookie, setGuestCookie } from "../utils/cookies";
import { durationToMs, signGuestToken, signUserToken } from "../utils/jwt";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

const guestSchema = z.object({
  roomId: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1, "Enter your display name").max(60),
});

function publicUser(user: { _id: unknown; name: string; email: string; avatar?: string | null }) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
  };
}

authRouter.post(
  "/register",
  rateLimit({ max: 10, windowMs: 10 * 60_000, key: "register" }),
  async (req, res) => {
    const body = validate(registerSchema, req.body);
    const exists = await User.exists({ email: body.email });
    if (exists) throw conflict("An account with that email already exists");

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await User.create({ name: body.name, email: body.email, passwordHash });

    const token = signUserToken({
      sub: user._id.toString(),
      name: user.name,
      email: user.email,
      role: "user",
    });
    setAuthCookie(res, token, durationToMs(env.jwtExpiresIn, 7 * DAY_MS));
    res.clearCookie(GUEST_COOKIE, { path: "/" });
    res.status(201).json({ user: publicUser(user) });
  },
);

authRouter.post(
  "/login",
  rateLimit({ max: 15, windowMs: 10 * 60_000, key: "login" }),
  async (req, res) => {
    const body = validate(loginSchema, req.body);
    const user = await User.findOne({ email: body.email }).select("+passwordHash");
    if (!user) throw unauthorized("Invalid email or password");

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw unauthorized("Invalid email or password");

    const token = signUserToken({
      sub: user._id.toString(),
      name: user.name,
      email: user.email,
      role: "user",
    });
    setAuthCookie(res, token, durationToMs(env.jwtExpiresIn, 7 * DAY_MS));
    res.clearCookie(GUEST_COOKIE, { path: "/" });
    res.json({ user: publicUser(user) });
  },
);

authRouter.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const auth = req.auth!;
  if (auth.role === "guest") {
    res.json({ user: null, guest: { name: auth.name, roomId: auth.roomId } });
    return;
  }
  const user = await User.findById(auth.userId);
  if (!user) {
    clearAuthCookies(res);
    throw unauthorized("Your session is no longer valid");
  }
  res.json({ user: publicUser(user), guest: null });
});

authRouter.post(
  "/guest",
  rateLimit({ max: 20, windowMs: 10 * 60_000, key: "guest" }),
  async (req, res) => {
    const body = validate(guestSchema, req.body);
    const meeting = await Meeting.findOne({ roomId: body.roomId }).select("status roomId");
    if (!meeting) throw badRequest("That meeting link is not valid");
    if (meeting.status === "ended") throw badRequest("That meeting has already ended");

    const guestId = `guest_${randomUUID()}`;
    const token = signGuestToken({
      sub: guestId,
      name: body.name,
      role: "guest",
      roomId: meeting.roomId,
    });
    setGuestCookie(res, token, durationToMs(env.guestTokenExpiresIn, 12 * 3600_000));
    res.json({ guest: { name: body.name, roomId: meeting.roomId } });
  },
);
