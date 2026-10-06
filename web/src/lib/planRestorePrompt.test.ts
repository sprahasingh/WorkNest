import { beforeEach, describe, expect, it } from "vitest";
import {
  canReviewRestoreCandidates,
  persistHandledRestoreSignature,
  readHandledRestoreSignature,
  restorePromptSignature,
  shouldRenderRestorePrompt,
  shouldShowRestorePrompt,
} from "./planRestorePrompt";

const forceArchivedProject = {
  _id: "project-1",
  archivedAt: "2026-01-01T00:00:00.000Z",
  archivedReason: "plan_limit" as const,
};
const forceArchivedTask = {
  _id: "task-1",
  archivedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => localStorage.clear());

describe("plan restore prompt eligibility", () => {
  it("offers a paid plan with force-archived projects and active-project tasks", () => {
    const signature = restorePromptSignature(
      "org-1",
      "pro",
      [forceArchivedProject],
      [forceArchivedTask],
    );

    expect(signature).not.toBeNull();
    expect(shouldShowRestorePrompt(true, signature, null)).toBe(true);
  });

  it("does not offer a paid organization with no force-archived candidates", () => {
    expect(restorePromptSignature("org-1", "pro", [], [])).toBeNull();
  });

  it("does not offer candidates while the organization is on Free", () => {
    expect(
      restorePromptSignature(
        "org-1",
        "free",
        [forceArchivedProject],
        [forceArchivedTask],
      ),
    ).toBeNull();
  });

  it("excludes manually archived projects", () => {
    expect(
      restorePromptSignature("org-1", "pro", [
        { ...forceArchivedProject, archivedReason: null },
      ]),
    ).toBeNull();
  });

  it("uses persisted candidates after upgrade clears expiry markers and after reload", () => {
    // Eligibility is derived from durable candidate records and the paid plan,
    // not the expiry/grace timestamps that a successful upgrade clears.
    const beforeReload = restorePromptSignature("org-1", "pro", [
      forceArchivedProject,
    ]);
    const afterReload = restorePromptSignature("org-1", "pro", [
      { ...forceArchivedProject },
    ]);

    expect(afterReload).toBe(beforeReload);
    expect(shouldShowRestorePrompt(true, afterReload, null)).toBe(true);
  });

  it("stops offering resources after they are restored", () => {
    const restoredProject = {
      ...forceArchivedProject,
      archivedAt: null,
      archivedReason: null,
    };

    expect(
      restorePromptSignature("org-1", "pro", [restoredProject]),
    ).toBeNull();
    expect(restorePromptSignature("org-1", "pro", [], [])).toBeNull();
  });

  it("keeps capacity-blocked candidates eligible for another attempt", () => {
    const candidates = [forceArchivedProject];
    const firstAttempt = restorePromptSignature("org-1", "pro", candidates);
    const laterAttempt = restorePromptSignature("org-1", "pro", candidates);

    expect(laterAttempt).toBe(firstAttempt);
    expect(shouldShowRestorePrompt(true, laterAttempt, null)).toBe(true);
  });

  it("surfaces remaining candidates again after an upgrade with more capacity", () => {
    const dismissedPro = restorePromptSignature("org-1", "pro", [
      forceArchivedProject,
    ]);
    const upgradedPremium = restorePromptSignature("org-1", "premium", [
      forceArchivedProject,
    ]);

    expect(shouldShowRestorePrompt(true, upgradedPremium, dismissedPro)).toBe(
      true,
    );
  });

  it("keeps manual restoration available before and after Later and refresh", () => {
    const signature = restorePromptSignature("org-1", "pro", [
      forceArchivedProject,
    ]);
    expect(signature).not.toBeNull();
    expect(canReviewRestoreCandidates(true, signature)).toBe(true);
    expect(shouldShowRestorePrompt(true, signature, null)).toBe(true);

    persistHandledRestoreSignature("org-1", signature!);
    const reloadedDismissal = readHandledRestoreSignature("org-1");

    expect(shouldShowRestorePrompt(true, signature, reloadedDismissal)).toBe(
      false,
    );
    expect(
      shouldRenderRestorePrompt(true, signature, reloadedDismissal, false),
    ).toBe(false);
    expect(
      shouldRenderRestorePrompt(true, signature, reloadedDismissal, true),
    ).toBe(true);
    expect(canReviewRestoreCandidates(true, signature)).toBe(true);
    expect(canReviewRestoreCandidates(true, null)).toBe(false);
    expect(canReviewRestoreCandidates(false, signature)).toBe(false);
  });

  it("shows the manual action when only force-archived tasks remain", () => {
    const signature = restorePromptSignature(
      "org-1",
      "pro",
      [],
      [forceArchivedTask],
    );

    expect(signature).not.toBeNull();
    expect(canReviewRestoreCandidates(true, signature)).toBe(true);
  });

  it("does not show the manual action for manually archived resources alone", () => {
    const manualProject = {
      ...forceArchivedProject,
      archivedReason: null,
    };
    const signature = restorePromptSignature("org-1", "pro", [manualProject]);

    expect(signature).toBeNull();
    expect(canReviewRestoreCandidates(true, signature)).toBe(false);
  });

  it("keeps the manual action for capacity-blocked candidates and removes it after restoration", () => {
    const blockedSignature = restorePromptSignature("org-1", "pro", [
      forceArchivedProject,
    ]);
    expect(canReviewRestoreCandidates(true, blockedSignature)).toBe(true);

    const restored = restorePromptSignature("org-1", "pro", [
      { ...forceArchivedProject, archivedReason: null, archivedAt: null },
    ]);
    expect(canReviewRestoreCandidates(true, restored)).toBe(false);
  });
});
