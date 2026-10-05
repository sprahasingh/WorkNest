import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { expireDuePlans } from "../src/modules/billing/planLifecycle.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
app.set("trust proxy", 1);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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

describe("account locked while over the plan", () => {
  it("blocks changes until the extra work is removed", async () => {
    const { orgId, admin } = await setupOrg(app, "lock1.test");
    await Organization.updateOne(
      { _id: orgId },
      { plan: "pro", seatLimit: 30, projectLimit: 25 },
    );
    const ids: string[] = [];
    for (const key of ["AAA", "BBB", "CCC", "DDD"]) {
      const created = await makeProject(orgId, admin.token, key);
      expect(created.status).toBe(201);
      ids.push(created.body.project._id as string);
    }

    await Organization.updateOne(
      { _id: orgId },
      { planExpiresAt: new Date(Date.now() - 1000) },
    );

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("free");
    expect(org.body.usage.overLimit).toBe(true);
    expect(org.body.usage.projectCount).toBe(4);

    const blocked = await makeProject(orgId, admin.token, "EEE");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_OVER_LIMIT");

    const edit = await request(app)
      .patch(`/api/orgs/${orgId}/projects/${ids[0]}`)
      .set(auth(admin.token))
      .send({ name: "Renamed" });
    expect(edit.status).toBe(403);

    // Reading still works, so people can see what to remove.
    const list = await request(app)
      .get(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token));
    expect(list.status).toBe(200);

    // Archiving the extra project gets the account back under the plan.
    const archived = await request(app)
      .post(`/api/orgs/${orgId}/projects/${ids[3]}/archive`)
      .set(auth(admin.token));
    expect(archived.status).toBe(200);

    const after = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(after.body.usage.overLimit).toBe(false);
    // Under the limit is not the same as having room: Free allows 3 active
    // projects and 3 are still open, so a new one waits for a free slot.
    const full = await makeProject(orgId, admin.token, "EEE");
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("PROJECT_LIMIT_REACHED");

    const archivedAgain = await request(app)
      .post(`/api/orgs/${orgId}/projects/${ids[2]}/archive`)
      .set(auth(admin.token));
    expect(archivedAgain.status).toBe(200);
    const ok = await makeProject(orgId, admin.token, "EEE");
    expect(ok.status).toBe(201);
  });
});
