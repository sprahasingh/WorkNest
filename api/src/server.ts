import { createApp } from "./app.js";
import { connectDB } from "./db/connect.js";
import { migrateLegacyTaskAssignees, syncPlanLimits } from "./db/migrations.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { purgeExpiredProjects } from "./modules/projects/projects.service.js";
import mongoose from "mongoose";

async function main(): Promise<void> {
  await connectDB();
  await migrateLegacyTaskAssignees();
  await syncPlanLimits();

  // Projects left in the bin past their 30 days are deleted for good. Lists
  // also clean up on read, so this just keeps the database tidy.
  const sweepBin = () =>
    purgeExpiredProjects().catch((error: unknown) =>
      logger.error({ error }, "Bin cleanup failed"),
    );
  void sweepBin();
  setInterval(() => void sweepBin(), 60 * 60 * 1000).unref();

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
