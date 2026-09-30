import { createApp } from "./app.js";
import { connectDB } from "./db/connect.js";
import {
  ensureNotificationEventIndex,
  ensureCompletedTaskIndex,
  migrateLegacyTaskAssignees,
  migrateCompletedTaskTimestamps,
  syncPlanLimits,
} from "./db/migrations.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { purgeExpiredProjects } from "./modules/projects/projects.service.js";
import { purgeExpiredTasks } from "./modules/tasks/tasks.service.js";
import mongoose from "mongoose";

async function main(): Promise<void> {
  await connectDB();
  await migrateLegacyTaskAssignees();
  await migrateCompletedTaskTimestamps();
  await syncPlanLimits();
  await ensureNotificationEventIndex();
  await ensureCompletedTaskIndex();

  // Projects left in the bin past their 30 days are deleted for good. Lists
  // also clean up on read, so this just keeps the database tidy.
  const sweepBin = () => {
    void purgeExpiredProjects().catch((error: unknown) =>
      logger.error({ error }, "Project bin cleanup failed"),
    );
    void purgeExpiredTasks().catch((error: unknown) =>
      logger.error({ error }, "Task bin cleanup failed"),
    );
  };
  sweepBin();
  setInterval(sweepBin, 60 * 60 * 1000).unref();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Server started");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
