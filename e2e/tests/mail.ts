import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".tmp",
  "mail.log",
);

interface SentEmail {
  to: string;
  text: string;
}

function readAll(): SentEmail[] {
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const body = JSON.parse(line) as {
        to: { email: string }[];
        textContent: string;
      };
      return { to: body.to[0].email, text: body.textContent };
    });
}

// The newest link in an email sent to this address, once it has arrived.
export async function latestLink(to: string, count = 1): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const mine = readAll().filter((mail) => mail.to === to);
    if (mine.length >= count) {
      const match = mine[mine.length - 1].text.match(/https?:\/\/\S+/);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email arrived for ${to}`);
}
