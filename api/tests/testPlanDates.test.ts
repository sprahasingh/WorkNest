import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { Notification } from "../src/models/Notification.js";
import { Organization } from "../src/models/Organization.js";
import { Project } from "../src/models/Project.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const originalBypass = env.EMAIL_VERIFICATION_BYPASS_EMAILS;
afterEach(() => {
  env.EMAIL_VERIFICATION_BYPASS_EMAILS = originalBypass;
});

async function proOrg(domain: string, testAccount: boolean) {
  const { orgId, admin, addMember } = await setupOrg(app, domain);
  if (testAccount) env.EMAIL_VERIFICATION_BYPASS_EMAILS = [`admin@${domain}`];
  await Organization.updateOne(
    { _id: orgId },
    {
      plan: "pro",
      seatLimit: 30,
      projectLimit: 25,
      planExpiresAt: new Date(Date.now() + 20 * DAY),
      billingCycle: "monthly",
    },
  );
  const setDates = (body: object, token = admin.token) =>
    request(app)
      .post(`/api/orgs/${orgId}/billing/test-plan-dates`)
      .set(auth(token))
      .send(body);
  return { orgId, admin, addMember, setDates };
}

describe("test controls for the plan end date", () => {
  it("are off for everyone who isn't a listed test account", async () => {
    const t = await proOrg("tc1.test", false);
    const res = await t.setDates({ planExpiresAt: iso(-DAY) });
    expect(res.status).toBe(404);
    // Nothing changed.
    const org = await Organization.findById(t.orgId).lean();
    expect(org?.plan).toBe("pro");
    expect(org!.planExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 19 * DAY,
    );

    const config = await request(app)
      .get(`/api/orgs/${t.orgId}/billing`)
      .set(auth(t.admin.token));
    expect(config.status).toBe(200);
    expect(config.body.testControls).toBe(false);
  });

  it("are for admins only, even on a listed address", async () => {
    const t = await proOrg("tc2.test", true);
    const member = await t.addMember("pat");
    env.EMAIL_VERIFICATION_BYPASS_EMAILS = [`admin@tc2.test`, `pat@tc2.test`];
    const res = await t.setDates({ planExpiresAt: iso(DAY) }, member.token);
    expect(res.status).toBe(403);
  });

  it("let a listed admin set the end date", async () => {
    const t = await proOrg("tc3.test", true);
    const config = await request(app)
      .get(`/api/orgs/${t.orgId}/billing`)
      .set(auth(t.admin.token));
    expect(config.body.testControls).toBe(true);

    const when = iso(3 * DAY);
    const res = await t.setDates({ planExpiresAt: when });
    expect(res.status).toBe(200);
    expect(new Date(res.body.organization.planExpiresAt).toISOString()).toBe(
      when,
    );
    expect(res.body.ran).toEqual([]);
  });

  it("check the input and which plan the workspace is on", async () => {
    const t = await proOrg("tc4.test", true);
    expect((await t.setDates({})).status).toBe(400);
    expect((await t.setDates({ planExpiresAt: "not a date" })).status).toBe(
      400,
    );
    expect((await t.setDates({ planExpiredAt: iso(-DAY) })).status).toBe(409);

    await Organization.updateOne({ _id: t.orgId }, { plan: "free" });
    const res = await t.setDates({ planExpiresAt: iso(DAY) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ON_PAID_PLAN");
  });

  it("drive reminders, expiry, the grace period and archiving without waiting", async () => {
    const t = await proOrg("tc5.test", true);
    const notice = async () =>
      Notification.find({
        tenantId: t.orgId,
        eventKey: `plan-renewal:${t.orgId}`,
      }).lean();

    // 6 days left: the 7 day reminder.
    let res = await t.setDates({ planExpiresAt: iso(6 * DAY), run: true });
    expect(res.status).toBe(200);
    expect(res.body.ran).toEqual(["reminder sent"]);
    expect((await notice())[0]?.stage).toBe("7d");

    // Under a day left: the 1 day reminder replaces it.
    await t.setDates({ planExpiresAt: iso(DAY / 2), run: true });
    expect(await notice()).toHaveLength(1);
    expect((await notice())[0]?.stage).toBe("1d");

    // Ended: back on Free, with the "ended" notice.
    res = await t.setDates({ planExpiresAt: iso(-1000), run: true });
    expect(res.body.ran).toContain("plan expired");
    expect(res.body.organization.plan).toBe("free");
    expect(res.body.usage.inGrace).toBe(true);
    expect((await notice())[0]?.stage).toBe("expired");

    // 11 days later: the grace period is over, extras are archived.
    res = await t.setDates({ planExpiredAt: iso(-11 * DAY), run: true });
    expect(res.body.ran).toContain("extras archived");
    expect(res.body.usage.inGrace).toBe(false);
    expect(res.body.organization.graceEnforcedAt).not.toBeNull();
    expect((await notice())[0]?.stage).toBe("archived");

    // Moving the ended date again re-arms archiving.
    res = await t.setDates({ planExpiredAt: iso(-3 * DAY) });
    expect(res.body.organization.graceEnforcedAt).toBeNull();
    expect(res.body.usage.inGrace).toBe(true);
  });

  it("automatically archives excess projects when the test date is 11 days past expiry", async () => {
    const t = await proOrg("tc6.test", true);
    for (const key of ["AAA", "BBB", "CCC", "DDD", "EEE"]) {
      const created = await request(app)
        .post(`/api/orgs/${t.orgId}/projects`)
        .set(auth(t.admin.token))
        .send({ name: `Project ${key}`, key });
      expect(created.status).toBe(201);
    }
    await Organization.updateOne(
      { _id: t.orgId },
      { plan: "free", seatLimit: 5, projectLimit: 3, planExpiresAt: null },
    );

    const res = await t.setDates({ planExpiredAt: iso(-11 * DAY), run: true });
    expect(res.status).toBe(200);
    expect(res.body.ran).toContain("extras archived");
    expect(res.body.organization.graceEnforcingAt).toBeNull();
    expect(res.body.organization.graceEnforcedAt).not.toBeNull();
    expect(res.body.organization.graceArchived.projects).toBe(2);
    expect(res.body.usage.paused).toBe(false);
    expect(res.body.usage.restricted).toBe(false);
    expect(
      await Project.countDocuments({ archivedAt: { $ne: null } }).setOptions({
        skipTenant: true,
      }),
    ).toBe(2);
  });
});
