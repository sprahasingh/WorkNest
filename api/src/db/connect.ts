import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

export async function connectDB(): Promise<void> {
  mongoose.set("autoIndex", env.NODE_ENV !== "production");
  const connection = await mongoose.connect(env.MONGODB_URI);
  logger.info({ host: connection.connection.host }, "Connected to MongoDB");
}
