import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { Task } from "../../models/Task.js";
import { PLAN_LIMITS } from "../../constants/plans.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { RegisterInput } from "./auth.schemas.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { Session } from "../../models/Session.js";
import { randomUUID } from "node:crypto";
import type { LoginInput } from "./auth.schemas.js";
import type { UpdatePersonalInformationInput } from "./auth.schemas.js";
import { generateSlug } from "../orgs/orgs.service.js";

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

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const dbSession = await mongoose.startSession();

  try {
    let userId: mongoose.Types.ObjectId;
    let organizationId: mongoose.Types.ObjectId;

    await dbSession.withTransaction(async () => {
      const [user] = await User.create(
        [{ name: input.name, email: input.email, passwordHash }],
        { session: dbSession },
      );

      const [organization] = await Organization.create(
        [
          {
            name: input.orgName,
            slug: generateSlug(input.orgName),
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

      userId = user._id;
      organizationId = organization._id;
    });

    return { userId: userId!, organizationId: organizationId! };
  } finally {
    await dbSession.endSession();
  }
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email }).select(
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
  user.email = input.email;
  if (input.newPassword) {
    user.passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_COST);
  }

  try {
    await user.save();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
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

  return User.findById(userId);
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
          email: `deleted_${userId}@deleted`,
          status: "deleted",
          deletedAt: new Date(),
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
