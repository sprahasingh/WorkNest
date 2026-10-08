import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { syncPlanLimits } from "../src/db/migrations.js";
import { registerAndVerify } from "./emailDeliveryMock.js";
import { quotePlan } from "../src/constants/plans.js";

const app = createApp();

async function registerOrg(email: string, orgName: string) {
  const res = await registerAndVerify(app, {
    name: "Admin User",
    email,
    password: "Harbor-lamp-91",
    orgName,
  });
  const accessToken = res.body.accessToken as string;
  const me = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);
  return {
    accessToken,
    orgId: me.body.memberships[0].tenantId.id as string,
    userId: me.body.user.id as string,
  };
}

async function createProject(orgId: string, token: string, key: string) {
  const res = await request(app)
    .post(`/api/orgs/${orgId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Project ${key}`, key });
  return res.body.project._id as string;
}

async function createTask(
  orgId: string,
  projectId: string,
  token: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/orgs/${orgId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("plans", () => {
  it("applies each plan's limits and blocks downgrades that active tasks would break", async () => {
    const admin = await registerOrg("plans-admin@example.com", "Plans Org");
    const base = `/api/orgs/${admin.orgId}`;
    const projectId = await createProject(
      admin.orgId,
      admin.accessToken,
      "PLN",
    );

    const toPremium = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "premium" });
    expect(toPremium.status).toBe(200);
    expect(toPremium.body.organization).toMatchObject({
      plan: "premium",
      seatLimit: 100,
      projectLimit: 50,
    });

    for (let i = 0; i < 11; i++) {
      const created = await createTask(
        admin.orgId,
        projectId,
        admin.accessToken,
        { title: `Busy ${i}` },
      );
      expect(created.status).toBe(201);
    }
    const premiumStats = await request(app)
      .get(`${base}/projects/${projectId}/tasks/stats`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(premiumStats.body).toMatchObject({
      plan: "premium",
      activeLimit: null,
      activeCount: 11,
    });

    const toFree = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "free" });
    expect(toFree.status).toBe(409);
    expect(toFree.body.error.code).toBe("PLAN_DOWNGRADE_BLOCKED");
    expect(toFree.body.error.details[0]).toMatchObject({
      projectsOverTaskLimit: 1,
      targetActiveTaskLimit: 10,
    });

    const toPro = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "pro" });
    expect(toPro.status).toBe(200);
    expect(toPro.body.organization).toMatchObject({
      plan: "pro",
      seatLimit: 30,
      projectLimit: 25,
    });

    const unknownPlan = await request(app)
      .post(`${base}/plan`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ plan: "enterprise" });
    expect(unknownPlan.status).toBe(400);
  });

  it("brings organizations with outdated limits up to date on startup", async () => {
    const admin = await registerOrg("plans-sync@example.com", "Sync Org");
    await Organization.findByIdAndUpdate(admin.orgId, {
      plan: "pro",
      seatLimit: 25,
      projectLimit: 50,
    });

    await syncPlanLimits();

    const org = await Organization.findById(admin.orgId);
    expect(org!.seatLimit).toBe(30);
    expect(org!.projectLimit).toBe(25);
  });
});

describe("plan quotes", () => {
  it("quotes lower paid plans as prepaid coverage starting at current expiry", () => {
    const now = new Date("2026-10-08T00:00:00.000Z");
    const currentExpiry = new Date("2026-12-08T00:00:00.000Z");
    const quote = quotePlan(
      {
        plan: "premium",
        planExpiresAt: currentExpiry,
        billingCycle: "monthly",
      },
      "pro",
      "yearly",
      now,
    );
    expect(quote).toMatchObject({ amount: 449900, scheduled: true });
    expect(quote?.creditStartedAt).toEqual(currentExpiry);
    expect(quote?.expiresAt).toEqual(new Date("2027-12-08T00:00:00.000Z"));
  });

  it("clamps calendar periods at month ends and through leap years", () => {
    expect(
      quotePlan(
        { plan: "free" },
        "pro",
        "monthly",
        new Date("2025-01-31T12:00:00.000Z"),
      )?.expiresAt,
    ).toEqual(new Date("2025-02-28T12:00:00.000Z"));
    expect(
      quotePlan(
        { plan: "free" },
        "pro",
        "monthly",
        new Date("2024-01-31T12:00:00.000Z"),
      )?.expiresAt,
    ).toEqual(new Date("2024-02-29T12:00:00.000Z"));
    expect(
      quotePlan(
        { plan: "free" },
        "pro",
        "yearly",
        new Date("2024-02-29T12:00:00.000Z"),
      )?.expiresAt,
    ).toEqual(new Date("2025-02-28T12:00:00.000Z"));
  });

  it("charges the remaining same-cycle upgrade difference through the current end date", () => {
    const now = new Date("2026-10-16T00:00:00.000Z");
    const startsAt = new Date("2026-10-01T00:00:00.000Z");
    const expiresAt = new Date("2026-11-01T00:00:00.000Z");
    const creditValue = 44900;
    const remainingCredit = Math.round(
      (creditValue * (expiresAt.getTime() - now.getTime())) /
        (expiresAt.getTime() - startsAt.getTime()),
    );
    const expectedAmount =
      Math.round((114900 * remainingCredit) / creditValue) - remainingCredit;
    const quote = quotePlan(
      {
        plan: "pro",
        planExpiresAt: expiresAt,
        billingCycle: "monthly",
        planCreditStartedAt: startsAt,
        planCreditValuePaise: creditValue,
      },
      "premium",
      "monthly",
      now,
    );

    expect(quote?.amount).toBe(expectedAmount);
    expect(quote?.expiresAt).toEqual(expiresAt);
    expect(quote?.creditStartedAt).toEqual(now);
  });

  it("credits unused monthly value when upgrading to yearly", () => {
    const now = new Date("2026-10-16T00:00:00.000Z");
    const startsAt = new Date("2026-10-01T00:00:00.000Z");
    const expiresAt = new Date("2026-11-01T00:00:00.000Z");
    const remainingCredit = Math.round(
      (44900 * (expiresAt.getTime() - now.getTime())) /
        (expiresAt.getTime() - startsAt.getTime()),
    );

    const quote = quotePlan(
      {
        plan: "pro",
        planExpiresAt: expiresAt,
        billingCycle: "monthly",
        planCreditStartedAt: startsAt,
        planCreditValuePaise: 44900,
      },
      "premium",
      "yearly",
      now,
    );

    expect(quote?.amount).toBe(1149900 - remainingCredit);
    expect(quote?.expiresAt).toEqual(new Date("2027-10-16T00:00:00.000Z"));
    expect(quote?.creditValuePaise).toBe(1149900);
  });

  it("converts excess unused yearly value into time when the new cycle costs less", () => {
    const now = new Date("2026-10-16T00:00:00.000Z");
    const startsAt = new Date("2026-04-19T00:00:00.000Z");
    const expiresAt = new Date("2027-04-19T00:00:00.000Z");
    const quote = quotePlan(
      {
        plan: "pro",
        planExpiresAt: expiresAt,
        billingCycle: "yearly",
        planCreditStartedAt: startsAt,
        planCreditValuePaise: 449900,
      },
      "premium",
      "monthly",
      now,
    );

    expect(quote?.amount).toBe(0);
    expect(quote!.expiresAt.getTime()).toBeGreaterThan(
      new Date("2026-12-01T00:00:00.000Z").getTime(),
    );
    expect(quote!.expiresAt.getTime()).toBeLessThan(
      new Date("2027-01-01T00:00:00.000Z").getTime(),
    );
    expect(quote!.completePeriods).toBe(1);
    expect(quote!.partialPeriodMs).toBeGreaterThan(0);
  });

  it("turns the ₹163 remainder into fractional prepaid monthly coverage", () => {
    const now = new Date("2026-04-02T00:00:00.000Z");
    const quote = quotePlan(
      {
        plan: "pro",
        planExpiresAt: new Date("2026-07-02T00:00:00.000Z"),
        billingCycle: "yearly",
        planCreditStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        planCreditValuePaise: 1_200_000,
      },
      "pro",
      "monthly",
      now,
    );

    expect(quote?.unusedCreditPaise).toBe(600_000);
    expect(quote?.amount).toBe(0);
    expect(quote?.completePeriods).toBe(13);
    expect(quote?.partialPeriodMs).toBeGreaterThan(0);
    expect(quote?.expiresAt.getTime()).toBeGreaterThan(
      new Date("2027-05-13T00:00:00.000Z").getTime(),
    );
    expect(quote?.expiresAt.getTime()).toBeLessThan(
      new Date("2027-05-14T00:00:00.000Z").getTime(),
    );
  });
});
