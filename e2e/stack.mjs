// Starts what the browser tests need: an in-memory MongoDB (as a replica set,
// because the API uses transactions) and the API itself. Emails are not sent;
// they are written to e2e/.tmp/mail.log so tests can open the links.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(here, "..", "api");
const require = createRequire(path.join(apiDir, "package.json"));
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const tmp = path.join(here, ".tmp");
fs.mkdirSync(tmp, { recursive: true });
const mailLog = path.join(tmp, "mail.log");
fs.writeFileSync(mailLog, "");

const mongo = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: "wiredTiger" },
});

const api = spawn("npx", ["tsx", "src/server.ts"], {
  cwd: apiDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: "4000",
    MONGODB_URI: mongo.getUri("worknest_e2e"),
    JWT_ACCESS_SECRET: "e2e_secret_e2e_secret_e2e_secret_12",
    ACCESS_TOKEN_TTL: "15m",
    CLIENT_ORIGIN: "http://localhost:5173",
    BCRYPT_COST: "4",
    BREVO_API_KEY: "e2e",
    BREVO_FROM: "noreply@worknest.test",
    MAIL_LOG: mailLog,
    NODE_OPTIONS: `--import ${path.join(here, "mailMock.mjs")}`,
  },
});

const stop = async () => {
  api.kill();
  await mongo.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
api.on("exit", stop);
