import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { expireDuePlans } from "../src/modules/billing/planLifecycle.js";
import { getPlanUsage } from "../src/modules/billing/planLifecycle.js";
import { runWithTenant } from "../src/tenancy/context.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
app.set("trust proxy", 1);

const DAY = 24 * 60 * 60 * 1000;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const usageOf = (orgId: string, userId: string) =>
  runWithTenant({ tenantId: orgId, userId, role: "admin" }, () =>
    getPlanUsage(orgId),
  );

async function makeProject(orgId: string, token: string, key: string) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set(auth(token))
    .send({ name: `Project ${key}`, key });
}

describe("paid plan expiry", () => {
  it("moves an expired plan back to Free and says so", async () => {
    const { orgId, admin } = await setupOrg(app, "expire1.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "pro",
        seatLimit: 30,
        projectLimit: 25,
        planExpiresAt: new Date(Date.now() - 1000),
      },
    );

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.status).toBe(200);
    expect(org.body.organization.plan).toBe("free");
    expect(org.body.organization.projectLimit).toBe(3);
    expect(org.body.organization.planExpiredFrom).toBe("pro");
    expect(org.body.organization.planExpiresAt).toBeNull();
    expect(org.body.usage.overLimit).toBe(false);
  });

  it("expires plans in the background without a request", async () => {
    const { orgId } = await setupOrg(app, "expire3.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        seatLimit: 100,
        projectLimit: 50,
        planExpiresAt: new Date(Date.now() - 1000),
      },
    );
    expect(await expireDuePlans()).toBe(1);
    const org = await Organization.findById(orgId).lean();
    expect(org?.plan).toBe("free");
    expect(org?.planExpiredFrom).toBe("premium");
    expect(await expireDuePlans()).toBe(0);
  });

  it("leaves a plan alone until its date", async () => {
    const { orgId, admin } = await setupOrg(app, "expire2.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "pro",
        seatLimit: 30,
        projectLimit: 25,
        planExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("pro");
    expect(org.body.organization.planExpiredFrom).toBeNull();
  });
});

describe("account paused while over the plan", () => {
  it("restricts during the grace period and pauses once it is over (seats)", async () => {
    const { orgId, admin } = await setupOrg(app, "lock1.test");
    // Seats can't be archived away, so they are what keeps an account paused
    // after the grace period.
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "free",
        seatsUsed: 8,
        planExpiredAt: new Date(Date.now() - DAY),
        planExpiredFrom: "pro",
      },
    );

    // Inside the grace period nothing is paused, but a workspace that is over
    // the Free limits can't add anything new.
    const during = await makeProject(orgId, admin.token, "AAA");
    expect(during.status).toBe(403);
    expect(during.body.error.code).toBe("PLAN_GRACE_RESTRICTED");
    const graceUsage = await usageOf(orgId, admin.id);
    expect(graceUsage.inGrace).toBe(true);
    expect(graceUsage.restricted).toBe(true);
    expect(graceUsage.paused).toBe(false);

    await Organization.updateOne(
      { _id: orgId },
      { planExpiredAt: new Date(Date.now() - 11 * DAY) },
    );
    const blocked = await makeProject(orgId, admin.token, "BBB");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_OVER_LIMIT");

    // Reading still works, so people can see what to remove.
    const list = await request(app)
      .get(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token));
    expect(list.status).toBe(200);

    await Organization.updateOne({ _id: orgId }, { seatsUsed: 3 });
    const ok = await makeProject(orgId, admin.token, "BBB");
    expect(ok.status).toBe(201);
  });
});
