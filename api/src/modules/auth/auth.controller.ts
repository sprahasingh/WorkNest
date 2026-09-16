import type { Request, Response } from "express";
import {
  register,
  login,
  refresh,
  logout,
  createSession,
} from "./auth.service.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
} from "../../lib/cookies.js";
import { signAccessToken } from "../../lib/jwt.js";
import { AppError } from "../../lib/errors.js";
import { User } from "../../models/User.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";

export async function registerController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as RegisterInput;

  const { userId } = await register(input);
  const { rawToken, expiresAt } = await createSession(userId);

  setRefreshCookie(res, rawToken, expiresAt);
  const accessToken = signAccessToken(userId.toString());

  res.status(201).json({ accessToken });
}

export async function loginController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as LoginInput;

  const { userId } = await login(input);
  const { rawToken, expiresAt } = await createSession(userId);

  setRefreshCookie(res, rawToken, expiresAt);
  const accessToken = signAccessToken(userId.toString());

  res.status(200).json({ accessToken });
}

export async function refreshController(
  req: Request,
  res: Response,
): Promise<void> {
  const rawToken = getRefreshCookie(req.cookies);

  if (!rawToken) {
    throw new AppError(
      401,
      "REFRESH_TOKEN_MISSING",
      "No refresh token provided",
    );
  }

  const { userId, rawToken: newRawToken, expiresAt } = await refresh(rawToken);

  setRefreshCookie(res, newRawToken, expiresAt);
  const accessToken = signAccessToken(userId.toString());

  res.status(200).json({ accessToken });
}

export async function logoutController(
  req: Request,
  res: Response,
): Promise<void> {
  const rawToken = getRefreshCookie(req.cookies);

  if (rawToken) {
    await logout(rawToken);
  }

  clearRefreshCookie(res);
  res.status(204).send();
}

export async function meController(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.auth!.userId);

  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  res.status(200).json({ user });
}
