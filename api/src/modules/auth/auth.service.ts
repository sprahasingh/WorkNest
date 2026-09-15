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

function generateSlug(orgName: string): string {
  const base = orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
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

      await Membership.create(
        [
          {
            tenantId: organization._id,
            userId: user._id,
            role: "admin",
          },
        ],
        { session: dbSession },
      );

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
