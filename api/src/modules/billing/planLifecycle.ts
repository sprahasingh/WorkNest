import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import {
  PLAN_LIMITS,
  addBillingPeriod,
  graceEndsAt,
  type BillingCycle,
  type Plan,
} from "../../constants/plans.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { Organization } from "../../models/Organization.js";
import { Payment } from "../../models/Payment.js";
import { requireTenantId } from "../../tenancy/context.js";
import {
  countProjectsOverTaskLimit,
  findProjectsOverTaskLimit,
} from "./taskUsage.js";
import { enforceGraceIfDue } from "./gracePeriod.service.js";
import { runWithTenant } from "../../tenancy/context.js";

// An organization whose paid plan has run out goes back to Free. This runs on
// the first request after the date passes, so it works even when the server
// was asleep at the moment of expiry. The workspace gets its grace period
// before excess projects and tasks are archived.
export async function expirePlanIfDue(
  tenantId: string,
  now = new Date(),
): Promise<boolean> {
  const free = PLAN_LIMITS.free;
  if (await activateScheduledPaidPlan(tenantId, now)) return true;
  const due = await Organization.findOne({
    _id: tenantId,
    plan: { $ne: "free" },
    planExpiresAt: { $lte: now },
  })
    .setOptions({ skipTenant: true })
    .lean();
  if (!due) return false;
  let preservePaidSchedule = false;
  if (
    due.scheduledPlan &&
    due.scheduledPlan !== "free" &&
    due.scheduledPaymentId
  ) {
    const payment = await Payment.findOne({
      _id: due.scheduledPaymentId,
      tenantId,
      plan: due.scheduledPlan,
      billingCycle: due.scheduledBillingCycle,
      status: "paid",
      appliedAt: { $ne: null },
      refundStatus: "none",
    })
      .setOptions({ skipTenant: true })
      .lean();
    preservePaidSchedule = Boolean(payment && due.scheduledStartsAt);
  }
  const org = await Organization.findOneAndUpdate(
    { _id: tenantId, plan: { $ne: "free" }, planExpiresAt: { $lte: now } },
    [
      {
        $set: {
          planExpiredFrom: "$plan",
          planExpiredAt: now,
          plan: "free",
          planExpiresAt: null,
          billingCycle: null,
          planCreditStartedAt: null,
          planCreditValuePaise: null,
          ...(preservePaidSchedule
            ? {}
            : {
                scheduledPlan: null,
                scheduledBillingCycle: null,
                scheduledStartsAt: null,
                scheduledExpiresAt: null,
                scheduledPaymentId: null,
              }),
          seatLimit: free.seatLimit,
          projectLimit: free.projectLimit,
          // A new expiry starts a new grace period.
          graceEnforcedAt: null,
          graceEnforcingAt: null,
          graceArchived: null,
        },
      },
    ],
    // An array is an update pipeline, which Mongoose only accepts when told so.
    { returnDocument: "before", updatePipeline: true },
  ).setOptions({ skipTenant: true });
  if (org) {
    logger.info({ tenantId, from: org.plan }, "Paid plan expired");
  }
  return org !== null;
}

async function activateScheduledPaidPlan(
  tenantId: string,
  now: Date,
): Promise<boolean> {
  const scheduled = await Organization.findOne({
    _id: tenantId,
    scheduledPlan: { $in: ["pro", "premium"] },
    scheduledStartsAt: { $lte: now },
  })
    .select(
      "plan planExpiresAt scheduledPlan scheduledBillingCycle scheduledStartsAt scheduledPaymentId",
    )
    .setOptions({ skipTenant: true })
    .lean();
  if (!scheduled) return false;
  if (
    scheduled.plan !== "free" &&
    (!scheduled.planExpiresAt || scheduled.planExpiresAt > now)
  ) {
    return false;
  }
  const payment = await Payment.findOne({
    _id: scheduled.scheduledPaymentId,
    tenantId,
    plan: scheduled.scheduledPlan,
    billingCycle: scheduled.scheduledBillingCycle,
    status: "paid",
    appliedAt: { $ne: null },
    refundStatus: "none",
  })
    .setOptions({ skipTenant: true })
    .lean();
  if (!payment) return false;

  const session = await Organization.startSession();
  let activated = false;
  try {
    await session.withTransaction(async () => {
      const current = await Organization.findOne({
        _id: tenantId,
        scheduledPlan: scheduled.scheduledPlan,
        scheduledPaymentId: scheduled.scheduledPaymentId,
        scheduledStartsAt: { $lte: now },
        $or: [
          { plan: "free" },
          { plan: { $ne: "free" }, planExpiresAt: { $lte: now } },
        ],
      })
        .select("plan seatsUsed projectCount")
        .session(session)
        .setOptions({ skipTenant: true })
        .lean();
      if (!current) return;
      const limits = PLAN_LIMITS[scheduled.scheduledPlan as Plan];
      const taskOverages = await countProjectsOverTaskLimit(
        limits.activeTaskLimit,
        session,
      );
      if (
        current.seatsUsed > limits.seatLimit ||
        current.projectCount > limits.projectLimit ||
        taskOverages > 0
      ) {
        return;
      }
      const cycle = (scheduled.scheduledBillingCycle ??
        "monthly") as BillingCycle;
      const activatedAt =
        now > scheduled.scheduledStartsAt! ? now : scheduled.scheduledStartsAt!;
      const activatedExpiresAt = addBillingPeriod(activatedAt, cycle);
      const result = await Organization.findOneAndUpdate(
        {
          _id: tenantId,
          plan: current.plan,
          scheduledPlan: scheduled.scheduledPlan,
          scheduledPaymentId: scheduled.scheduledPaymentId,
          scheduledStartsAt: { $lte: now },
          $expr: {
            $and: [
              { $lte: ["$seatsUsed", limits.seatLimit] },
              { $lte: ["$projectCount", limits.projectLimit] },
            ],
          },
        },
        {
          plan: scheduled.scheduledPlan,
          billingCycle: cycle,
          planExpiresAt: activatedExpiresAt,
          planCreditStartedAt: activatedAt,
          planCreditValuePaise: payment.amount,
          seatLimit: limits.seatLimit,
          projectLimit: limits.projectLimit,
          planExpiredAt: null,
          planExpiredFrom: null,
          graceEnforcedAt: null,
          graceEnforcingAt: null,
          graceArchived: null,
          scheduledPlan: null,
          scheduledBillingCycle: null,
          scheduledStartsAt: null,
          scheduledExpiresAt: null,
          scheduledPaymentId: null,
        },
        { returnDocument: "after", session },
      ).setOptions({ skipTenant: true });
      if (!result) return;
      const paymentUpdate = await Payment.updateOne(
        { _id: payment._id, status: "paid", refundStatus: "none" },
        {
          quotedCreditStartedAt: activatedAt,
          quotedExpiresAt: activatedExpiresAt,
          quotedCreditValuePaise: payment.amount,
        },
        { session },
      ).setOptions({ skipTenant: true });
      if (paymentUpdate.matchedCount !== 1) {
        throw new Error(
          "Scheduled downgrade payment changed during activation",
        );
      }
      activated = true;
    });
  } finally {
    await session.endSession();
  }
  if (activated) {
    logger.info(
      { tenantId, to: scheduled.scheduledPlan },
      "Scheduled paid plan activated",
    );
  }
  return activated;
}

// Moves every organization whose paid plan has ended back to Free, so a plan
// doesn't stay paid just because nobody has opened the app since.
export async function expireDuePlans(now = new Date()): Promise<number> {
  const due = await Organization.find({
    $or: [
      { plan: { $ne: "free" }, planExpiresAt: { $lte: now } },
      {
        plan: "free",
        scheduledPlan: { $in: ["pro", "premium"] },
        scheduledStartsAt: { $lte: now },
      },
    ],
  })
    .select("_id")
    .setOptions({ skipTenant: true })
    .lean();
  let expired = 0;
  for (const org of due) {
    const tenantId = String(org._id);
    const ran = await runWithTenant(
      { tenantId, userId: "billing-lifecycle" },
      () => expirePlanIfDue(tenantId, now),
    );
    if (ran) expired += 1;
  }
  return expired;
}

export interface PlanUsage {
  seatsUsed: number;
  seatLimit: number;
  projectCount: number;
  projectLimit: number;
  projectsOverTaskLimit: number;
  taskLimitOverages: {
    projectId: string;
    projectName: string;
    activeCount: number;
    limit: number;
  }[];
  activeTaskLimit: number | null;
  // True when the organization uses more than its plan allows.
  overLimit: boolean;
  // After a paid plan ends there is a grace period, with nothing blocked, to
  // renew or cut usage. graceEndsAt is when the extras get archived.
  inGrace: boolean;
  graceEndsAt: string | null;
  // The grace period is over and the extra projects and tasks have been
  // archived (or there was nothing to archive).
  graceEnforced: boolean;
  // Over on projects or tasks, as opposed to seats, which can't be archived.
  workOverLimit: boolean;
  // Over the plan during the grace period, or while the archiving that ends
  // it is still due: nothing new can be added, but everything that brings
  // usage down or keeps work going still works.
  restricted: boolean;
  // Over the plan with no grace left (seats): changes are refused.
  paused: boolean;
}

export interface PlanImpact {
  plan: Plan;
  capturedAt: string;
  seats: { used: number; limit: number; exceeded: boolean };
  projects: { active: number; limit: number; exceeded: boolean };
  tasks: {
    limit: number | null;
    exceededProjectCount: number;
    overages: {
      projectId: string;
      projectName: string;
      activeCount: number;
      limit: number;
    }[];
  };
  withinLimits: boolean;
  fingerprint: string;
}

// Uses the same organization counters and active-task definition as plan
// enforcement and immediate paid downgrades.
export async function getPlanImpact(
  tenantId: string,
  targetPlan: Plan,
): Promise<PlanImpact> {
  const org = await Organization.findById(tenantId)
    .select("seatsUsed projectCount")
    .setOptions({ skipTenant: true })
    .lean();
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");
  const limits = PLAN_LIMITS[targetPlan];
  const overages = (
    await findProjectsOverTaskLimit(limits.activeTaskLimit)
  ).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const seatsExceeded = org.seatsUsed > limits.seatLimit;
  const projectsExceeded = org.projectCount > limits.projectLimit;
  const withinLimits =
    !seatsExceeded && !projectsExceeded && overages.length === 0;
  const snapshot = {
    plan: targetPlan,
    seats: {
      used: org.seatsUsed,
      limit: limits.seatLimit,
      exceeded: seatsExceeded,
    },
    projects: {
      active: org.projectCount,
      limit: limits.projectLimit,
      exceeded: projectsExceeded,
    },
    tasks: {
      limit: limits.activeTaskLimit,
      exceededProjectCount: overages.length,
      overages,
    },
    withinLimits,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  return { ...snapshot, capturedAt: new Date().toISOString(), fingerprint };
}

export async function getPlanUsage(tenantId: string): Promise<PlanUsage> {
  const org = await Organization.findById(tenantId)
    .select(
      "plan seatsUsed seatLimit projectCount projectLimit planExpiredAt graceEnforcedAt",
    )
    .setOptions({ skipTenant: true })
    .lean();
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const activeTaskLimit =
    PLAN_LIMITS[(org.plan ?? "free") as Plan].activeTaskLimit;
  const taskLimitOverages = await findProjectsOverTaskLimit(activeTaskLimit);
  const projectsOverTaskLimit = taskLimitOverages.length;

  const workOverLimit =
    org.projectCount > org.projectLimit || projectsOverTaskLimit > 0;
  const overLimit = workOverLimit || org.seatsUsed > org.seatLimit;
  const graceEnd =
    org.plan === "free" && org.planExpiredAt
      ? graceEndsAt(org.planExpiredAt)
      : null;
  const graceOver = graceEnd !== null && graceEnd <= new Date();
  const inGrace = graceEnd !== null && !graceOver;
  const graceEnforced = graceOver && Boolean(org.graceEnforcedAt);
  const archivalDue = graceOver && !graceEnforced;

  return {
    seatsUsed: org.seatsUsed,
    seatLimit: org.seatLimit,
    projectCount: org.projectCount,
    projectLimit: org.projectLimit,
    projectsOverTaskLimit,
    taskLimitOverages,
    activeTaskLimit,
    overLimit,
    inGrace,
    graceEndsAt: inGrace ? graceEnd!.toISOString() : null,
    graceEnforced,
    workOverLimit,
    restricted: overLimit && (inGrace || archivalDue),
    paused: overLimit && !inGrace && !archivalDue,
  };
}

// While an organization is over its plan, people can still look around and
// take work away (delete, archive) or pay. Everything else that changes data
// is refused.
function allowedWhileOverLimit(req: Request): boolean {
  if (req.method === "DELETE") return true;
  const path = req.path.replace(/\/+$/, "");
  return (
    path.endsWith("/archive") ||
    path === "/plan" ||
    path === "/billing" ||
    path.startsWith("/billing/")
  );
}

// Things that add to what a workspace uses: new projects and tasks, invites,
// and bringing archived or binned work back.
function growsUsage(req: Request): boolean {
  const path = req.path.replace(/\/+$/, "");
  if (req.method === "POST") {
    return (
      path === "/projects" ||
      /^\/projects\/[^/]+\/tasks$/.test(path) ||
      path === "/invites" ||
      path.endsWith("/restore") ||
      path.endsWith("/unarchive")
    );
  }
  return req.method === "PATCH" && path.endsWith("/unarchive");
}

// The grace period, then the archiving that ends it. Safe to call on every
// request: it does nothing unless an organization is due.
export async function enforceGraceFully(tenantId: string): Promise<boolean> {
  let ran = await enforceGraceIfDue(tenantId);
  // Archiving already happened but the workspace is over on projects or tasks
  // again (an earlier run failed halfway, or limits changed): finish the job.
  const usage = await getPlanUsage(tenantId);
  if (usage.graceEnforced && usage.workOverLimit) {
    ran = (await enforceGraceIfDue(tenantId, { again: true })) || ran;
  }
  return ran;
}

function overageReasons(usage: PlanUsage): string[] {
  const reasons: string[] = [];
  if (usage.projectCount > usage.projectLimit) {
    reasons.push(
      `Project limit: ${usage.projectCount} active projects; Free allows ${usage.projectLimit}`,
    );
  }
  if (usage.projectsOverTaskLimit > 0 && usage.activeTaskLimit !== null) {
    reasons.push(
      `Task limit: ${usage.projectsOverTaskLimit} projects exceed ${usage.activeTaskLimit} open tasks per project`,
    );
  }
  if (usage.seatsUsed > usage.seatLimit) {
    reasons.push(
      `Seat limit: ${usage.seatsUsed} members; Free allows ${usage.seatLimit}`,
    );
  }
  return reasons;
}

export async function enforcePlanState(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = requireTenantId();
  await expirePlanIfDue(tenantId);
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS" ||
    allowedWhileOverLimit(req)
  ) {
    // Reading is never blocked, but it still moves due or incomplete cleanup
    // along, just like a mutation request.
    await enforceGraceFully(tenantId);
    next();
    return;
  }
  await enforceGraceFully(tenantId);
  const usage = await getPlanUsage(tenantId);
  const reasons = overageReasons(usage);
  if (usage.paused) {
    throw new AppError(
      403,
      "PLAN_OVER_LIMIT",
      `${reasons.join(". ")}. Archive excess work, remove extra members, or renew your plan.`,
      [usage],
    );
  }
  if (usage.restricted && growsUsage(req)) {
    throw new AppError(
      403,
      "PLAN_GRACE_RESTRICTED",
      `New resources are blocked during grace because the workspace exceeds its Free ${reasons.map((reason) => reason.split(":")[0]!.toLowerCase()).join(" and ")}.`,
      [usage],
    );
  }
  next();
}
