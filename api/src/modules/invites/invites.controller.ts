import type { Request, Response } from "express";
import {
  createInvite,
  listPendingInvites,
  revokeInvite,
  acceptInvite,
  signupViaInvite,
  getInviteByToken,
} from "./invites.service.js";
import { createSession } from "../auth/auth.service.js";
import { setRefreshCookie } from "../../lib/cookies.js";
import { signAccessToken } from "../../lib/jwt.js";
import { AppError } from "../../lib/errors.js";
import { User } from "../../models/User.js";
import type {
  CreateInviteInput,
  InviteSignupInput,
} from "./invites.schemas.js";
import { env } from "../../config/env.js";

export async function createInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateInviteInput;
  const { invite, rawToken } = await createInvite(input);
  const inviteUrl = `${env.CLIENT_ORIGIN}/invite/${rawToken}`;
  res.status(201).json({ invite, inviteUrl });
}

export async function listInvitesController(
  req: Request,
  res: Response,
): Promise<void> {
  const invites = await listPendingInvites();
  res.status(200).json({ invites });
}

export async function revokeInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { inviteId } = req.params;
  await revokeInvite(inviteId as string);
  res.status(204).send();
}

export async function acceptInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const userId = req.auth!.userId;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const membership = await acceptInvite(
    token as string,
    userId,
    user.email as string,
  );

  res.status(200).json({ membership });
}

export async function signupViaInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const input = req.validated!.body as InviteSignupInput;

  const { userId } = await signupViaInvite(token as string, input);

  const { rawToken, expiresAt } = await createSession(userId);
  setRefreshCookie(res, rawToken, expiresAt);
  const accessToken = signAccessToken(userId.toString());

  res.status(201).json({ accessToken });
}

export async function getInviteByTokenController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const preview = await getInviteByToken(token as string);
  res.status(200).json(preview);
}
