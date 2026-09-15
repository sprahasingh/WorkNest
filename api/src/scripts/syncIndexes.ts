import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { Membership } from "../models/Membership.js";
import { Invite } from "../models/Invite.js";
import { Project } from "../models/Project.js";
import { Task } from "../models/Task.js";
import { AuditLog } from "../models/AuditLog.js";

const models = [
  Organization,
  User,
  Session,
  Membership,
  Invite,
  Project,
  Task,
  AuditLog,
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  logger.info("Connected. Syncing indexes...");

  for (const model of models) {
    await model.syncIndexes();
    logger.info({ model: model.modelName }, "Synced indexes");
  }

  await mongoose.connection.close();
  logger.info("Done.");
}

main().catch((error) => {
  logger.error({ error }, "Failed to sync indexes");
  process.exit(1);
});
