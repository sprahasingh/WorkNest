import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

interface MongoServerError extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, requestId: req.id }, "Request failed");
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues,
      },
    });
    return;
  }

  const mongoErr = err as MongoServerError;
  if (mongoErr.code === 11000) {
    res.status(409).json({
      error: {
        code: "CONFLICT",
        message: "A resource with this value already exists",
        details: mongoErr.keyValue ? [mongoErr.keyValue] : [],
      },
    });
    return;
  }

  logger.error({ err, requestId: req.id }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: env.NODE_ENV === "production" ? [] : [String(err)],
    },
  });
}
