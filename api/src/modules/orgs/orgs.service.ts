import mongoose from "mongoose";
import { Organization } from "../../models/Organization.js";
import { Membership } from "../../models/Membership.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import type { Plan } from "../../constants/plans.js";

const PLAN_LIMITS: Record<Plan, { seatLimit: number; projectLimit: number }> = {
  free: { seatLimit: 5, projectLimit: 3 },
  pro: { seatLimit: 25, projectLimit: 50 },
};

export function generateSlug(orgName: string): string {
  const base = orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function createOrg(userId: string, name: string) {
  const dbSession = await mongoose.startSession();

  try {
    let organizationId: mongoose.Types.ObjectId;

    await dbSession.withTransaction(async () => {
      const [organization] = await Organization.create(
        [
          {
            name,
            slug: generateSlug(name),
            plan: "free",
            seatLimit: 5,
            seatsUsed: 1,
            projectLimit: 3,
            projectCount: 0,
            adminCount: 1,
            createdBy: userId,
          },
        ],
        { session: dbSession },
      );

      const membershipDoc = new Membership({
        tenantId: organization._id,
        userId,
        role: "admin",
      });
      membershipDoc.$locals.skipTenant = true;
      await membershipDoc.save({ session: dbSession });

      organizationId = organization._id;
    });

    return await Organization.findById(organizationId!).setOptions({
      skipTenant: true,
    });
  } finally {
    await dbSession.endSession();
  }
}

export async function changePlan(newPlan: Plan) {
  const tenantId = requireTenantId();
  const limits = PLAN_LIMITS[newPlan];
  const dbSession = await mongoose.startSession();

  try {
    let org;

    await dbSession.withTransaction(async () => {
      const previous = await Organization.findById(tenantId)
        .session(dbSession)
        .setOptions({ skipTenant: true });

      const updated = await Organization.findOneAndUpdate(
        {
          _id: tenantId,
          $expr: {
            $and: [
              { $lte: ["$seatsUsed", limits.seatLimit] },
              { $lte: ["$projectCount", limits.projectLimit] },
            ],
          },
        },
        {
          plan: newPlan,
          seatLimit: limits.seatLimit,
          projectLimit: limits.projectLimit,
        },
        { returnDocument: "after", session: dbSession },
      ).setOptions({ skipTenant: true });

      if (!updated) {
        throw new AppError(
          409,
          "PLAN_DOWNGRADE_BLOCKED",
          "Current usage exceeds the limits of the target plan",
          [
            {
              seatsUsed: previous?.seatsUsed,
              projectCount: previous?.projectCount,
              targetSeatLimit: limits.seatLimit,
              targetProjectLimit: limits.projectLimit,
            },
          ],
        );
      }

      await recordAudit(
        {
          action: "plan.changed",
          entityType: "Organization",
          entityId: tenantId,
          metadata: { plan: { from: previous?.plan, to: newPlan } },
        },
        dbSession,
      );

      org = updated;
    });

    return org!;
  } finally {
    await dbSession.endSession();
  }
}

export async function reserveProjectSlot(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const org = await Organization.findOneAndUpdate(
    {
      _id: tenantId,
      $expr: { $lt: ["$projectCount", "$projectLimit"] },
    },
    { $inc: { projectCount: 1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });

  if (!org) {
    throw new AppError(
      409,
      "PROJECT_LIMIT_REACHED",
      "No project slots remaining on the current plan",
    );
  }
}

export async function releaseProjectSlot(
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  await Organization.findByIdAndUpdate(
    tenantId,
    { $inc: { projectCount: -1 } },
    { session: dbSession },
  ).setOptions({ skipTenant: true });
}
