import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { HttpError } from "../utils/errors";
import { logger } from "../utils/logger";

export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      "Invalid request",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Endpoint not found"));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details ?? undefined });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  logger.error("Unhandled request error", error);
  res.status(500).json({ error: "Internal server error", details: message });
}
