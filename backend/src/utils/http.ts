import type { Request } from "express";

/** Express 5 types route params as string | string[]; normalise to a string. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
