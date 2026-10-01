import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { PendingRegistration } from "../../models/PendingRegistration.js";
import { Invite } from "../../models/Invite.js";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { Task } from "../../models/Task.js";
import { PLAN_LIMITS } from "../../constants/plans.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { RegisterInput } from "./auth.schemas.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import {
  isEmailDeliveryConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../../lib/email.js";
import { Session } from "../../models/Session.js";
import { randomUUID } from "node:crypto";
import type { LoginInput } from "./auth.schemas.js";
import type {
  RequestEmailChangeInput,
  UpdatePersonalInformationInput,
  VerifyEmailChangeInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  VerifyRegistrationInput,
} from "./auth.schemas.js";
import { generateSlug } from "../orgs/orgs.service.js";
import { recordAudit } from "../audit/audit.service.js";

function duplicateKey(error: unknown, field: "email"): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== 11000
  ) {
    return false;
  }
  const keyPattern = (error as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  if (keyPattern) return keyPattern[field] !== undefined;
  return "message" in error && String(error.message).includes(`${field}_1`);
}

export async function createSession(userId: mongoose.Types.ObjectId | string) {
  const rawToken = randomToken();
  const tokenHash = sha256(rawToken);
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await Session.create({
    userId,
    familyId,
    tokenHash,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export async function register(input: RegisterInput) {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw new AppError(
      409,
      "EMAIL_ALREADY_REGISTERED",
      "An account with this email already exists",
    );
  }

  const bypassVerification = env.EMAIL_VERIFICATION_BYPASS_EMAILS.includes(
    input.email,
  );

  if (!bypassVerification && !isEmailDeliveryConfigured()) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email verification is not configured. Contact your administrator.",
    );
  }

  const token = randomToken();
  const tokenHash = sha256(token);
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const pending = await PendingRegistration.findOneAndUpdate(
    { email: input.email },
    {
      $set: {
        kind: "organization",
        name: input.name,
        passwordHash,
        orgName: input.orgName,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (bypassVerification) {
    const { userId } = await verifyRegistration({ token });
    return { userId, verificationRequired: false as const };
  }

  const verificationUrl = new URL("/verify-email", env.CLIENT_ORIGIN);
  verificationUrl.searchParams.set("token", token);
  try {
    await sendVerificationEmail(
      input.email,
      verificationUrl.toString(),
      "registration",
    );
  } catch (error) {
    await PendingRegistration.deleteOne({ _id: pending._id, tokenHash });
    throw error;
  }

  return { email: input.email, verificationRequired: true as const };
}

export async function verifyRegistration(input: VerifyRegistrationInput) {
  const tokenHash = sha256(input.token);
  const pending = await PendingRegistration.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  }).select("+passwordHash +tokenHash");
  if (!pending) {
    throw new AppError(
      400,
      "REGISTRATION_VERIFICATION_INVALID",
      "This registration link is invalid or has expired",
    );
  }

  const dbSession = await mongoose.startSession();
  try {
    let userId: mongoose.Types.ObjectId;
    await dbSession.withTransaction(async () => {
      const currentPending = await PendingRegistration.findOne({
        _id: pending._id,
        tokenHash,
        expiresAt: { $gt: new Date() },
      })
        .select("+passwordHash +tokenHash")
        .session(dbSession);
      if (!currentPending) {
        throw new AppError(
          400,
          "REGISTRATION_VERIFICATION_INVALID",
          "This registration link is invalid or has expired",
        );
      }

      const [user] = await User.create(
        [
          {
            name: currentPending.name,
            email: currentPending.email,
            emailVerifiedAt: new Date(),
            passwordHash: currentPending.passwordHash,
          },
        ],
        { session: dbSession },
      );

      if (currentPending.kind === "invite") {
        const invite = currentPending.inviteId
          ? await Invite.findOne({ _id: currentPending.inviteId })
              .session(dbSession)
              .setOptions({ skipTenant: true })
          : null;
        if (
          !invite ||
          invite.email !== currentPending.email ||
          invite.status !== "pending" ||
          invite.expiresAt <= new Date()
        ) {
          throw new AppError(
            410,
            "INVITE_EXPIRED",
            "This invite is no longer valid",
          );
        }

        const acceptedInvite = await Invite.findOneAndUpdate(
          {
            _id: invite._id,
            status: "pending",
            expiresAt: { $gt: new Date() },
          },
          { status: "accepted" },
          { session: dbSession },
        ).setOptions({ skipTenant: true });
        if (!acceptedInvite) {
          throw new AppError(
            410,
            "INVITE_EXPIRED",
            "This invite is no longer valid",
          );
        }

        const membership = new Membership({
          tenantId: invite.tenantId,
          userId: user._id,
          role: invite.role,
        });
        membership.$locals.skipTenant = true;
        await membership.save({ session: dbSession });

        if (invite.role === "admin") {
          await Organization.findByIdAndUpdate(
            invite.tenantId,
            { $inc: { adminCount: 1 } },
            { session: dbSession },
          ).setOptions({ skipTenant: true });
        }

        await recordAudit(
          {
            action: "invite.accepted",
            entityType: "Invite",
            entityId: invite._id,
            metadata: {
              email: invite.email,
              role: invite.role,
              viaSignup: true,
            },
            tenantId: invite.tenantId,
            actorId: user._id,
          },
          dbSession,
        );
      } else {
        if (!currentPending.orgName) {
          throw new AppError(
            400,
            "REGISTRATION_VERIFICATION_INVALID",
            "This registration link is invalid or has expired",
          );
        }
        const [organization] = await Organization.create(
          [
            {
              name: currentPending.orgName,
              slug: generateSlug(currentPending.orgName),
              plan: "free",
              seatLimit: PLAN_LIMITS.free.seatLimit,
              seatsUsed: 1,
              projectLimit: PLAN_LIMITS.free.projectLimit,
              projectCount: 0,
              adminCount: 1,
              createdBy: user._id,
            },
          ],
          { session: dbSession },
        );

        const membershipDoc = new Membership({
          tenantId: organization._id,
          userId: user._id,
          role: "admin",
        });
        membershipDoc.$locals.skipTenant = true;
        await membershipDoc.save({ session: dbSession });
      }
      await PendingRegistration.deleteOne(
        { _id: currentPending._id },
        { session: dbSession },
      );
      userId = user._id;
    });
    return { userId: userId! };
  } catch (error) {
    if (duplicateKey(error, "email")) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
      );
    }
    throw error;
  } finally {
    await dbSession.endSession();
  }
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.identifier }).select(
    "+passwordHash +status",
  );

  if (!user) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if ((user as unknown as Record<string, unknown>).status === "deleted") {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const isValid = await bcrypt.compare(
    input.password,
    user.passwordHash as string,
  );

  if (!isValid) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  return { userId: user._id };
}

export async function requestPasswordReset(input: RequestPasswordResetInput) {
  const user = await User.findOne({ email: input.email }).select(
    "+status +passwordResetTokenHash +passwordResetExpiresAt",
  );
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(
      404,
      "ACCOUNT_NOT_FOUND",
      "No account was found with that email.",
    );
  }

  const token = randomToken();
  const tokenHash = sha256(token);
  user.passwordResetTokenHash = tokenHash;
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const resetUrl = new URL("/reset-password", env.CLIENT_ORIGIN);
  resetUrl.searchParams.set("token", token);
  try {
    await sendPasswordResetEmail(input.email, resetUrl.toString());
  } catch {
    await User.updateOne(
      { _id: user._id, passwordResetTokenHash: tokenHash },
      {
        $set: {
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      },
    );
    throw new AppError(
      503,
      "EMAIL_DELIVERY_FAILED",
      "The password reset email could not be sent. Please try again later.",
    );
  }
}

export async function resetPassword(input: ResetPasswordInput) {
  const tokenHash = sha256(input.token);
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+status");

  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(
      400,
      "PASSWORD_RESET_INVALID",
      "This password reset link is invalid or has expired",
    );
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: user._id,
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    },
    { returnDocument: "after" },
  ).select("_id");

  if (!updatedUser) {
    throw new AppError(
      400,
      "PASSWORD_RESET_INVALID",
      "This password reset link is invalid or has expired",
    );
  }

  await Session.updateMany(
    { userId: updatedUser._id, revokedAt: null },
    { revokedAt: new Date() },
  );
}

export async function updatePersonalInformation(
  userId: string,
  input: UpdatePersonalInformationInput,
  currentRefreshToken?: string,
) {
  const user = await User.findById(userId).select("+passwordHash +status");
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const currentPasswordIsValid = await bcrypt.compare(
    input.currentPassword,
    user.passwordHash as string,
  );
  if (!currentPasswordIsValid) {
    throw new AppError(
      401,
      "CURRENT_PASSWORD_INVALID",
      "Current password is incorrect",
    );
  }

  user.name = input.name;
  if (input.newPassword) {
    user.passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_COST);
  }

  try {
    await user.save();
  } catch (error) {
    if (duplicateKey(error, "email")) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
      );
    }
    throw error;
  }

  if (input.newPassword) {
    const currentSession = currentRefreshToken
      ? await Session.findOne({
          userId,
          tokenHash: sha256(currentRefreshToken),
          revokedAt: null,
        }).select("_id")
      : null;

    await Session.updateMany(
      {
        userId,
        revokedAt: null,
        ...(currentSession ? { _id: { $ne: currentSession._id } } : {}),
      },
      { revokedAt: new Date() },
    );
  }

  return User.findById(userId).select("+pendingEmail");
}

export async function requestEmailChange(
  userId: string,
  input: RequestEmailChangeInput,
) {
  const user = await User.findById(userId).select(
    "+passwordHash +status +pendingEmail +emailChangeTokenHash +emailChangeExpiresAt",
  );
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const passwordIsValid = await bcrypt.compare(
    input.currentPassword,
    user.passwordHash as string,
  );
  if (!passwordIsValid) {
    throw new AppError(
      401,
      "CURRENT_PASSWORD_INVALID",
      "Current password is incorrect",
    );
  }

  if (input.email === user.email) {
    user.pendingEmail = null;
    user.emailChangeTokenHash = null;
    user.emailChangeExpiresAt = null;
    await user.save();
    return User.findById(userId).select("+pendingEmail");
  }

  if (!isEmailDeliveryConfigured()) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email verification is not configured. Contact your administrator.",
    );
  }

  const existing = await User.findOne({
    email: input.email,
    _id: { $ne: user._id },
  }).select("_id");
  if (existing) {
    throw new AppError(
      409,
      "EMAIL_ALREADY_REGISTERED",
      "An account with this email already exists",
    );
  }

  const previousPendingEmail = user.pendingEmail;
  const previousTokenHash = user.emailChangeTokenHash;
  const previousExpiresAt = user.emailChangeExpiresAt;
  const token = randomToken();
  user.pendingEmail = input.email;
  user.emailChangeTokenHash = sha256(token);
  user.emailChangeExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const verificationUrl = new URL("/verify-email-change", env.CLIENT_ORIGIN);
  verificationUrl.searchParams.set("token", token);
  try {
    await sendVerificationEmail(
      input.email,
      verificationUrl.toString(),
      "email-change",
    );
  } catch (error) {
    user.pendingEmail = previousPendingEmail;
    user.emailChangeTokenHash = previousTokenHash;
    user.emailChangeExpiresAt = previousExpiresAt;
    await user.save();
    throw error;
  }

  return User.findById(userId).select("+pendingEmail");
}

export async function verifyEmailChange(input: VerifyEmailChangeInput) {
  const user = await User.findOne({
    emailChangeTokenHash: sha256(input.token),
    emailChangeExpiresAt: { $gt: new Date() },
  }).select(
    "+status +pendingEmail +emailChangeTokenHash +emailChangeExpiresAt",
  );

  if (
    !user ||
    !user.pendingEmail ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(
      400,
      "EMAIL_VERIFICATION_INVALID",
      "This email verification link is invalid or has expired",
    );
  }

  const email = user.pendingEmail;
  user.email = email;
  user.emailVerifiedAt = new Date();
  user.pendingEmail = null;
  user.emailChangeTokenHash = null;
  user.emailChangeExpiresAt = null;
  try {
    await user.save();
  } catch (error) {
    if (duplicateKey(error, "email")) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
      );
    }
    throw error;
  }

  return User.findById(user._id);
}

export async function deleteAccount(userId: string): Promise<void> {
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const memberships = await Membership.find({ userId })
        .setOptions({ skipTenant: true })
        .lean()
        .session(dbSession);

      for (const m of memberships) {
        const org = await Organization.findById(m.tenantId).session(dbSession);
        if (!org) continue;

        if (m.role === "admin") {
          const othersInOrg = await Membership.countDocuments({
            tenantId: m.tenantId,
            userId: { $ne: userId },
          })
            .setOptions({ skipTenant: true })
            .session(dbSession);

          if (othersInOrg > 0 && Number(org.adminCount) <= 1) {
            throw new AppError(
              409,
              "SOLE_ADMIN",
              `You're the only admin of "${org.name}". Make someone else an admin before deleting your account.`,
            );
          }
        }

        await Organization.updateOne(
          { _id: m.tenantId },
          {
            $inc: {
              seatsUsed: -1,
              ...(m.role === "admin" ? { adminCount: -1 } : {}),
            },
          },
          { session: dbSession },
        );
      }

      // The account is kept (marked deleted) so history still shows who did
      // what, but the email is released so the person can sign up again.
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            email: `deleted_${userId}@deleted`,
            status: "deleted",
            deletedAt: new Date(),
          },
          $unset: {
            pendingEmail: "",
            emailChangeTokenHash: "",
            emailChangeExpiresAt: "",
          },
        },
        { session: dbSession },
      );

      await Session.updateMany(
        { userId, revokedAt: null },
        { revokedAt: new Date() },
        { session: dbSession },
      );

      await Task.updateMany(
        { assigneeIds: userId },
        { $pull: { assigneeIds: userId } },
      )
        .setOptions({ skipTenant: true })
        .setOptions({ includeDeleted: true })
        .session(dbSession);

      await Membership.deleteMany({ userId })
        .setOptions({ skipTenant: true })
        .session(dbSession);
    });
  } finally {
    await dbSession.endSession();
  }
}

export async function refresh(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const session = await Session.findOne({ tokenHash });

  if (!session) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
  }

  if (session.revokedAt) {
    await Session.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { revokedAt: new Date() },
    );
    throw new AppError(
      401,
      "TOKEN_REUSE_DETECTED",
      "Refresh token reuse detected",
    );
  }

  if (session.expiresAt < new Date()) {
    throw new AppError(401, "REFRESH_TOKEN_EXPIRED", "Refresh token expired");
  }

  const dbSession = await mongoose.startSession();
  let newRawToken: string;
  let newExpiresAt: Date;

  try {
    await dbSession.withTransaction(async () => {
      const newToken = randomToken();
      const newTokenHash = sha256(newToken);
      newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [newSession] = await Session.create(
        [
          {
            userId: session.userId,
            familyId: session.familyId,
            tokenHash: newTokenHash,
            expiresAt: newExpiresAt,
          },
        ],
        { session: dbSession },
      );

      session.revokedAt = new Date();
      session.replacedBy = newSession._id;
      await session.save({ session: dbSession });

      newRawToken = newToken;
    });

    return {
      userId: session.userId,
      rawToken: newRawToken!,
      expiresAt: newExpiresAt!,
    };
  } finally {
    await dbSession.endSession();
  }
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await Session.updateOne(
    { tokenHash, revokedAt: null },
    { revokedAt: new Date() },
  );
}
