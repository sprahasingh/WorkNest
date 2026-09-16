import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
const { TokenExpiredError, JsonWebTokenError } = jwt;
import { verifyAccessToken } from "../lib/jwt.js";
import { AppError } from "../lib/errors.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: { userId: string };
  }
}

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(
      401,
      "TOKEN_INVALID",
      "Missing or malformed authorization header",
    );
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub };
    next();
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new AppError(401, "TOKEN_EXPIRED", "Access token has expired");
    }
    if (error instanceof JsonWebTokenError) {
      throw new AppError(401, "TOKEN_INVALID", "Access token is invalid");
    }
    throw error;
  }
}
