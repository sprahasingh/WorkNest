import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { RegisterInput } from "./auth.schemas.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { Session } from "../../models/Session.js";
import { randomUUID } from "node:crypto";
import type { LoginInput } from "./auth.schemas.js";
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
            seatLimit: 5,
            seatsUsed: 1,
            projectLimit: 3,
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
    "+passwordHash",
  );

  if (!user) {
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
