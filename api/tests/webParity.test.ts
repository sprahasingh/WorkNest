import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_PRICE_PAISE } from "../src/constants/plans.js";
import { PASSWORD_TOO_LONG } from "../src/modules/auth/auth.schemas.js";

// The web app repeats a few rules so forms can answer instantly (plan limits
// and prices, the common-password list, the password length message). The API
// is the one that enforces them, so these tests fail if the two copies drift.
const web = (file: string) =>
  readFileSync(join(__dirname, "../../web/src/lib", file), "utf8");

describe("web and API agree", () => {
  it("on plan limits and prices", () => {
    const source = web("plans.ts");
    for (const [plan, limits] of Object.entries(PLAN_LIMITS)) {
      const row = new RegExp(
        `${plan}:\\s*\\{\\s*seatLimit:\\s*(\\d+),\\s*projectLimit:\\s*(\\d+),\\s*activeTaskLimit:\\s*(\\d+|null)`,
      ).exec(source);
      expect(row, `limits row for ${plan}`).not.toBeNull();
      expect(Number(row![1])).toBe(limits.seatLimit);
      expect(Number(row![2])).toBe(limits.projectLimit);
      expect(row![3] === "null" ? null : Number(row![3])).toBe(
        limits.activeTaskLimit,
      );
    }
    for (const [plan, paise] of Object.entries(PLAN_PRICE_PAISE)) {
      const price = new RegExp(`${plan}:\\s*(\\d+),`).exec(
        source.slice(source.indexOf("PLAN_PRICE_PAISE")),
      );
      expect(Number(price![1]), `price for ${plan}`).toBe(paise);
    }
  });

  it("on the common passwords and the length message", () => {
    const quoted = (text: string) =>
      new Set([...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    const apiSource = readFileSync(
      join(__dirname, "../src/lib/commonPasswords.ts"),
      "utf8",
    );
    const apiList = quoted(
      apiSource.slice(apiSource.indexOf("new Set(["), apiSource.indexOf("]);")),
    );
    const webSource = web("passwordPolicy.ts");
    const webList = quoted(
      webSource.slice(webSource.indexOf("new Set(["), webSource.indexOf("]);")),
    );
    expect(apiList.size).toBeGreaterThan(50);
    expect([...webList].sort()).toEqual([...apiList].sort());
    expect(webSource).toContain(PASSWORD_TOO_LONG);
  });
});
