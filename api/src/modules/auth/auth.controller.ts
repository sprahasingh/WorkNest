import type { Request, Response } from "express";
import {
  register,
  login,
  refresh,
  logout,
  createSession,
  deleteAccount,
  requestEmailChange,
  cancelEmailChange,
  verifyRegistration,
  resendRegistrationVerification,
  resendEmailChange,
  checkRegistrationStatus,
  updatePersonalInformation,
  verifyEmailChange,
  requestPasswordReset,
  resetPassword,
  listSessions,
  revokeSession,
  revokeAllSessions,
} from "./auth.service.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
} from "../../lib/cookies.js";
import { signAccessToken } from "../../lib/jwt.js";
import { AppError } from "../../lib/errors.js";
import { User } from "../../models/User.js";
import type {
  LoginInput,
  RegisterInput,
  RequestEmailChangeInput,
  UpdatePersonalInformationInput,
  VerifyEmailChangeInput,
  VerifyRegistrationInput,
  ResendVerificationInput,
  RegistrationStatusInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import { Membership } from "../../models/Membership.js";

export async function registerController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as RegisterInput;

  const result = await register(input);
  if (result.verificationRequired) {
    res.status(202).json(result);
    return;
  }

  const { rawToken, expiresAt } = await createSession(
    result.userId,
    req.get("user-agent") ?? "",
  );
  setRefreshCookie(res, rawToken, expiresAt);
  const accessToken = signAccessToken(result.userId.toString());
  res.status(201).json({ accessToken, verificationRequired: false });
}

export async function resendVerificationController(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.validated!.body as ResendVerificationInput;
  await resendRegistrationVerification(email);
  // The same answer whether or not a sign-up is waiting.
  res.status(202).json({
    message:
      "If a sign-up is waiting for that email, we've sent a new link. Check your inbox and spam folder.",
  });
}

export async function registrationStatusController(
  req: Request,
  res: Response,
): Promise<void> {
  const { signupToken } = req.validated!.body as RegistrationStatusInput;
  const result = await checkRegistrationStatus(signupToken);
  if (result.status !== "verified") {
    res.status(200).json({ status: result.status });
    return;
  }
  const { rawToken, expiresAt } = await createSession(
    result.userId,
    req.get("user-agent") ?? "",
  );
  setRefreshCookie(res, rawToken, expiresAt);
  res.status(200).json({
    status: "verified",
    accessToken: signAccessToken(result.userId.toString()),
  });
}

export async function verifyRegistrationController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as VerifyRegistrationInput;
  const { userId } = await verifyRegistration(input);
  const { rawToken, expiresAt } = await createSession(
    userId,
    req.get("user-agent") ?? "",
  );

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
  const { rawToken, expiresAt } = await createSession(
    userId,
    req.get("user-agent") ?? "",
  );

  setRefreshCookie(res, rawToken, expiresAt);
  const accessToken = signAccessToken(userId.toString());

  res.status(200).json({ accessToken });
}

export async function requestPasswordResetController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as RequestPasswordResetInput;
  await requestPasswordReset(input);
  res.status(200).json({
    message:
      "If an account exists for that email, we've sent a reset link. Check your inbox and spam folder.",
  });
}

export async function resetPasswordController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as ResetPasswordInput;
  await resetPassword(input);
  res.status(200).json({ message: "Your password has been reset." });
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
  const user = await User.findById(req.auth!.userId).select(
    "+pendingEmail +status",
  );

  // A deleted account's access token may still be valid for a few minutes.
  if (!user || (user as unknown as { status?: string }).status === "deleted") {
    throw new AppError(401, "ACCOUNT_DELETED", "This account no longer exists");
  }

  const memberships = await Membership.find({ userId: req.auth!.userId })
    .setOptions({ skipTenant: true })
    .populate("tenantId", "name slug plan");

  res.status(200).json({ user, memberships });
}

export async function resendEmailChangeController(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await resendEmailChange(req.auth!.userId);
  res.status(200).json({ user });
}

export async function markOnboardingSeenController(
  req: Request,
  res: Response,
): Promise<void> {
  // Only the first call sets the time; later calls leave it as it was.
  await User.updateOne(
    { _id: req.auth!.userId, onboardingSeenAt: null },
    { $set: { onboardingSeenAt: new Date() } },
  );
  const user = await User.findById(req.auth!.userId).select("+pendingEmail");
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  res.status(200).json({ user });
}

export async function deleteAccountController(
  req: Request,
  res: Response,
): Promise<void> {
  await deleteAccount(req.auth!.userId);
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function updatePersonalInformationController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as UpdatePersonalInformationInput;
  const user = await updatePersonalInformation(
    req.auth!.userId,
    input,
    getRefreshCookie(req.cookies),
  );
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  res.status(200).json({ user });
}

export async function requestEmailChangeController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as RequestEmailChangeInput;
  const user = await requestEmailChange(req.auth!.userId, input);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  res.status(user.pendingEmail ? 202 : 200).json({ user });
}

export async function cancelEmailChangeController(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await cancelEmailChange(req.auth!.userId);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  res.status(200).json({ user });
}

export async function verifyEmailChangeController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as VerifyEmailChangeInput;
  const user = await verifyEmailChange(input);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  res.status(200).json({ user });
}

export async function listSessionsController(
  req: Request,
  res: Response,
): Promise<void> {
  const sessions = await listSessions(
    req.auth!.userId,
    getRefreshCookie(req.cookies),
  );
  res.status(200).json({ sessions });
}

export async function revokeSessionController(
  req: Request,
  res: Response,
): Promise<void> {
  await revokeSession(req.auth!.userId, String(req.params.sessionId));
  res.status(204).send();
}

export async function revokeAllSessionsController(
  req: Request,
  res: Response,
): Promise<void> {
  await revokeAllSessions(req.auth!.userId);
  clearRefreshCookie(res);
  res.status(204).send();
}
