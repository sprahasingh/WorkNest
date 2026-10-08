import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Read when the app starts, so set them first.
vi.hoisted(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
  process.env.RAZORPAY_KEY_SECRET = "test_secret_value";
  process.env.RAZORPAY_WEBHOOK_SECRET = "hook_secret_value";
});

import request from "supertest";
import { createApp } from "../src/app.js";
import { Organization } from "../src/models/Organization.js";
import { Payment } from "../src/models/Payment.js";
import { Project } from "../src/models/Project.js";
import { Task } from "../src/models/Task.js";
import { runWithTenant } from "../src/tenancy/context.js";
import { setupOrg } from "./orgHelpers.js";

const app = createApp();
app.set("trust proxy", 1);

const sign = (orderId: string, paymentId: string) =>
  createHmac("sha256", "test_secret_value")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

let orderCounter = 0;
function stubRazorpay() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { amount: number };
      orderCounter += 1;
      return new Response(
        JSON.stringify({
          id: `order_test_${orderCounter}`,
          amount: body.amount,
          currency: "INR",
        }),
        { status: 200 },
      );
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function freeImpactFingerprint(orgId: string, token: string) {
  const config = await request(app)
    .get(`/api/orgs/${orgId}/billing`)
    .set(auth(token));
  return config.body.impacts.free.fingerprint as string;
}

describe("paying for a plan", () => {
  it("rejects malformed provider identifiers before payment updates", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "payment-ids.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    expect(order.status).toBe(201);

    const malformed = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: { $ne: null },
        paymentId: "pay_valid_1",
        signature: "not-a-signature",
      });
    expect(malformed.status).toBe(400);

    const payment = await Payment.findOne({
      razorpayOrderId: order.body.orderId,
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(payment?.status).toBe("created");
    expect(payment?.razorpayPaymentId ?? null).toBeNull();
  });

  it("reports server plan impact and rejects a stale usage snapshot", async () => {
    stubRazorpay();
    const { orgId, admin, addMember } = await setupOrg(app, "plan-impact.test");
    const member = await addMember("second-member");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        planExpiresAt: new Date(Date.now() + 60_000),
        billingCycle: "monthly",
        seatsUsed: 42,
        projectCount: 31,
        seatLimit: 100,
        projectLimit: 50,
      },
    );
    let projectId = "";
    await runWithTenant(
      { tenantId: orgId, userId: admin.id, role: "admin" },
      async () => {
        const project = await Project.create({
          tenantId: orgId,
          name: "Project A",
          key: "PROJA",
          createdBy: admin.id,
        });
        projectId = String(project._id);
        await Task.insertMany(
          Array.from({ length: 51 }, (_, index) => ({
            tenantId: orgId,
            projectId,
            title: `Task ${index + 1}`,
            createdBy: admin.id,
            status: "todo",
            archivedAt: null,
            deletedAt: null,
          })),
        );
      },
    );
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    expect(config.status).toBe(200);
    expect(config.body.impacts.pro).toMatchObject({
      plan: "pro",
      seats: { used: 42, limit: 30, exceeded: true },
      projects: { active: 31, limit: 25, exceeded: true },
      tasks: {
        limit: 50,
        exceededProjectCount: 1,
        overages: [
          {
            projectId,
            projectName: "Project A",
            activeCount: 51,
            limit: 50,
          },
        ],
      },
      withinLimits: false,
    });
    expect(config.body.impacts.free.withinLimits).toBe(false);
    expect(config.body.quotes.pro.monthly.impact.fingerprint).toBe(
      config.body.impacts.pro.fingerprint,
    );

    await Organization.updateOne({ _id: orgId }, { seatsUsed: 43 });
    const staleOrder = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({
        plan: "pro",
        billingCycle: "monthly",
        quoteToken: config.body.quotes.pro.monthly.quoteToken,
      });
    expect(staleOrder.status).toBe(409);
    expect(staleOrder.body.error.code).toBe("USAGE_CHANGED");

    const staleFree = await request(app)
      .post(`/api/orgs/${orgId}/billing/schedule-free`)
      .set(auth(admin.token))
      .send({ impactFingerprint: config.body.impacts.free.fingerprint });
    expect(staleFree.status).toBe(409);
    expect(staleFree.body.error.code).toBe("USAGE_CHANGED");

    const unauthorized = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(member.token));
    expect(unauthorized.status).toBe(403);
  });

  it("keeps a prepaid Pro downgrade pending while over limits and rechecks activation", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "plan-impact-activation.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        planExpiresAt: new Date(Date.now() + 60_000),
        billingCycle: "monthly",
        seatsUsed: 1,
        projectCount: 1,
        seatLimit: 100,
        projectLimit: 50,
      },
    );
    let projectId = "";
    await runWithTenant(
      { tenantId: orgId, userId: admin.id, role: "admin" },
      async () => {
        const project = await Project.create({
          tenantId: orgId,
          name: "Activation project",
          key: "ACTPROJ",
          createdBy: admin.id,
        });
        projectId = String(project._id);
        await Task.insertMany(
          Array.from({ length: 51 }, (_, index) => ({
            tenantId: orgId,
            projectId,
            title: `Activation task ${index + 1}`,
            createdBy: admin.id,
            status: "todo",
            archivedAt: null,
            deletedAt: null,
          })),
        );
      },
    );
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({
        plan: "pro",
        billingCycle: "monthly",
        quoteToken: config.body.quotes.pro.monthly.quoteToken,
      });
    const paymentId = "pay_plan_impact_activation";
    const verified = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(verified.status).toBe(200);
    await Organization.updateOne(
      { _id: orgId },
      {
        planExpiresAt: new Date(Date.now() - 1000),
        scheduledStartsAt: new Date(Date.now() - 1000),
      },
    );
    const expired = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(expired.body.organization.plan).toBe("free");
    expect(expired.body.organization.scheduledPlan).toBe("pro");
    expect(expired.body.organization.scheduledPaymentId).toBeTruthy();

    await runWithTenant(
      { tenantId: orgId, userId: admin.id, role: "admin" },
      async () => {
        await Task.updateOne(
          { projectId, title: "Activation task 51" },
          { status: "done" },
        );
      },
    );
    const activated = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(activated.body.organization.plan).toBe("pro");
    expect(activated.body.organization.scheduledPlan).toBeNull();
    expect(
      new Date(activated.body.organization.planExpiresAt).getTime(),
    ).toBeGreaterThan(Date.now() + 27 * 86400000);
  });

  it("schedules a verified lower paid plan and activates it at expiry", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "scheduled-paid.test");
    const currentExpiry = new Date(Date.now() + 60_000);
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        planExpiresAt: currentExpiry,
        billingCycle: "monthly",
        planCreditStartedAt: new Date(Date.now() - 30 * 86400000),
        planCreditValuePaise: 114900,
        seatLimit: 100,
        projectLimit: 50,
      },
    );
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    expect(config.body.impacts.pro.withinLimits).toBe(true);
    expect(config.body.quotes.pro.yearly).toMatchObject({
      amount: 449900,
      scheduled: true,
    });
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({
        plan: "pro",
        billingCycle: "yearly",
        quoteToken: config.body.quotes.pro.yearly.quoteToken,
      });
    expect(order.status).toBe(201);
    const paymentId = "pay_scheduled_pro";
    const confirmed = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.organization.plan).toBe("premium");
    expect(confirmed.body.organization.seatLimit).toBe(100);
    expect(confirmed.body.organization.scheduledPlan).toBe("pro");
    const duplicate = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.organization.scheduledPlan).toBe("pro");

    const payment = await Payment.findOne({
      razorpayOrderId: order.body.orderId,
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(payment?.appliedAt).toBeTruthy();
    await Organization.updateOne(
      { _id: orgId },
      {
        planExpiresAt: new Date(Date.now() - 1000),
        scheduledStartsAt: new Date(Date.now() - 1000),
      },
    );
    const expired = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(expired.body.organization.plan).toBe("pro");
    expect(expired.body.organization.billingCycle).toBe("yearly");
    expect(
      new Date(expired.body.organization.planExpiresAt).getTime(),
    ).toBeGreaterThan(Date.now() + 360 * 86400000);
    expect(expired.body.organization.scheduledPlan).toBeNull();
  });

  it("schedules and cancels a Free downgrade without changing paid entitlement", async () => {
    const { orgId, admin } = await setupOrg(app, "scheduled-free.test");
    const expiry = new Date(Date.now() + 60_000);
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "pro",
        planExpiresAt: expiry,
        billingCycle: "monthly",
        seatLimit: 30,
        projectLimit: 25,
      },
    );
    const impactFingerprint = await freeImpactFingerprint(orgId, admin.token);
    const scheduled = await request(app)
      .post(`/api/orgs/${orgId}/billing/schedule-free`)
      .set(auth(admin.token))
      .send({ impactFingerprint });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.organization.plan).toBe("pro");
    expect(scheduled.body.organization.scheduledPlan).toBe("free");
    const cancelled = await request(app)
      .delete(`/api/orgs/${orgId}/billing/scheduled-change`)
      .set(auth(admin.token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.organization.plan).toBe("pro");
    expect(cancelled.body.organization.scheduledPlan).toBeNull();
    expect(cancelled.body.organization.planExpiresAt).toBe(
      new Date(expiry).toISOString(),
    );

    await request(app)
      .post(`/api/orgs/${orgId}/billing/schedule-free`)
      .set(auth(admin.token))
      .send({ impactFingerprint });
    const blockedOrder = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium", billingCycle: "monthly" });
    expect(blockedOrder.status).toBe(409);
    expect(blockedOrder.body.error.code).toBe("PENDING_PLAN_CHANGE");
    await Organization.updateOne(
      { _id: orgId },
      { planExpiresAt: new Date(Date.now() - 1000) },
    );
    const expired = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(expired.body.organization.plan).toBe("free");
    expect(expired.body.organization.scheduledPlan).toBeNull();
    expect(expired.body.organization.planExpiredFrom).toBe("pro");
    expect(expired.body.usage.inGrace).toBe(true);
  });

  it("serializes concurrent Free downgrade requests into one pending change", async () => {
    const { orgId, admin } = await setupOrg(app, "scheduled-race.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        planExpiresAt: new Date(Date.now() + 60_000),
        billingCycle: "monthly",
        seatLimit: 100,
        projectLimit: 50,
      },
    );
    const impactFingerprint = await freeImpactFingerprint(orgId, admin.token);
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/orgs/${orgId}/billing/schedule-free`)
        .set(auth(admin.token))
        .send({ impactFingerprint }),
      request(app)
        .post(`/api/orgs/${orgId}/billing/schedule-free`)
        .set(auth(admin.token))
        .send({ impactFingerprint }),
    ]);
    expect(
      [first.status, second.status].every(
        (status) => status === 200 || status === 409,
      ),
    ).toBe(true);
    const current = await Organization.findById(orgId)
      .setOptions({ skipTenant: true })
      .lean();
    expect(current?.scheduledPlan).toBe("free");
    expect(current?.plan).toBe("premium");
  });

  it("refunds advance payment before cancelling a paid scheduled change", async () => {
    let orderNumber = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === "POST" && url.endsWith("/orders")) {
          orderNumber += 1;
          const body = JSON.parse(init.body ?? "{}") as { amount: number };
          return new Response(
            JSON.stringify({
              id: `order_refund_${orderNumber}`,
              amount: body.amount,
              currency: "INR",
            }),
            { status: 200 },
          );
        }
        if (!init?.method || init.method === "GET")
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (init?.method === "POST" && url.endsWith("/refund"))
          return new Response(JSON.stringify({ id: "rfnd_scheduled" }), {
            status: 200,
          });
        throw new Error(`Unexpected Razorpay request ${init?.method} ${url}`);
      }),
    );
    const { orgId, admin } = await setupOrg(app, "scheduled-refund.test");
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "premium",
        planExpiresAt: new Date(Date.now() + 60_000),
        billingCycle: "monthly",
        seatLimit: 100,
        projectLimit: 50,
      },
    );
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({
        plan: "pro",
        quoteToken: config.body.quotes.pro.monthly.quoteToken,
      });
    const paymentId = "pay_scheduled_refund";
    await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });

    const cancelled = await request(app)
      .delete(`/api/orgs/${orgId}/billing/scheduled-change`)
      .set(auth(admin.token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.organization.plan).toBe("premium");
    expect(cancelled.body.organization.scheduledPlan).toBeNull();
    const payment = await Payment.findOne({
      razorpayOrderId: order.body.orderId,
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(payment?.refundStatus).toBe("refunded");
    expect(payment?.refundId).toBe("rfnd_scheduled");
  });

  it("rejects tampered and stale organization-bound quotes", async () => {
    const { orgId, admin } = await setupOrg(app, "quote-security.test");
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    const token = config.body.quotes.pro.monthly.quoteToken as string;

    const tampered = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro", billingCycle: "monthly", quoteToken: `${token}x` });
    expect(tampered.status).toBe(400);

    await Organization.findByIdAndUpdate(orgId, {
      planExpiresAt: new Date(Date.now() + 60_000),
    });
    const stale = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro", billingCycle: "monthly", quoteToken: token });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("QUOTE_EXPIRED");
  });

  it("reports what each upgrade costs and blocks free upgrades", async () => {
    const { orgId, admin } = await setupOrg(app, "pay1.test");
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    expect(config.body.enabled).toBe(true);
    expect(config.body.keyId).toBe("rzp_test_abc123");
    expect(config.body.quotes).toMatchObject({
      pro: { monthly: { amount: 44900 }, yearly: { amount: 449900 } },
      premium: { monthly: { amount: 114900 }, yearly: { amount: 1149900 } },
    });

    // With payments on, moving up without paying is refused.
    const skipped = await request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    expect(skipped.status).toBe(402);
    expect(skipped.body.error.code).toBe("PAYMENT_REQUIRED");
  });

  it("upgrades only after a correctly signed payment", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay2.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    expect(order.status).toBe(201);
    expect(order.body.amount).toBe(44900);

    const forged = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId: "pay_forged",
        signature: "0".repeat(64),
      });
    expect(forged.status).toBe(400);
    const still = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(still.body.organization.plan).toBe("free");

    const paymentId = "pay_real_1";
    const ok = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(ok.status).toBe(200);
    expect(ok.body.organization.plan).toBe("pro");
    expect(ok.body.organization.seatLimit).toBe(30);

    // Confirming again changes nothing and doesn't fail.
    const again = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(again.status).toBe(200);

    // Pro to Premium costs the difference, and the audit log names the payment.
    const next = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });
    expect(next.body.amount).toBe(70000);
    const audit = await request(app)
      .get(`/api/orgs/${orgId}/audit-logs`)
      .set(auth(admin.token));
    const entry = audit.body.items.find(
      (item: { action: string }) => item.action === "plan.changed",
    );
    expect(entry.metadata.payment.paymentId).toBe(paymentId);

    // Paid for, so it can't be cancelled early.
    const down = await request(app)
      .post(`/api/orgs/${orgId}/plan`)
      .set(auth(admin.token))
      .send({ plan: "free" });
    expect(down.status).toBe(409);
    expect(down.body.error.code).toBe("PLAN_ACTIVE_UNTIL_END");
  });

  it("keeps one organization from confirming another's order, and members out", async () => {
    stubRazorpay();
    const a = await setupOrg(app, "pay3a.test");
    const b = await setupOrg(app, "pay3b.test");
    const order = await request(app)
      .post(`/api/orgs/${a.orgId}/billing/order`)
      .set(auth(a.admin.token))
      .send({ plan: "pro" });
    const stolen = await request(app)
      .post(`/api/orgs/${b.orgId}/billing/verify`)
      .set(auth(b.admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId: "pay_x",
        signature: sign(order.body.orderId, "pay_x"),
      });
    expect(stolen.status).toBe(404);

    const member = await a.addMember("pat");
    const denied = await request(app)
      .post(`/api/orgs/${a.orgId}/billing/order`)
      .set(auth(member.token))
      .send({ plan: "pro" });
    expect(denied.status).toBe(403);
  });
});

describe("monthly and yearly plans", () => {
  const pay = async (
    orgId: string,
    token: string,
    plan: string,
    billingCycle: string,
    paymentId: string,
  ) => {
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(token))
      .send({ plan, billingCycle });
    expect(order.status).toBe(201);
    const ok = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(ok.status).toBe(200);
    return { order: order.body, org: ok.body.organization };
  };

  it("charges the yearly price and runs for a year", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "cycle1.test");
    const { order, org } = await pay(
      orgId,
      admin.token,
      "pro",
      "yearly",
      "pay_y1",
    );
    expect(order.amount).toBe(449900);
    expect(org.billingCycle).toBe("yearly");
    const days =
      (new Date(org.planExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(367);

    // Moving up on the same cycle costs the yearly difference and keeps the
    // end date.
    const next = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium", billingCycle: "yearly" });
    expect(next.body.amount).toBe(1149900 - 449900);
    const upgraded = await pay(
      orgId,
      admin.token,
      "premium",
      "yearly",
      "pay_y2",
    );
    expect(upgraded.org.plan).toBe("premium");
    expect(upgraded.org.planExpiresAt).toBe(org.planExpiresAt);
  });

  it("renews the same plan by adding a month to the end date", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "cycle2.test");
    const first = await pay(orgId, admin.token, "pro", "monthly", "pay_m1");
    const renewed = await pay(orgId, admin.token, "pro", "monthly", "pay_m2");
    expect(renewed.order.amount).toBe(44900);
    const gap =
      new Date(renewed.org.planExpiresAt).getTime() -
      new Date(first.org.planExpiresAt).getTime();
    expect(gap / 86_400_000).toBeGreaterThanOrEqual(28);
    expect(gap / 86_400_000).toBeLessThanOrEqual(31);
  });

  it("applies a zero-cost upgrade from unused plan credit", async () => {
    const { orgId, admin } = await setupOrg(app, "cycle-credit.test");
    const now = Date.now();
    const startsAt = new Date(now - 180 * 86_400_000);
    const expiresAt = new Date(now + 185 * 86_400_000);
    await Organization.updateOne(
      { _id: orgId },
      {
        plan: "pro",
        seatLimit: 30,
        projectLimit: 25,
        billingCycle: "yearly",
        planExpiresAt: expiresAt,
        planCreditStartedAt: startsAt,
        planCreditValuePaise: 449900,
      },
    );

    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium", billingCycle: "monthly" });

    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({
      amount: 0,
      paidByCredit: true,
      plan: "premium",
      billingCycle: "monthly",
    });
    const org = await Organization.findById(orgId).lean();
    expect(org?.plan).toBe("premium");
    expect(org?.billingCycle).toBe("monthly");
    expect(org?.planExpiresAt?.getTime()).toBeGreaterThan(
      now + 60 * 86_400_000,
    );
    expect(org?.planExpiresAt?.getTime()).toBeLessThan(now + 90 * 86_400_000);
    expect(org?.planCreditStartedAt?.getTime()).toBeGreaterThanOrEqual(now);
  });

  it("allows buying a lower plan as prepaid coverage at the current expiry", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "cycle3.test");
    await pay(orgId, admin.token, "premium", "monthly", "pay_m3");
    const quote = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    const lower = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({
        plan: "pro",
        billingCycle: "monthly",
        quoteToken: quote.body.quotes.pro.monthly.quoteToken,
      });
    expect(lower.status).toBe(201);
    const paymentId = "pay_m3_lower";
    const verified = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: lower.body.orderId,
        paymentId,
        signature: sign(lower.body.orderId, paymentId),
      });
    expect(verified.body.organization.plan).toBe("premium");
    const config = await request(app)
      .get(`/api/orgs/${orgId}/billing`)
      .set(auth(admin.token));
    expect(config.body.scheduledChange.plan).toBe("pro");
  });
});

describe("the payment webhook", () => {
  const post = (body: object, secret = "hook_secret_value") => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        createHmac("sha256", secret).update(raw).digest("hex"),
      )
      .send(raw);
  };

  it("upgrades the plan when the browser never came back", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay4.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });

    const bad = await post({ event: "payment.captured" }, "wrong_secret");
    expect(bad.status).toBe(400);

    const event = {
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_hook_1", order_id: order.body.orderId } },
      },
    };
    expect((await post(event)).status).toBe(200);
    // Razorpay may send it more than once.
    expect((await post(event)).status).toBe(200);

    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("premium");

    // Orders we don't know about are ignored, not errors.
    const unknown = await post({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_z", order_id: "order_nope" } } },
    });
    expect(unknown.status).toBe(200);
  });
});

describe("payments that go wrong halfway", () => {
  const hook = (body: object) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set(
        "X-Razorpay-Signature",
        createHmac("sha256", "hook_secret_value").update(raw).digest("hex"),
      )
      .send(raw);
  };

  it("ignores a webhook whose amount isn't what the order was for", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay5.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "pro" });
    const res = await hook({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_cheap",
            order_id: order.body.orderId,
            amount: 100,
          },
        },
      },
    });
    expect(res.status).toBe(200);
    const org = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set(auth(admin.token));
    expect(org.body.organization.plan).toBe("free");
    const payment = await Payment.findOne({
      razorpayOrderId: order.body.orderId,
    })
      .setOptions({ skipTenant: true })
      .lean();
    expect(payment?.refundStatus).toBe("refunded");
  });

  it("finishes an order that was marked paid but never applied", async () => {
    stubRazorpay();
    const { orgId, admin } = await setupOrg(app, "pay6.test");
    const order = await request(app)
      .post(`/api/orgs/${orgId}/billing/order`)
      .set(auth(admin.token))
      .send({ plan: "premium" });
    // As if the server stopped right after marking it paid.
    await Payment.updateOne(
      { razorpayOrderId: order.body.orderId },
      {
        $set: {
          status: "paid",
          razorpayPaymentId: "pay_half",
          paidAt: new Date(),
        },
      },
    ).setOptions({ skipTenant: true });

    const paymentId = "pay_half";
    const confirmed = await request(app)
      .post(`/api/orgs/${orgId}/billing/verify`)
      .set(auth(admin.token))
      .send({
        orderId: order.body.orderId,
        paymentId,
        signature: sign(order.body.orderId, paymentId),
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.organization.plan).toBe("premium");
  });
});
