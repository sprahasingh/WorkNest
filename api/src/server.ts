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
  ensureSafetyIndexes,
} from "./db/migrations.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { purgeExpiredProjects } from "./modules/projects/projects.service.js";
import { purgeExpiredTasks } from "./modules/tasks/tasks.service.js";
import { ensureDueNotificationsForAllUsers } from "./modules/notifications/notifications.service.js";
import { expireDuePlans } from "./modules/billing/planLifecycle.js";
import { enforceDueGracePeriods } from "./modules/billing/gracePeriod.service.js";
import { sendMeetingReminders } from "./modules/meetings/meetings.service.js";
import { purgeExpiredChatMessages } from "./modules/chat/chatRetention.service.js";
import { closeRealtime, startRealtime } from "./realtime/hub.js";
import { runExclusive } from "./lib/jobLock.js";
import mongoose from "mongoose";
import { PendingRegistration } from "./models/PendingRegistration.js";

async function main(): Promise<void> {
  await connectDB();
  await PendingRegistration.createIndexes();
  await ensureSafetyIndexes();
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
    void runExclusive("bin-cleanup", 50 * 60 * 1000, async () => {
      await purgeExpiredProjects();
      await purgeExpiredTasks();
    }).catch((err: unknown) => logger.error({ err }, "Bin cleanup failed"));
  };
  sweepBin();
  setInterval(sweepBin, 60 * 60 * 1000).unref();

  const sweepTaskReminders = () => {
    void runExclusive("task-reminders", 8 * 60 * 1000, () =>
      ensureDueNotificationsForAllUsers(),
    ).catch((err: unknown) =>
      logger.error({ err }, "Task reminder sweep failed"),
    );
  };
  sweepTaskReminders();
  // Opening notifications refreshes your own reminders right away, so the
  // background sweep only needs to run every few minutes.
  setInterval(sweepTaskReminders, 10 * 60 * 1000).unref();

  const sweepMeetingReminders = () => {
    void runExclusive("meeting-reminders", 45 * 1000, () =>
      sendMeetingReminders(),
    ).catch((err: unknown) =>
      logger.error({ err }, "Meeting reminder sweep failed"),
    );
  };
  sweepMeetingReminders();
  setInterval(sweepMeetingReminders, 60 * 1000).unref();

  const sweepOldChat = () => {
    void runExclusive("chat-retention", 50 * 60 * 1000, () =>
      purgeExpiredChatMessages(),
    ).catch((err: unknown) =>
      logger.error({ err }, "Chat retention sweep failed"),
    );
  };
  sweepOldChat();
  setInterval(sweepOldChat, 60 * 60 * 1000).unref();

  const sweepExpiredPlans = () => {
    void runExclusive("plan-expiry", 25 * 60 * 1000, async () => {
      await expireDuePlans();
      await enforceDueGracePeriods();
    }).catch((err: unknown) =>
      logger.error({ err }, "Plan expiry sweep failed"),
    );
  };
  sweepExpiredPlans();
  setInterval(sweepExpiredPlans, 30 * 60 * 1000).unref();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Server started");
  });
  startRealtime(server);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    // Open connections (live chat sockets, keep-alive) would keep the server
    // from closing, so they are closed too, with a deadline as a backstop.
    const force = setTimeout(() => {
      logger.error("Shutdown took too long, exiting");
      process.exit(1);
    }, 10_000);
    force.unref();
    await closeRealtime();
    server.close(() => {
      mongoose.connection
        .close()
        .catch((err: unknown) =>
          logger.error({ err }, "Closing MongoDB failed"),
        )
        .finally(() => process.exit(0));
    });
    server.closeAllConnections();
  };

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
