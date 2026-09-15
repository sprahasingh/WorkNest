import type { Request, Response } from "express";
import { register, createSession } from "./auth.service.js";
import { setRefreshCookie } from "../../lib/cookies.js";
import { signAccessToken } from "../../lib/jwt.js";
import type { RegisterInput } from "./auth.schemas.js";
import { login } from "./auth.service.js";
import type { LoginInput } from "./auth.schemas.js";

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
