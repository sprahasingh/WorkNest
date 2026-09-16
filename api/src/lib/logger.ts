import pino from "pino";
import { env } from "../config/env.js";

function getLogLevel(): string {
  if (env.NODE_ENV === "test") return "silent";
  if (env.NODE_ENV === "production") return "info";
  return "debug";
}

export const logger = pino({
  level: getLogLevel(),
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});
