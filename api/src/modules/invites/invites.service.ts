import mongoose from "mongoose";
import { Invite } from "../../models/Invite.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId, getTenantContext } from "../../tenancy/context.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { CreateInviteInput } from "./invites.schemas.js";
import bcrypt from "bcryptjs";
import { User } from "../../models/User.js";
import { env } from "../../config/env.js";
import type { InviteSignupInput } from "./invites.schemas.js";

export async function reserveSeat(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const org = await Organization.findOneAndUpdate(
    {
      _id: tenantId,
      $expr: { $lt: ["$seatsUsed", "$seatLimit"] },
    },
    { $inc: { seatsUsed: 1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });

  if (!org) {
    throw new AppError(
      409,
      "SEAT_LIMIT_REACHED",
      "No seats remaining on the current plan",
    );
  }
}

export async function releaseSeat(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  await Organization.findByIdAndUpdate(
    tenantId,
    { $inc: { seatsUsed: -1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });
}

export async function expireStaleInvites(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const result = await Invite.updateMany(
    { tenantId, status: "pending", expiresAt: { $lt: new Date() } },
    { status: "expired" },
    { session: dbSession },
  ).setOptions({ skipTenant: true });

  if (result.modifiedCount > 0) {
    await Organization.findByIdAndUpdate(
      tenantId,
      { $inc: { seatsUsed: -result.modifiedCount } },
      { session: dbSession },
    ).setOptions({ skipTenant: true });
  }
}

export async function createInvite(input: CreateInviteInput) {
  const tenantId = requireTenantId();
  const currentUserId = getTenantContext()!.userId;
  const dbSession = await mongoose.startSession();

  try {
    let rawToken: string;
    let invite;

    await dbSession.withTransaction(async () => {
      await expireStaleInvites(tenantId, dbSession);

      const memberships = (await Membership.find({ tenantId })
        .session(dbSession)
        .populate("userId", "email")) as unknown as Array<{
        userId: { email: string };
      }>;

      const alreadyMember = memberships.some(
        (m) => m.userId.email === input.email,
      );

      if (alreadyMember) {
        throw new AppError(
          409,
          "ALREADY_MEMBER",
          "This person is already a member of the organization",
        );
      }

      await reserveSeat(tenantId, dbSession);

      rawToken = randomToken();
      const tokenHash = sha256(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [created] = await Invite.create(
        [
          {
            tenantId,
            email: input.email,
            role: input.role,
            tokenHash,
            invitedBy: currentUserId,
            expiresAt,
          },
        ],
        { session: dbSession },
      );

      invite = created;
    });

    return { invite: invite!, rawToken: rawToken! };
  } finally {
    await dbSession.endSession();
  }
}

export async function listPendingInvites() {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    let invites;

    await dbSession.withTransaction(async () => {
      await expireStaleInvites(tenantId, dbSession);
      invites = await Invite.find({ status: "pending" }).session(dbSession);
    });

    return invites!;
  } finally {
    await dbSession.endSession();
  }
}

export async function revokeInvite(inviteId: string) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const invite = await Invite.findOneAndUpdate(
        { _id: inviteId, status: "pending" },
        { status: "revoked" },
        { session: dbSession },
      );

      if (!invite) {
        throw new AppError(404, "NOT_FOUND", "Invite not found");
      }

      await releaseSeat(tenantId, dbSession);
    });
  } finally {
    await dbSession.endSession();
  }
}

export async function getInviteByToken(rawToken: string) {
  const tokenHash = sha256(rawToken);

  const invite = await Invite.findOne({ tokenHash })
    .setOptions({ skipTenant: true })
    .populate<{ tenantId: { name: string } }>("tenantId", "name");

  if (!invite) {
    throw new AppError(404, "NOT_FOUND", "Invite not found");
  }

  const isExpired =
    invite.status === "expired" ||
    (invite.status === "pending" && invite.expiresAt < new Date());

  return {
    organizationName: invite.tenantId.name,
    email: invite.email,
    role: invite.role,
    expired: isExpired,
    status: invite.status,
  };
}

export async function acceptInvite(
  rawToken: string,
  userId: string,
  userEmail: string,
) {
  const tokenHash = sha256(rawToken);
  const dbSession = await mongoose.startSession();

  try {
    let membershipResult;

    await dbSession.withTransaction(async () => {
      const invite = await Invite.findOne({ tokenHash })
        .session(dbSession)
        .setOptions({ skipTenant: true });

      if (!invite) {
        throw new AppError(404, "NOT_FOUND", "Invite not found");
      }

      if (invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new AppError(
          410,
          "INVITE_EXPIRED",
          "This invite is no longer valid",
        );
      }

      if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new AppError(
          403,
          "EMAIL_MISMATCH",
          "This invite was sent to a different email address",
        );
      }

      const updated = await Invite.findOneAndUpdate(
        { _id: invite._id, status: "pending" },
        { status: "accepted" },
        { session: dbSession },
      ).setOptions({ skipTenant: true });

      if (!updated) {
        throw new AppError(
          410,
          "INVITE_EXPIRED",
          "This invite is no longer valid",
        );
      }

      const membership = new Membership({
        tenantId: invite.tenantId,
        userId,
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

      membershipResult = membership;
    });

    return membershipResult!;
  } finally {
    await dbSession.endSession();
  }
}

export async function signupViaInvite(
  rawToken: string,
  input: InviteSignupInput,
) {
  const tokenHash = sha256(rawToken);
  const dbSession = await mongoose.startSession();

  try {
    let result: { userId: mongoose.Types.ObjectId } | undefined;

    await dbSession.withTransaction(async () => {
      const invite = await Invite.findOne({ tokenHash })
        .session(dbSession)
        .setOptions({ skipTenant: true });

      if (!invite) {
        throw new AppError(404, "NOT_FOUND", "Invite not found");
      }

      if (invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new AppError(
          410,
          "INVITE_EXPIRED",
          "This invite is no longer valid",
        );
      }

      const existingUser = await User.findOne({ email: invite.email }).session(
        dbSession,
      );

      if (existingUser) {
        throw new AppError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists; please log in and accept the invite instead",
        );
      }

      const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);

      const [user] = await User.create(
        [{ name: input.name, email: invite.email, passwordHash }],
        { session: dbSession },
      );

      const updated = await Invite.findOneAndUpdate(
        { _id: invite._id, status: "pending" },
        { status: "accepted" },
        { session: dbSession },
      ).setOptions({ skipTenant: true });

      if (!updated) {
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

      result = { userId: user._id };
    });

    return result!;
  } finally {
    await dbSession.endSession();
  }
}
