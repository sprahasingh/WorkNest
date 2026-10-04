import { describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { pinoHttp } from "pino-http";
import express from "express";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { LOG_REDACT_PATHS } from "../src/lib/logger.js";
import { runExclusive } from "../src/lib/jobLock.js";
import { Notification } from "../src/models/Notification.js";
import { Organization } from "../src/models/Organization.js";
import { reconcileSeats } from "../src/modules/invites/invites.service.js";
import { syncActiveProjectCounts } from "../src/db/migrations.js";
import { runWithTenant } from "../src/tenancy/context.js";
import { setupOrg } from "./orgHelpers.js";
import { registerAndVerify } from "./emailDeliveryMock.js";

const app = createApp();
app.set("trust proxy", 1);
let ip = 1;
const nextIp = () => `198.51.100.${ip++}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("logs", () => {
  it("never contain the sign-in token or the refresh cookie", async () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: LOG_REDACT_PATHS, remove: true } },
      { write: (line: string) => lines.push(line) },
    );
    const probe = express();
    probe.use(pinoHttp({ logger }));
    probe.get("/x", (_req, res) => {
      res.setHeader("Set-Cookie", "refresh=SECRET_SET_COOKIE");
      res.send("ok");
    });
    await request(probe)
      .get("/x")
      .set("Authorization", "Bearer SECRET_ACCESS_TOKEN")
      .set("Cookie", "refresh=SECRET_REFRESH_TOKEN");
    const text = lines.join("\n");
    expect(text).not.toContain("SECRET_ACCESS_TOKEN");
    expect(text).not.toContain("SECRET_REFRESH_TOKEN");
    expect(text).not.toContain("SECRET_SET_COOKIE");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("upgrading without payments", () => {
  it("is refused when it is not explicitly allowed, but downgrading still works", async () => {
    const { orgId, admin } = await setupOrg(app, "sim1.test");
    const original = env.ALLOW_SIMULATED_UPGRADES;
    try {
      env.ALLOW_SIMULATED_UPGRADES = false;
      const refused = await request(app)
        .post(`/api/orgs/${orgId}/plan`)
        .set(auth(admin.token))
        .send({ plan: "pro" });
      expect(refused.status).toBe(503);
      expect(refused.body.error.code).toBe("PAYMENTS_DISABLED");

      env.ALLOW_SIMULATED_UPGRADES = true;
      const allowed = await request(app)
        .post(`/api/orgs/${orgId}/plan`)
        .set(auth(admin.token))
        .send({ plan: "pro" });
      expect(allowed.status).toBe(200);

      env.ALLOW_SIMULATED_UPGRADES = false;
      const down = await request(app)
        .post(`/api/orgs/${orgId}/plan`)
        .set(auth(admin.token))
        .send({ plan: "free" });
      expect(down.status).toBe(200);
    } finally {
      env.ALLOW_SIMULATED_UPGRADES = original;
    }
  });
});

describe("background job locks", () => {
  it("let only one runner take a tick, and free it when the claim ends", async () => {
    let runs = 0;
    const job = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    const results = await Promise.all([
      runExclusive("test-job", 400, job),
      runExclusive("test-job", 400, job),
      runExclusive("test-job", 400, job),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(await runExclusive("test-job", 400, job)).toBe(true);
    expect(runs).toBe(2);
  });
});

describe("accounts", () => {
  it("stop working at once when the account is deleted", async () => {
    const solo = await registerAndVerify(app, {
      name: "Solo Person",
      email: "solo-delete@audit.test",
      password: "Harbor-lamp-91",
      orgName: "Solo Org",
    });
    const token = solo.body.accessToken as string;
    expect(
      (await request(app).get("/api/auth/me").set(auth(token))).status,
    ).toBe(200);
    expect(
      (await request(app).delete("/api/auth/me").set(auth(token))).status,
    ).toBe(204);
    // The token is still within its 15 minutes, but the account is gone.
    const after = await request(app)
      .post("/api/orgs")
      .set(auth(token))
      .send({ name: "Ghost Org" });
    expect(after.status).toBe(401);
  });

  it("allow one new sign-up link a minute per address", async () => {
    const body = {
      name: "Quick Person",
      email: "quick@audit.test",
      password: "Harbor-lamp-91",
      orgName: "Quick Org",
    };
    const first = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", nextIp())
      .send(body);
    expect(first.status).toBe(202);
    const second = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", nextIp())
      .send(body);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RESEND_TOO_SOON");
  });
});

describe("passwords", () => {
  it("must fit in the 72 bytes bcrypt reads, counting multi-byte letters", async () => {
    // 40 accented letters are 80 bytes, though only 40 characters.
    const tooLong = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", nextIp())
      .send({
        name: "Long Person",
        email: "long-pw@audit.test",
        password: "\u00e9".repeat(40),
        orgName: "Long Org",
      });
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).toContain("72 bytes");
  });
});

describe("counters and guards", () => {
  it("repairs the admin count along with the seat count", async () => {
    const { orgId, admin } = await setupOrg(app, "admins.test");
    await Organization.updateOne(
      { _id: orgId },
      { $set: { adminCount: 7, seatsUsed: 9 } },
    );
    await runWithTenant({ tenantId: orgId, userId: admin.id }, () =>
      reconcileSeats(orgId),
    );
    const org = await Organization.findById(orgId).lean();
    expect(org?.adminCount).toBe(1);
    expect(org?.seatsUsed).toBe(1);
  });

  it("re-counts every organization's projects, including ones with none", async () => {
    const { orgId } = await setupOrg(app, "counts.test");
    await Organization.updateOne({ _id: orgId }, { $set: { projectCount: 4 } });
    await syncActiveProjectCounts();
    expect((await Organization.findById(orgId).lean())?.projectCount).toBe(0);
  });

  it("refuses a notification query that does not name the organization", async () => {
    await expect(
      Notification.find({ userId: new mongoose.Types.ObjectId() }),
    ).rejects.toThrow(/tenantId/);
  });

  it("refuses a due date that is just a number", async () => {
    const { orgId, admin } = await setupOrg(app, "dates.test");
    const project = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Dated", key: "DAT", dueDate: 0 });
    expect(project.status).toBe(400);
    const ok = await request(app)
      .post(`/api/orgs/${orgId}/projects`)
      .set(auth(admin.token))
      .send({ name: "Dated", key: "DAT", dueDate: "2030-01-31" });
    expect(ok.status).toBe(201);
  });
});
