import mongoose from "mongoose";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import type { Role } from "../../constants/roles.js";

async function guardLastAdmin(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const org = await Organization.findOneAndUpdate(
    { _id: tenantId, adminCount: { $gt: 1 } },
    { $inc: { adminCount: -1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });

  if (!org) {
    throw new AppError(
      409,
      "LAST_ADMIN",
      "Organization must have at least one admin",
    );
  }
}

export async function changeMemberRole(memberId: string, newRole: Role) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    let result;

    await dbSession.withTransaction(async () => {
      const membership = await Membership.findById(memberId).session(dbSession);

      if (!membership) {
        throw new AppError(404, "NOT_FOUND", "Member not found");
      }

      const previousRole = membership.role;
      const wasAdmin = membership.role === "admin";
      const willBeAdmin = newRole === "admin";

      if (wasAdmin && !willBeAdmin) {
        await guardLastAdmin(tenantId, dbSession);
      } else if (!wasAdmin && willBeAdmin) {
        await Organization.findByIdAndUpdate(
          tenantId,
          { $inc: { adminCount: 1 } },
          { session: dbSession },
        ).setOptions({ skipTenant: true });
      }

      membership.role = newRole;
      await membership.save({ session: dbSession });

      await recordAudit(
        {
          action: "member.role_changed",
          entityType: "Membership",
          entityId: membership._id,
          metadata: { role: { from: previousRole, to: newRole } },
        },
        dbSession,
      );

      result = membership;
    });

    return result!;
  } finally {
    await dbSession.endSession();
  }
}

export async function removeMember(memberId: string) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const membership = await Membership.findById(memberId).session(dbSession);

      if (!membership) {
        throw new AppError(404, "NOT_FOUND", "Member not found");
      }

      if (membership.role === "admin") {
        await guardLastAdmin(tenantId, dbSession);
      }

      await Membership.deleteOne({ _id: memberId }).session(dbSession);

      await Organization.findByIdAndUpdate(
        tenantId,
        { $inc: { seatsUsed: -1 } },
        { session: dbSession },
      ).setOptions({ skipTenant: true });

      await recordAudit(
        {
          action: "member.removed",
          entityType: "Membership",
          entityId: memberId,
          metadata: { role: membership.role, userId: membership.userId },
        },
        dbSession,
      );
    });
  } finally {
    await dbSession.endSession();
  }
}
