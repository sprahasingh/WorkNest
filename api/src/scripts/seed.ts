import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { Membership } from "../models/Membership.js";
import { Project } from "../models/Project.js";
import { Task } from "../models/Task.js";
import { AuditLog } from "../models/AuditLog.js";
import { runWithTenant } from "../tenancy/context.js";

const DEMO_PASSWORD = "password123";

interface DemoUser {
  name: string;
  email: string;
  role: "admin" | "manager" | "member";
}

async function wipeDemoOrgs(): Promise<void> {
  const demoOrgs = await Organization.find({
    slug: { $in: ["acme", "globex"] },
  }).setOptions({ skipTenant: true });

  for (const org of demoOrgs) {
    await Task.deleteMany({ tenantId: org._id }).setOptions({
      skipTenant: true,
    });
    await Project.deleteMany({ tenantId: org._id }).setOptions({
      skipTenant: true,
    });
    await Membership.deleteMany({ tenantId: org._id }).setOptions({
      skipTenant: true,
    });
    await AuditLog.deleteMany({ tenantId: org._id }).setOptions({
      skipTenant: true,
    });
    await Organization.deleteOne({ _id: org._id }).setOptions({
      skipTenant: true,
    });
  }

  const demoEmails = [
    "admin@acme.demo",
    "manager@acme.demo",
    "member@acme.demo",
    "admin@globex.demo",
  ];
  await User.deleteMany({ email: { $in: demoEmails } });

  logger.info("Wiped existing demo data");
}

async function createDemoUser(user: DemoUser) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_COST);
  return User.create({ name: user.name, email: user.email, passwordHash });
}

async function seedOrg(
  slug: "acme" | "globex",
  orgName: string,
  plan: "free" | "pro",
  users: DemoUser[],
  projectCount: number,
  taskCount: number,
) {
  const createdUsers = await Promise.all(users.map(createDemoUser));
  const adminUser = createdUsers[0]!;

  const org = await Organization.create({
    name: orgName,
    slug,
    plan,
    seatLimit: plan === "pro" ? 25 : 5,
    seatsUsed: createdUsers.length,
    projectLimit: plan === "pro" ? 50 : 3,
    projectCount,
    adminCount: users.filter((u) => u.role === "admin").length,
    createdBy: adminUser._id,
  });

  await runWithTenant(
    { tenantId: org._id.toString(), userId: adminUser._id.toString() },
    async () => {
      for (let i = 0; i < createdUsers.length; i++) {
        const membership = new Membership({
          tenantId: org._id,
          userId: createdUsers[i]!._id,
          role: users[i]!.role,
        });
        membership.$locals.skipTenant = true;
        await membership.save();
      }

      const projectKeys = ["OPS", "ENG", "SUP", "GTM", "SEC"].slice(
        0,
        projectCount,
      );
      const projects = [];
      for (const key of projectKeys) {
        const project = await Project.create({
          tenantId: org._id,
          name: `${key} Project`,
          key,
          description: `Demo project for ${key}`,
          createdBy: adminUser._id,
        });
        projects.push(project);
      }

      const statuses = ["todo", "in_progress", "done"] as const;
      const priorities = ["low", "medium", "high"] as const;
      const tasksToInsert = [];

      for (let i = 0; i < taskCount; i++) {
        const project = projects[i % projects.length]!;
        const assignee = createdUsers[i % createdUsers.length]!;
        const daysAgo = Math.floor(Math.random() * 30);
        const createdAt = new Date();
        createdAt.setDate(createdAt.getDate() - daysAgo);

        tasksToInsert.push({
          tenantId: org._id,
          projectId: project._id,
          title: `${project.key}-${i + 1}: Sample task ${i + 1}`,
          description: "Seeded demo task",
          status: statuses[i % statuses.length],
          priority: priorities[i % priorities.length],
          assigneeId: assignee._id,
          dueDate:
            i % 4 === 0
              ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
              : i % 7 === 0
                ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                : null,
          createdBy: adminUser._id,
          createdAt,
        });
      }

      await Task.insertMany(tasksToInsert);

      const auditEntry = new AuditLog({
        tenantId: org._id,
        actorId: adminUser._id,
        action: "org.seeded",
        entityType: "Organization",
        entityId: org._id,
        metadata: { userCount: createdUsers.length, taskCount },
      });
      auditEntry.$locals.skipTenant = true;
      await auditEntry.save();
    },
  );

  logger.info({ org: orgName }, "Seeded organization");
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  logger.info("Connected. Seeding...");

  await wipeDemoOrgs();

  await seedOrg(
    "acme",
    "Acme Corp",
    "free",
    [
      { name: "Acme Admin", email: "admin@acme.demo", role: "admin" },
      { name: "Acme Manager", email: "manager@acme.demo", role: "manager" },
      { name: "Acme Member", email: "member@acme.demo", role: "member" },
    ],
    3,
    45,
  );

  await seedOrg(
    "globex",
    "Globex Corporation",
    "pro",
    [{ name: "Globex Admin", email: "admin@globex.demo", role: "admin" }],
    2,
    15,
  );

  logger.info("Seeding complete");
  await mongoose.connection.close();
}

main().catch((error) => {
  logger.error({ error }, "Seed script failed");
  process.exit(1);
});
