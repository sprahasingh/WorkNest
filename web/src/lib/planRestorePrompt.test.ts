import { describe, expect, it } from "vitest";
import {
  restorePromptSignature,
  shouldShowRestorePrompt,
} from "./planRestorePrompt";

const forceArchivedProject = {
  _id: "project-1",
  archivedAt: "2026-01-01T00:00:00.000Z",
  archivedReason: "plan_limit" as const,
};

describe("plan restore prompt eligibility", () => {
  it("does not prompt on ordinary Settings visits with archived resources", () => {
    const signature = restorePromptSignature(
      "pro",
      null,
      [forceArchivedProject],
      [],
      false,
    );

    expect(signature).toBeNull();
    expect(shouldShowRestorePrompt(true, signature, null)).toBe(false);
  });

  it("prompts for force-archived resources after enforced expiry and upgrade", () => {
    const signature = restorePromptSignature(
      "pro",
      null,
      [forceArchivedProject],
      [],
      true,
    );

    expect(signature).not.toBeNull();
    expect(shouldShowRestorePrompt(true, signature, null)).toBe(true);
  });

  it("does not prompt again after the current candidate signature is dismissed", () => {
    const signature = restorePromptSignature(
      "pro",
      null,
      [forceArchivedProject],
      [],
      true,
    );

    expect(shouldShowRestorePrompt(true, signature, signature)).toBe(false);
  });
});
