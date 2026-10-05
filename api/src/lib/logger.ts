import pino from "pino";
import { env } from "../config/env.js";

function getLogLevel(): string {
  if (env.NODE_ENV === "test") return "silent";
  if (env.NODE_ENV === "production") return "info";
  return "debug";
}

// Request logs include the headers, and those carry the sign-in token and the
// refresh cookie. Anyone who can read the logs could use them, so they are
// removed before anything is written.
export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: getLogLevel(),
  redact: { paths: LOG_REDACT_PATHS, remove: true },
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
