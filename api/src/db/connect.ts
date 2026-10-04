import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

mongoose.set("strictQuery", true);

export async function connectDB(): Promise<void> {
  mongoose.set("autoIndex", env.NODE_ENV !== "production");
  // Without a limit, an unreachable database leaves startup waiting for 30
  // seconds, and requests hanging, with nothing in the logs.
  const connection = await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20,
  });
  logger.info({ host: connection.connection.host }, "Connected to MongoDB");
  mongoose.connection.on("error", (err) =>
    logger.error({ err }, "MongoDB connection error"),
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected"),
  );
  mongoose.connection.on("reconnected", () =>
    logger.info("MongoDB reconnected"),
  );
}
