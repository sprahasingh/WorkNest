import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function paidOrg(
  domain: string,
  plan: "pro" | "premium",
  endsAt: Date | null,
) {
  const { orgId, admin } = await setupOrg(app, domain);
  await Organization.updateOne(
    { _id: orgId },
    {
      plan,
      seatLimit: plan === "pro" ? 30 : 100,
      projectLimit: plan === "pro" ? 25 : 50,
      planExpiresAt: endsAt,
      billingCycle: endsAt ? "monthly" : null,
    },
  );
  const switchTo = (target: string) =>
    request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set(auth(admin.token))
      .send({ plan: target });
  const planNow = async () => (await Organization.findById(orgId).lean())?.plan;
  return { orgId, switchTo, planNow };
}

describe("a paid plan can't be left before it ends", () => {
  it("refuses Premium to Pro and says when it can be done", async () => {
    const t = await paidOrg(
      "sw1.test",
      "premium",
      new Date(Date.now() + 20 * DAY),
    );
    const res = await t.switchTo("pro");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_ACTIVE_UNTIL_END");
    expect(res.body.error.message).toBe(
      "You can switch to Pro after your current Premium plan ends.",
    );
    expect(res.body.error.details[0]).toMatchObject({
      currentPlan: "premium",
      targetPlan: "pro",
    });
    expect(await t.planNow()).toBe("premium");
  });

  it("refuses Pro or Premium to Free with the stays-active message", async () => {
    for (const plan of ["pro", "premium"] as const) {
      const t = await paidOrg(
        `sw2${plan}.test`,
        plan,
        new Date(Date.now() + 5 * DAY),
      );
      const res = await t.switchTo("free");
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PLAN_ACTIVE_UNTIL_END");
      expect(res.body.error.message).toBe(
        "Your current paid plan will remain active until it ends. You'll automatically switch to Free when it expires.",
      );
      expect(await t.planNow()).toBe(plan);
    }
  });

  it("goes to Free by itself when the plan ends", async () => {
    const t = await paidOrg("sw3.test", "pro", new Date(Date.now() - 1000));
    // The first request after the end date moves it to Free, so there is
    // nothing left to switch away from.
    const res = await t.switchTo("free");
    expect(res.status).toBe(200);
    expect(await t.planNow()).toBe("free");
  });

  it("still lets a plan with no end date be changed", async () => {
    const t = await paidOrg("sw4.test", "premium", null);
    const res = await t.switchTo("pro");
    expect(res.status).toBe(200);
    expect(await t.planNow()).toBe("pro");
  });

  it("doesn't touch moving up or staying on the same plan", async () => {
    const t = await paidOrg("sw5.test", "pro", new Date(Date.now() + 5 * DAY));
    const same = await t.switchTo("pro");
    expect(same.body.error?.code).not.toBe("PLAN_ACTIVE_UNTIL_END");
    const up = await t.switchTo("premium");
    expect(up.body.error?.code).not.toBe("PLAN_ACTIVE_UNTIL_END");
  });
});
