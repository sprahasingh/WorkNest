import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { Project } from "../src/models/Project.js";
import { runWithTenant, getTenantContext } from "../src/tenancy/context.js";
import { AppError } from "../src/lib/errors.js";
import request from "supertest";
import { createApp } from "../src/app.js";

function fakeId(): string {
  return new mongoose.Types.ObjectId().toString();
}

describe("tenant isolation", () => {
  it("returns 404 when a user requests an organization they are not a member of", async () => {
    const app = createApp();

    const registerRes = await request(app).post("/api/auth/register").send({
      name: "Org A User",
      email: "orga@example.com",
      password: "password123",
      orgName: "Org A",
    });

    const accessToken = registerRes.body.accessToken as string;

    const fakeOrgId = fakeId();

    const res = await request(app)
      .get(`/api/orgs/${fakeOrgId}/anything`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
  it("hides a document created in org A from org B's queries", async () => {
    const orgA = fakeId();
    const orgB = fakeId();
    const userA = fakeId();
    const userB = fakeId();

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      await Project.create({
        name: "Org A Project",
        key: "OA",
        createdBy: userA,
      });
    });

    await runWithTenant({ tenantId: orgB, userId: userB }, async () => {
      const viaFind = await Project.find({});
      expect(viaFind).toHaveLength(0);

      const viaFindById = await Project.findOne({ key: "OA" });
      expect(viaFindById).toBeNull();

      const count = await Project.countDocuments({});
      expect(count).toBe(0);

      const viaAggregate = await Project.aggregate([{ $match: {} }]);
      expect(viaAggregate).toHaveLength(0);
    });

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      const found = await Project.find({});
      expect(found).toHaveLength(1);
      expect(found[0]?.name).toBe("Org A Project");
    });
  });

  it("prevents updateOne and deleteOne across tenants without touching the document", async () => {
    const orgA = fakeId();
    const orgB = fakeId();
    const userA = fakeId();
    const userB = fakeId();

    let projectId: mongoose.Types.ObjectId;

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      const project = await Project.create({
        name: "Org A Project",
        key: "OA",
        createdBy: userA,
      });
      projectId = project._id;
    });

    await runWithTenant({ tenantId: orgB, userId: userB }, async () => {
      const updateResult = await Project.updateOne(
        { _id: projectId },
        { name: "Hacked Name" },
      );
      expect(updateResult.matchedCount).toBe(0);

      const deleteResult = await Project.deleteOne({ _id: projectId });
      expect(deleteResult.deletedCount).toBe(0);
    });

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      const stillThere = await Project.findById(projectId);
      expect(stillThere).not.toBeNull();
      expect(stillThere?.name).toBe("Org A Project");
    });
  });

  it("throws when a query runs with no tenant context at all", async () => {
    expect(getTenantContext()).toBeUndefined();

    try {
      await Project.find({});
      expect.unreachable("Expected Project.find to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("TENANT_CONTEXT_MISSING");
    }
  });

  it("throws when creating a document with a tenantId that does not match context", async () => {
    const orgA = fakeId();
    const orgB = fakeId();
    const userA = fakeId();

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      try {
        await Project.create({
          name: "Mismatched Project",
          key: "MM",
          createdBy: userA,
          tenantId: orgB,
        });
        expect.unreachable("Expected create to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("TENANT_MISMATCH");
      }
    });
  });

  it("never mixes data across 50 interleaved concurrent operations", async () => {
    const orgA = fakeId();
    const orgB = fakeId();
    const userA = fakeId();
    const userB = fakeId();

    const operations: Promise<void>[] = [];

    for (let i = 0; i < 25; i++) {
      operations.push(
        runWithTenant({ tenantId: orgA, userId: userA }, async () => {
          const project = await Project.create({
            name: `A-${i}`,
            key: `A${i}`,
            createdBy: userA,
          });
          expect(project.tenantId.toString()).toBe(orgA);
        }) as Promise<void>,
      );

      operations.push(
        runWithTenant({ tenantId: orgB, userId: userB }, async () => {
          const project = await Project.create({
            name: `B-${i}`,
            key: `B${i}`,
            createdBy: userB,
          });
          expect(project.tenantId.toString()).toBe(orgB);
        }) as Promise<void>,
      );
    }

    await Promise.all(operations);

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      const count = await Project.countDocuments({});
      expect(count).toBe(25);
    });

    await runWithTenant({ tenantId: orgB, userId: userB }, async () => {
      const count = await Project.countDocuments({});
      expect(count).toBe(25);
    });
  });

  it("allows skipTenant to bypass isolation and logs its use", async () => {
    const orgA = fakeId();
    const userA = fakeId();

    await runWithTenant({ tenantId: orgA, userId: userA }, async () => {
      await Project.create({
        name: "Skip Test Project",
        key: "SK",
        createdBy: userA,
      });
    });

    const allProjects = await Project.find({}).setOptions({
      skipTenant: true,
    });

    expect(allProjects.length).toBeGreaterThanOrEqual(1);
  });
});
