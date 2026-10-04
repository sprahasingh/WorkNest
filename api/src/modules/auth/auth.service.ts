import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { PendingRegistration } from "../../models/PendingRegistration.js";
import { SignupClaim } from "../../models/SignupClaim.js";
import { Invite } from "../../models/Invite.js";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { Task } from "../../models/Task.js";
import { Project } from "../../models/Project.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { AuditLog } from "../../models/AuditLog.js";
import { PLAN_LIMITS } from "../../constants/plans.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { RegisterInput } from "./auth.schemas.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import {
  isEmailDeliveryConfigured,
  sendEmailChangedNotice,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
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
  const signupToken = randomToken();
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const pending = await PendingRegistration.findOneAndUpdate(
    { email: input.email },
    {
      $set: {
        kind: input.accountType === "admin" ? "organization" : "user",
        name: input.name,
        passwordHash,
        orgName: input.orgName ?? null,
        tokenHash,
        signupSecretHash: sha256(signupToken),
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (bypassVerification) {
    const { userId } = await verifyRegistration({
      token,
      password: input.password,
    });
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

  return {
    email: input.email,
    verificationRequired: true as const,
    // Handed only to the browser that signed up, so it can sign itself in once
    // the link has been opened, on this device or another.
    signupToken,
  };
}

const RESEND_COOLDOWN_MS = 60 * 1000;

// Sends the verification email again for a sign-up that is still waiting. It
// answers the same way whether or not there is one, so it can't be used to
// find out who has signed up. A new link replaces the old one.
export async function resendRegistrationVerification(
  email: string,
): Promise<void> {
  const pending = await PendingRegistration.findOne({
    email,
    expiresAt: { $gt: new Date() },
  }).select("+tokenHash");
  if (!pending) return;
  if (
    pending.lastSentAt &&
    Date.now() - pending.lastSentAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return;
  }

  const token = randomToken();
  const previousHash = pending.tokenHash;
  pending.tokenHash = sha256(token);
  pending.lastSentAt = new Date();
  // A fresh hour, so a link that is about to expire can be replaced.
  pending.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pending.save();

  const verificationUrl = new URL("/verify-email", env.CLIENT_ORIGIN);
  verificationUrl.searchParams.set("token", token);
  try {
    await sendVerificationEmail(
      email,
      verificationUrl.toString(),
      "registration",
    );
  } catch (error) {
    // Put the old link back so the person isn't left with none.
    await PendingRegistration.updateOne(
      { _id: pending._id },
      { $set: { tokenHash: previousHash, lastSentAt: null } },
    );
    throw error;
  }
}

// The browser that signed up asks whether its email link has been opened. The
// answer is "waiting", "expired", or a ready-to-use session for that account.
export async function checkRegistrationStatus(signupToken: string) {
  const secretHash = sha256(signupToken);
  const claim = await SignupClaim.findOneAndDelete({
    secretHash,
    expiresAt: { $gt: new Date() },
  });
  if (claim) return { status: "verified" as const, userId: claim.userId };

  const waiting = await PendingRegistration.exists({
    signupSecretHash: secretHash,
    expiresAt: { $gt: new Date() },
  });
  return { status: waiting ? ("waiting" as const) : ("expired" as const) };
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

  const passwordMatches = await bcrypt.compare(
    input.password,
    pending.passwordHash as string,
  );
  if (!passwordMatches) {
    throw new AppError(
      401,
      "REGISTRATION_PASSWORD_MISMATCH",
      "That isn't the password chosen for this sign-up. If you didn't sign up for WorkNest, you can ignore the email.",
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
        .select("+passwordHash +tokenHash +signupSecretHash")
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

      // If the browser that started the sign-up is still waiting, leave a
      // short-lived note so it can sign itself in.
      if (currentPending.signupSecretHash) {
        await SignupClaim.create(
          [
            {
              secretHash: currentPending.signupSecretHash,
              userId: user._id,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
          ],
          { session: dbSession },
        );
      }

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
      } else if (currentPending.kind === "organization") {
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

// Compared against when there's no account, so a wrong email takes as long
// as a wrong password and response times don't reveal who has an account.
let timingDummyHash: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  timingDummyHash ??= bcrypt.hash(randomToken(), env.BCRYPT_COST);
  return timingDummyHash;
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.identifier }).select(
    "+passwordHash +status",
  );

  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    await bcrypt.compare(input.password, await dummyPasswordHash());
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
  // Same answer whether or not the account exists, so this form can't be
  // used to find out who has an account.
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    return;
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

  // Only a password change needs the current password; a new name doesn't.
  if (input.newPassword) {
    const currentPasswordIsValid = await bcrypt.compare(
      input.currentPassword ?? "",
      user.passwordHash as string,
    );
    if (!currentPasswordIsValid) {
      throw new AppError(
        401,
        "CURRENT_PASSWORD_INVALID",
        "Current password is incorrect",
      );
    }
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

  if (env.EMAIL_VERIFICATION_BYPASS_EMAILS.includes(input.email)) {
    user.email = input.email;
    user.emailVerifiedAt = new Date();
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

// Sends the confirmation link for a pending email change again, without asking
// for the password a second time. The new link replaces the old one.
export async function resendEmailChange(userId: string) {
  const user = await User.findById(userId).select(
    "+status +pendingEmail +emailChangeTokenHash +emailChangeExpiresAt",
  );
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  if (!user.pendingEmail) {
    throw new AppError(
      409,
      "NO_PENDING_EMAIL_CHANGE",
      "There is no email change waiting to be confirmed",
    );
  }
  // The link lasts an hour, so it was sent that long before it expires.
  const expiresAt = user.emailChangeExpiresAt as Date | null;
  const sentAt = expiresAt ? expiresAt.getTime() - 60 * 60 * 1000 : 0;
  if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
    throw new AppError(
      429,
      "RESEND_TOO_SOON",
      "A link was sent a moment ago. Please wait a minute before asking for another.",
    );
  }

  const previousTokenHash = user.emailChangeTokenHash;
  const previousExpiresAt = user.emailChangeExpiresAt;
  const token = randomToken();
  user.emailChangeTokenHash = sha256(token);
  user.emailChangeExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const verificationUrl = new URL("/verify-email-change", env.CLIENT_ORIGIN);
  verificationUrl.searchParams.set("token", token);
  try {
    await sendVerificationEmail(
      user.pendingEmail as string,
      verificationUrl.toString(),
      "email-change",
    );
  } catch (error) {
    user.emailChangeTokenHash = previousTokenHash;
    user.emailChangeExpiresAt = previousExpiresAt;
    await user.save();
    throw error;
  }
  return User.findById(userId).select("+pendingEmail");
}

export async function cancelEmailChange(userId: string) {
  const user = await User.findById(userId).select(
    "+status +pendingEmail +emailChangeTokenHash +emailChangeExpiresAt",
  );
  if (
    !user ||
    (user as unknown as Record<string, unknown>).status === "deleted"
  ) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  user.pendingEmail = null;
  user.emailChangeTokenHash = null;
  user.emailChangeExpiresAt = null;
  await user.save();

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
  const previousEmail = user.email;
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

  // Tell the old address, so an unexpected change doesn't go unnoticed.
  try {
    await sendEmailChangedNotice(String(previousEmail), String(email));
  } catch (error) {
    logger.warn({ err: error }, "Could not send the email-changed notice");
  }

  return User.findById(user._id);
}

// Removes a workspace and everything in it.
async function deleteOrganizationData(
  tenantId: mongoose.Types.ObjectId,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const scope = { tenantId };
  const options = { skipTenant: true, includeDeleted: true };
  await Task.deleteMany(scope).setOptions(options).session(dbSession);
  await TaskActivity.deleteMany(scope).setOptions(options).session(dbSession);
  await Project.deleteMany(scope).setOptions(options).session(dbSession);
  await Invite.deleteMany(scope).setOptions(options).session(dbSession);
  await AuditLog.deleteMany(scope).setOptions(options).session(dbSession);
  await Notification.deleteMany(scope).session(dbSession);
  await Membership.deleteMany(scope).setOptions(options).session(dbSession);
  await Organization.deleteOne({ _id: tenantId }).session(dbSession);
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

        const othersInOrg = await Membership.countDocuments({
          tenantId: m.tenantId,
          userId: { $ne: userId },
        })
          .setOptions({ skipTenant: true })
          .session(dbSession);

        // Nobody else could ever reach this workspace again, so it goes too.
        if (othersInOrg === 0) {
          await deleteOrganizationData(m.tenantId, dbSession);
          continue;
        }

        if (m.role === "admin") {
          if (Number(org.adminCount) <= 1) {
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

// A token replaced this recently is still accepted, so two tabs refreshing
// at once don't look like a stolen token and sign the person out.
const REFRESH_GRACE_MS = 30_000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function refresh(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const session = await Session.findOne({ tokenHash });

  if (!session) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
  }

  if (session.expiresAt < new Date()) {
    throw new AppError(401, "REFRESH_TOKEN_EXPIRED", "Refresh token expired");
  }

  const dbSession = await mongoose.startSession();
  let newRawToken: string;
  let newExpiresAt: Date;

  try {
    await dbSession.withTransaction(async () => {
      const now = new Date();
      // Claim the token atomically; only one request can rotate it.
      const claimed = await Session.findOneAndUpdate(
        { _id: session._id, revokedAt: null },
        { revokedAt: now },
        { session: dbSession, returnDocument: "after" },
      );

      if (!claimed) {
        // Already rotated. Fine if it happened a moment ago (another tab);
        // otherwise it's a reused token, so end the whole session family.
        const current = await Session.findById(session._id).session(dbSession);
        const revokedAt = current?.revokedAt?.getTime() ?? 0;
        const familyStillActive = await Session.exists({
          familyId: session.familyId,
          revokedAt: null,
        }).session(dbSession);
        if (
          !current?.replacedBy ||
          now.getTime() - revokedAt > REFRESH_GRACE_MS ||
          !familyStillActive
        ) {
          throw new AppError(
            401,
            "TOKEN_REUSE_DETECTED",
            "Refresh token reuse detected",
          );
        }
      }

      const newToken = randomToken();
      newExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
      const [newSession] = await Session.create(
        [
          {
            userId: session.userId,
            familyId: session.familyId,
            tokenHash: sha256(newToken),
            expiresAt: newExpiresAt,
          },
        ],
        { session: dbSession },
      );

      if (claimed) {
        claimed.replacedBy = newSession._id;
        await claimed.save({ session: dbSession });
      }

      newRawToken = newToken;
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "TOKEN_REUSE_DETECTED") {
      await Session.updateMany(
        { familyId: session.familyId, revokedAt: null },
        { revokedAt: new Date() },
      );
    }
    throw error;
  } finally {
    await dbSession.endSession();
  }

  return {
    userId: session.userId,
    rawToken: newRawToken!,
    expiresAt: newExpiresAt!,
  };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await Session.updateOne(
    { tokenHash, revokedAt: null },
    { revokedAt: new Date() },
  );
}
