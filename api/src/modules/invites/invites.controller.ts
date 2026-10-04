import type { Request, Response } from "express";
import {
  createInvite,
  listPendingInvites,
  revokeInvite,
  acceptInvite,
  acceptInviteById,
  declineInvite,
  declineInviteByToken,
  listMyInvites,
  signupViaInvite,
  getInviteByToken,
} from "./invites.service.js";
import { AppError } from "../../lib/errors.js";
import { Invite } from "../../models/Invite.js";
import { createSession } from "../auth/auth.service.js";
import { setRefreshCookie } from "../../lib/cookies.js";
import { signAccessToken } from "../../lib/jwt.js";
import { User } from "../../models/User.js";
import type {
  CreateInviteInput,
  InviteSignupInput,
} from "./invites.schemas.js";
import { env } from "../../config/env.js";
import { sendInviteEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";

export async function createInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateInviteInput;
  const { invite, rawToken, existingUser, organizationName } =
    await createInvite(input);
  const inviteUrl = new URL(
    `/invite/${rawToken}`,
    env.CLIENT_ORIGIN,
  ).toString();

  try {
    await sendInviteEmail(input.email, organizationName, input.role, inviteUrl);
    await Invite.updateOne(
      { _id: invite._id },
      { emailedAt: new Date() },
    ).setOptions({ skipTenant: true });
    res.status(201).json({ invite, existingUser, emailSent: true });
  } catch (error) {
    logger.error(
      { err: error, inviteId: invite._id },
      "Invite email delivery failed",
    );
    res.status(201).json({ invite, existingUser, emailSent: false, inviteUrl });
  }
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

async function currentUserEmail(userId: string): Promise<string> {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  return user.email as string;
}

export async function acceptInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const userId = req.auth!.userId;
  const email = await currentUserEmail(userId);

  const membership = await acceptInvite(token as string, userId, email);

  res.status(200).json({ membership });
}

export async function declineInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.auth!.userId;
  const email = await currentUserEmail(userId);
  await declineInviteByToken(req.params.token as string, userId, email);
  res.status(204).send();
}

export async function listMyInvitesController(
  req: Request,
  res: Response,
): Promise<void> {
  const email = await currentUserEmail(req.auth!.userId);
  const invites = await listMyInvites(email);
  res.status(200).json({ invites });
}

export async function acceptMyInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.auth!.userId;
  const email = await currentUserEmail(userId);
  const membership = await acceptInviteById(
    req.params.inviteId as string,
    userId,
    email,
  );
  res.status(200).json({ membership });
}

export async function declineMyInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.auth!.userId;
  const email = await currentUserEmail(userId);
  await declineInvite({ _id: req.params.inviteId as string }, userId, email);
  res.status(204).send();
}

export async function signupViaInviteController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const input = req.validated!.body as InviteSignupInput;

  const result = await signupViaInvite(token as string, input);
  if (result.userId) {
    // The invite went to this inbox, so the account is ready right away.
    const { rawToken, expiresAt } = await createSession(result.userId);
    setRefreshCookie(res, rawToken, expiresAt);
    const accessToken = signAccessToken(result.userId.toString());
    res.status(201).json({ accessToken, verificationRequired: false });
    return;
  }
  res.status(202).json({
    email: result.email,
    verificationRequired: true,
    signupToken: result.signupToken,
  });
}

export async function getInviteByTokenController(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.params;
  const preview = await getInviteByToken(token as string);
  res.status(200).json(preview);
}
