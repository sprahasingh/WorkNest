import mongoose from "mongoose";
import { Invite } from "../../models/Invite.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId, getTenantContext } from "../../tenancy/context.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import bcrypt from "bcryptjs";
import { User } from "../../models/User.js";
import { env } from "../../config/env.js";
import type {
  CreateInviteInput,
  InviteSignupInput,
} from "./invites.schemas.js";

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

      const pending = await Invite.findOne({
        email: input.email,
        status: "pending",
      }).session(dbSession);

      if (pending && !input.replaceExisting) {
        throw new AppError(
          409,
          "INVITE_ALREADY_PENDING",
          "This person already has a pending invite",
          [{ invitedAt: pending.createdAt, expiresAt: pending.expiresAt }],
        );
      }

      // A fresh link replaces the old one, which stops working.
      if (pending) {
        pending.status = "revoked";
        await pending.save({ session: dbSession });
        await releaseSeat(tenantId, dbSession);
        await recordAudit(
          {
            action: "invite.revoked",
            entityType: "Invite",
            entityId: pending._id,
            metadata: { email: pending.email, replaced: true },
          },
          dbSession,
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

      await recordAudit(
        {
          action: "invite.created",
          entityType: "Invite",
          entityId: created._id,
          metadata: { email: input.email, role: input.role },
        },
        dbSession,
      );

      invite = created;
    });

    // Someone who already has an account also sees the invite in the app.
    const existingUser = Boolean(await User.exists({ email: input.email }));

    return { invite: invite!, rawToken: rawToken!, existingUser };
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

    const pending = invites! as Array<InstanceType<typeof Invite>>;
    const registered = await User.find({
      email: { $in: pending.map((invite) => invite.email) },
    }).select("email");
    const registeredEmails = new Set(registered.map((user) => user.email));

    return pending.map((invite) => ({
      ...invite.toJSON(),
      existingUser: registeredEmails.has(invite.email),
    }));
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

      await recordAudit(
        {
          action: "invite.revoked",
          entityType: "Invite",
          entityId: inviteId,
          metadata: { email: invite.email },
        },
        dbSession,
      );
    });
  } finally {
    await dbSession.endSession();
  }
}

// Finds a pending invite addressed to this user and makes them a member.
// Accepting when already a member (e.g. two invites) just frees the seat.
async function acceptPendingInvite(
  filter: { tokenHash: string } | { _id: string },
  userId: string,
  userEmail: string,
) {
  const dbSession = await mongoose.startSession();

  try {
    let membershipResult;

    await dbSession.withTransaction(async () => {
      const invite = await Invite.findOne(filter)
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

      const existing = await Membership.findOne({
        tenantId: invite.tenantId,
        userId,
      })
        .session(dbSession)
        .setOptions({ skipTenant: true });

      if (existing) {
        await releaseSeat(invite.tenantId.toString(), dbSession);
        membershipResult = existing;
        return;
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

      await recordAudit(
        {
          action: "invite.accepted",
          entityType: "Invite",
          entityId: invite._id,
          metadata: { email: invite.email, role: invite.role },
          tenantId: invite.tenantId,
          actorId: userId,
        },
        dbSession,
      );

      membershipResult = membership;
    });

    return membershipResult!;
  } finally {
    await dbSession.endSession();
  }
}

export async function acceptInvite(
  rawToken: string,
  userId: string,
  userEmail: string,
) {
  return acceptPendingInvite(
    { tokenHash: sha256(rawToken) },
    userId,
    userEmail,
  );
}

export async function declineInviteByToken(
  rawToken: string,
  userId: string,
  userEmail: string,
) {
  return declineInvite({ tokenHash: sha256(rawToken) }, userId, userEmail);
}

export async function acceptInviteById(
  inviteId: string,
  userId: string,
  userEmail: string,
) {
  return acceptPendingInvite({ _id: inviteId }, userId, userEmail);
}

export async function declineInvite(
  filter: { tokenHash: string } | { _id: string },
  userId: string,
  userEmail: string,
) {
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const invite = await Invite.findOneAndUpdate(
        { ...filter, email: userEmail.toLowerCase(), status: "pending" },
        { status: "declined" },
        { session: dbSession },
      ).setOptions({ skipTenant: true });

      if (!invite) {
        throw new AppError(404, "NOT_FOUND", "Invite not found");
      }

      await releaseSeat(invite.tenantId.toString(), dbSession);

      await recordAudit(
        {
          action: "invite.declined",
          entityType: "Invite",
          entityId: invite._id,
          metadata: { email: invite.email, role: invite.role },
          tenantId: invite.tenantId,
          actorId: userId,
        },
        dbSession,
      );
    });
  } finally {
    await dbSession.endSession();
  }
}

// Pending invites addressed to this user's email, across every org.
export async function listMyInvites(userEmail: string) {
  const invites = await Invite.find({
    email: userEmail.toLowerCase(),
    status: "pending",
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .setOptions({ skipTenant: true })
    .populate<{
      tenantId: { _id: mongoose.Types.ObjectId; name: string } | null;
    }>("tenantId", "name")
    .populate<{ invitedBy: { name: string } | null }>("invitedBy", "name");

  return invites
    .filter((invite) => invite.tenantId !== null)
    .map((invite) => ({
      _id: invite._id.toString(),
      organization: {
        id: invite.tenantId!._id.toString(),
        name: invite.tenantId!.name,
      },
      role: invite.role,
      invitedBy: invite.invitedBy ? { name: invite.invitedBy.name } : null,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    }));
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

      await recordAudit(
        {
          action: "invite.accepted",
          entityType: "Invite",
          entityId: invite._id,
          metadata: { email: invite.email, role: invite.role, viaSignup: true },
          tenantId: invite.tenantId,
          actorId: user._id,
        },
        dbSession,
      );

      result = { userId: user._id };
    });

    return result!;
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

  const accountExists = Boolean(await User.exists({ email: invite.email }));

  return {
    organizationName: invite.tenantId.name,
    email: invite.email,
    role: invite.role,
    expired: isExpired,
    status: isExpired ? "expired" : invite.status,
    // Lets the invite page offer "log in to accept" instead of sign-up.
    accountExists,
  };
}
