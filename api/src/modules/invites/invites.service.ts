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
import { PendingRegistration } from "../../models/PendingRegistration.js";
import { verifyRegistration } from "../auth/auth.service.js";
import { env } from "../../config/env.js";
import {
  isEmailDeliveryConfigured,
  sendVerificationEmail,
} from "../../lib/email.js";
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

export interface SeatUsage {
  seatsUsed: number;
  memberCount: number;
  pendingInvites: number;
  roleCounts: { admin: number; manager: number; member: number };
}

// The stored seat count is a running total that every invite and membership
// change keeps in step. This recounts it from the source (everyone in the
// organization plus invites still waiting) and repairs it if it has drifted,
// so the dashboard and the seat limit always use the real number. It runs in
// a transaction so its reads are one consistent snapshot and a clash with a
// simultaneous invite is retried rather than saving a wrong count.
export async function reconcileSeats(
  tenantId: string,
  existingSession?: mongoose.ClientSession,
): Promise<SeatUsage> {
  const recount = async (dbSession: mongoose.ClientSession) => {
    const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
    // Invites past their date no longer hold a seat; mark them so every
    // later count agrees.
    await Invite.updateMany(
      { tenantId, status: "pending", expiresAt: { $lt: new Date() } },
      { status: "expired" },
      { session: dbSession },
    ).setOptions({ skipTenant: true });

    const org = await Organization.findById(tenantId)
      .select("seatsUsed")
      .session(dbSession)
      .setOptions({ skipTenant: true })
      .lean();
    const roles = await Membership.aggregate<{ _id: string; count: number }>([
      { $match: { tenantId: tenantObjectId } },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]).session(dbSession);
    const pendingInvites = await Invite.countDocuments({
      tenantId,
      status: "pending",
    })
      .session(dbSession)
      .setOptions({ skipTenant: true });

    const roleCounts = { admin: 0, manager: 0, member: 0 };
    for (const entry of roles) {
      if (entry._id in roleCounts) {
        roleCounts[entry._id as keyof typeof roleCounts] = entry.count;
      }
    }
    const memberCount = roles.reduce((sum, entry) => sum + entry.count, 0);
    const seatsUsed = memberCount + pendingInvites;

    if (org && org.seatsUsed !== seatsUsed) {
      await Organization.updateOne(
        { _id: tenantId },
        { $set: { seatsUsed } },
        { session: dbSession },
      ).setOptions({ skipTenant: true });
    }
    return { seatsUsed, memberCount, pendingInvites, roleCounts };
  };

  if (existingSession) return recount(existingSession);

  const dbSession = await mongoose.startSession();
  try {
    let usage: SeatUsage | undefined;
    await dbSession.withTransaction(async () => {
      usage = await recount(dbSession);
    });
    return usage!;
  } finally {
    await dbSession.endSession();
  }
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
      // Check the limit against the real number of seats in use.
      await reconcileSeats(tenantId, dbSession);

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
    const organization = await Organization.findById(tenantId).select("name");

    return {
      invite: invite!,
      rawToken: rawToken!,
      existingUser,
      organizationName: String(organization?.name ?? "your organization"),
    };
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
  const invite = await Invite.findOne({ tokenHash }).setOptions({
    skipTenant: true,
  });
  if (!invite) {
    throw new AppError(404, "NOT_FOUND", "Invite not found");
  }

  if (invite.status !== "pending" || invite.expiresAt <= new Date()) {
    throw new AppError(410, "INVITE_EXPIRED", "This invite is no longer valid");
  }

  const existingUser = await User.findOne({ email: invite.email }).select(
    "_id",
  );
  if (existingUser) {
    throw new AppError(
      409,
      "EMAIL_ALREADY_REGISTERED",
      "An account with this email already exists; please log in and accept the invite instead",
    );
  }
  if (!isEmailDeliveryConfigured()) {
    throw new AppError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email verification is not configured. Contact your administrator.",
    );
  }

  const registrationToken = randomToken();
  const registrationTokenHash = sha256(registrationToken);
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const pending = await PendingRegistration.findOneAndUpdate(
    { email: invite.email },
    {
      $set: {
        kind: "invite",
        name: input.name,
        passwordHash,
        orgName: null,
        inviteId: invite._id,
        tokenHash: registrationTokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (invite.emailedAt) {
    const { userId } = await verifyRegistration({
      token: registrationToken,
      password: input.password,
    });
    return { email: invite.email, userId };
  }

  const verificationUrl = new URL("/verify-email", env.CLIENT_ORIGIN);
  verificationUrl.searchParams.set("token", registrationToken);
  try {
    await sendVerificationEmail(
      invite.email,
      verificationUrl.toString(),
      "registration",
    );
  } catch (error) {
    await PendingRegistration.deleteOne({
      _id: pending._id,
      tokenHash: registrationTokenHash,
    });
    throw error;
  }

  return { email: invite.email, userId: null };
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
