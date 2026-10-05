import { env } from "../../config/env.js";
import {
  GRACE_PERIOD_DAYS,
  PLAN_NAMES,
  graceEndsAt,
  type Plan,
} from "../../constants/plans.js";
import {
  isEmailDeliveryConfigured,
  sendPlanRenewalEmail,
} from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
import { Membership } from "../../models/Membership.js";
import { Notification } from "../../models/Notification.js";
import { Organization } from "../../models/Organization.js";
import { User } from "../../models/User.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// How long after a plan ends the "it ended" notice is still worth sending.
const EXPIRED_NOTICE_DAYS = 30;

// "expired" is the plan having ended (with the grace period running);
// "archived" is the grace period being over.
export type RenewalStage = "7d" | "1d" | "expired" | "archived";

// One renewal notification per admin per organization. Every later step
// replaces the one before it, and renewing removes it.
export function planReminderKey(tenantId: string): string {
  return `plan-renewal:${tenantId}`;
}

// 7 days out and 1 day out; nothing earlier, nothing after the end.
export function renewalStage(expiresAt: Date, now: Date): RenewalStage | null {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left <= DAY_MS) return "1d";
  if (left <= 7 * DAY_MS) return "7d";
  return null;
}

function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

function reminderMessage(
  stage: RenewalStage,
  planName: string,
  endsOn: string,
): string {
  if (stage === "expired") {
    return `Your ${planName} plan ended on ${endsOn}, so the workspace is back on Free. You have ${GRACE_PERIOD_DAYS} days to renew or reduce usage. After that, projects and tasks over the Free limits are archived (nothing is deleted).`;
  }
  if (stage === "archived") {
    return `The ${GRACE_PERIOD_DAYS} day grace period after your ${planName} plan ended is over. Projects and tasks over the Free limits were archived, and nothing was deleted. Renew to restore them.`;
  }
  return stage === "1d"
    ? `Your ${planName} plan ends tomorrow, on ${endsOn}. Renew to keep your limits.`
    : `Your ${planName} plan ends on ${endsOn}. Renew to keep your limits.`;
}

// Replaces whatever renewal notice the person has with this one, unless they
// already have exactly this step for this end date (so a sweep that runs again
// doesn't bring back one they dismissed). True when a new notice was written.
async function writeReminder(input: {
  tenantId: string;
  userId: string;
  stage: RenewalStage;
  date: Date;
  message: string;
}): Promise<boolean> {
  const eventKey = planReminderKey(input.tenantId);
  const filter = {
    tenantId: input.tenantId,
    userId: input.userId,
    eventKey,
  };
  const existing = await Notification.findOne(filter).lean();
  if (
    existing &&
    existing.stage === input.stage &&
    existing.dueDate?.getTime() === input.date.getTime()
  ) {
    return false;
  }
  await Notification.deleteMany(filter);
  try {
    await Notification.create({
      ...filter,
      type:
        input.stage === "expired" || input.stage === "archived"
          ? "plan_expired"
          : "plan_expiring",
      stage: input.stage,
      dueDate: input.date,
      message: input.message,
      actorId: null,
      readAt: null,
      dismissedAt: null,
    });
  } catch (error) {
    // Another server wrote the same notice a moment ago.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
  return true;
}

export async function sendPlanRenewalReminders(
  now = new Date(),
): Promise<number> {
  const expiring = await Organization.find({
    plan: { $ne: "free" },
    planExpiresAt: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY_MS) },
  })
    .select("name plan planExpiresAt timeZone")
    .setOptions({ skipTenant: true })
    .lean();
  const expired = await Organization.find({
    plan: "free",
    planExpiredAt: {
      $gt: new Date(now.getTime() - EXPIRED_NOTICE_DAYS * DAY_MS),
    },
  })
    .select("name plan planExpiredAt planExpiredFrom timeZone")
    .setOptions({ skipTenant: true })
    .lean();

  const jobs = [
    ...expiring.map((org) => ({
      org,
      plan: org.plan as Plan,
      date: org.planExpiresAt!,
      stage: renewalStage(org.planExpiresAt!, now),
    })),
    ...expired.map((org) => ({
      org,
      plan: (org.planExpiredFrom ?? "pro") as Plan,
      date: org.planExpiredAt!,
      stage: (graceEndsAt(org.planExpiredAt!) <= now
        ? "archived"
        : "expired") as RenewalStage | null,
    })),
  ];

  let written = 0;
  for (const { org, plan, date, stage } of jobs) {
    if (!stage) continue;
    try {
      const tenantId = String(org._id);
      const planName = PLAN_NAMES[plan];
      const endsOn = formatDay(date, org.timeZone ?? "UTC");
      const message = reminderMessage(stage, planName, endsOn);
      const admins = await Membership.find({ tenantId, role: "admin" })
        .select("userId")
        .setOptions({ skipTenant: true })
        .lean();
      for (const admin of admins) {
        const userId = String(admin.userId);
        const created = await writeReminder({
          tenantId,
          userId,
          stage,
          date,
          message,
        });
        if (!created) continue;
        written += 1;
        if (!isEmailDeliveryConfigured()) continue;
        const user = await User.findById(userId).select("email").lean();
        if (!user?.email) continue;
        try {
          await sendPlanRenewalEmail(
            user.email,
            org.name,
            planName,
            stage,
            endsOn,
            new URL(`/orgs/${tenantId}/settings`, env.CLIENT_ORIGIN).toString(),
          );
        } catch (error) {
          // The in-app notice is already there; a failed email isn't retried.
          logger.warn({ err: error, tenantId }, "Plan reminder email failed");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Could not write plan renewal reminders");
    }
  }
  return written;
}
