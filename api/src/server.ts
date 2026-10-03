import { createApp } from "./app.js";
import { connectDB } from "./db/connect.js";
import {
  ensureNotificationEventIndex,
  ensureNotificationRetentionIndex,
  ensureCompletedTaskIndex,
  migrateDateOnlyTaskDueDates,
  migrateLegacyTaskAssignees,
  migrateCompletedTaskTimestamps,
  syncPlanLimits,
  syncActiveProjectCounts,
} from "./db/migrations.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { purgeExpiredProjects } from "./modules/projects/projects.service.js";
import { purgeExpiredTasks } from "./modules/tasks/tasks.service.js";
import { ensureDueNotificationsForAllUsers } from "./modules/notifications/notifications.service.js";
import mongoose from "mongoose";
import { PendingRegistration } from "./models/PendingRegistration.js";

async function main(): Promise<void> {
  await connectDB();
  await PendingRegistration.createIndexes();
  await migrateLegacyTaskAssignees();
  await migrateDateOnlyTaskDueDates();
  await migrateCompletedTaskTimestamps();
  await syncPlanLimits();
  await syncActiveProjectCounts();
  await ensureNotificationEventIndex();
  await ensureNotificationRetentionIndex();
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

  const sweepTaskReminders = () => {
    void ensureDueNotificationsForAllUsers().catch((error: unknown) =>
      logger.error({ error }, "Task reminder sweep failed"),
    );
  };
  sweepTaskReminders();
  // Opening notifications refreshes your own reminders right away, so the
  // background sweep only needs to run every few minutes.
  setInterval(sweepTaskReminders, 10 * 60 * 1000).unref();

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
