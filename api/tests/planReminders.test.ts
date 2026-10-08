import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Notification } from "../src/models/Notification.js";
import { Organization } from "../src/models/Organization.js";
import { changePlan } from "../src/modules/orgs/orgs.service.js";
import { expireDuePlans } from "../src/modules/billing/planLifecycle.js";
import {
  renewalStage,
  sendPlanRenewalReminders,
} from "../src/modules/billing/planReminders.js";
import { runWithTenant } from "../src/tenancy/context.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

async function paidOrg(domain: string, endsInMs: number) {
  const { orgId, admin } = await setupOrg(app, domain);
  await Organization.updateOne(
    { _id: orgId },
    {
      plan: "pro",
      seatLimit: 30,
      projectLimit: 25,
      planExpiresAt: new Date(Date.now() + endsInMs),
    },
  );
  return { orgId, admin };
}

const notices = (orgId: string) =>
  Notification.find({ tenantId: orgId, eventKey: `plan-renewal:${orgId}` });

describe("renewal stages", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("is 7d within a week, 1d within a day, and nothing otherwise", () => {
    expect(renewalStage(new Date(+now + 10 * DAY), now)).toBeNull();
    expect(renewalStage(new Date(+now + 6 * DAY), now)).toBe("7d");
    expect(renewalStage(new Date(+now + DAY / 2), now)).toBe("1d");
    expect(renewalStage(new Date(+now - 1000), now)).toBeNull();
  });
});

describe("plan renewal reminders", () => {
  it("sends the 7 day notice once, then the 1 day notice replaces it", async () => {
    const { orgId, admin } = await paidOrg("remind1.test", 5 * DAY);

    expect(await sendPlanRenewalReminders()).toBe(1);
    let rows = await notices(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("plan_expiring");
    expect(rows[0]!.stage).toBe("7d");
    expect(String(rows[0]!.userId)).toBe(admin.id);

    // Running the sweep again doesn't send it again.
    expect(await sendPlanRenewalReminders()).toBe(0);
    expect(await notices(orgId)).toHaveLength(1);

    await Organization.updateOne(
      { _id: orgId },
      { planExpiresAt: new Date(Date.now() + DAY / 2) },
    );
    expect(await sendPlanRenewalReminders()).toBe(1);
    rows = await notices(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe("1d");
    expect(rows[0]!.message).toContain("tomorrow");
  });

  it("doesn't bring back a notice that was dismissed", async () => {
    const { orgId } = await paidOrg("remind2.test", 3 * DAY);
    await sendPlanRenewalReminders();
    await Notification.updateMany(
      { tenantId: orgId },
      { dismissedAt: new Date(), readAt: new Date() },
    );
    expect(await sendPlanRenewalReminders()).toBe(0);
    expect((await notices(orgId))[0]!.dismissedAt).not.toBeNull();
  });

  it("stays quiet more than a week out", async () => {
    const { orgId, admin } = await paidOrg("remind3.test", 20 * DAY);
    expect(await sendPlanRenewalReminders()).toBe(0);
    expect(await notices(orgId)).toHaveLength(0);
    expect(admin.id).toBeTruthy();
  });

  it("replaces the expiring notice with an expired one", async () => {
    const { orgId } = await paidOrg("remind4.test", 20 * 60 * 60 * 1000);
    await sendPlanRenewalReminders();
    await Organization.updateOne(
      { _id: orgId },
      { planExpiresAt: new Date(Date.now() - 1000) },
    );
    expect(await expireDuePlans()).toBe(1);
    expect(await sendPlanRenewalReminders()).toBe(1);

    const rows = await notices(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("plan_expired");
    expect(rows[0]!.message).toContain("ended");
    expect(rows[0]!.message).toContain("Pro");
    // It says what happens next.
    expect(rows[0]!.message).toContain("10 days to renew or reduce usage");
    expect(rows[0]!.message).toContain("archived");
    // Not sent twice.
    expect(await sendPlanRenewalReminders()).toBe(0);
  });

  it("replaces the ended notice once the grace period is over", async () => {
    const { orgId } = await paidOrg("remind6.test", 5 * DAY);
    await Organization.updateOne(
      { _id: orgId },
      { planExpiresAt: new Date(Date.now() - DAY) },
    );
    await expireDuePlans();
    await sendPlanRenewalReminders();
    let rows = await notices(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe("expired");

    // 10 days later the grace period is over.
    await Organization.updateOne(
      { _id: orgId },
      { planExpiredAt: new Date(Date.now() - 11 * DAY) },
    );
    expect(await sendPlanRenewalReminders()).toBe(1);
    rows = await notices(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("plan_expired");
    expect(rows[0]!.stage).toBe("archived");
    expect(rows[0]!.message).toContain("grace period");
    expect(rows[0]!.message).toContain("nothing was deleted");
  });

  it("removes the notice when the plan is renewed", async () => {
    const { orgId, admin } = await paidOrg("remind5.test", 2 * DAY);
    await sendPlanRenewalReminders();
    expect(await notices(orgId)).toHaveLength(1);

    await runWithTenant(
      { tenantId: orgId, userId: admin.id, role: "admin" },
      () =>
        changePlan("pro", undefined, {
          expiresAt: new Date(Date.now() + 30 * DAY),
          cycle: "monthly",
          creditStartedAt: new Date(),
          creditValuePaise: 44900,
        }),
    );
    expect(await notices(orgId)).toHaveLength(0);
    expect(await sendPlanRenewalReminders()).toBe(0);
  });
});
