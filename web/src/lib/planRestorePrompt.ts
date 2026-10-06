import type { Role } from "@/api/auth";

export interface RestoreCandidate {
  _id: string;
  archivedAt: string | null;
  archivedReason?: "plan_limit" | null;
}

export interface RestoreTaskCandidate {
  _id: string;
  archivedAt: string | null;
}

export function eligibleRestoreCandidates<T extends RestoreCandidate>(
  projects: T[],
): T[] {
  return projects.filter((project) => project.archivedReason === "plan_limit");
}

export function restorePromptSignature(
  orgId: string,
  plan: string,
  projects: RestoreCandidate[],
  tasks: RestoreTaskCandidate[] = [],
): string | null {
  // Only grace enforcement sets archivedReason to plan_limit. The expiry and
  // enforcement timestamps are cleared when a paid plan is purchased, so the
  // force-archived candidates themselves must drive post-upgrade eligibility.
  const eligible = eligibleRestoreCandidates(projects);
  if (plan === "free" || (eligible.length === 0 && tasks.length === 0))
    return null;
  return `${orgId}:${plan}:${eligible
    .map((project) => `${project._id}:${project.archivedAt ?? ""}`)
    .sort()
    .join(",")}:tasks:${tasks
    .map((task) => `${task._id}:${task.archivedAt ?? ""}`)
    .sort()
    .join(",")}`;
}

export function shouldShowRestorePrompt(
  canChangePlan: boolean,
  signature: string | null,
  handledSignature: string | null,
): boolean {
  return canChangePlan && signature !== null && signature !== handledSignature;
}

export function shouldRenderRestorePrompt(
  canChangePlan: boolean,
  signature: string | null,
  handledSignature: string | null,
  manuallyRequested: boolean,
): boolean {
  return (
    canChangePlan &&
    signature !== null &&
    (manuallyRequested ||
      shouldShowRestorePrompt(canChangePlan, signature, handledSignature))
  );
}

export function canReviewRestoreCandidates(
  canChangePlan: boolean,
  signature: string | null,
): boolean {
  return canChangePlan && signature !== null;
}

function restorePromptStorageKey(orgId: string) {
  return `worknest:restore-prompt:${orgId}`;
}

export function readHandledRestoreSignature(orgId: string): string | null {
  try {
    return window.localStorage.getItem(restorePromptStorageKey(orgId));
  } catch {
    return null;
  }
}

export function persistHandledRestoreSignature(
  orgId: string,
  signature: string,
): void {
  try {
    window.localStorage.setItem(restorePromptStorageKey(orgId), signature);
  } catch {
    // State still suppresses the prompt for the current visit if storage fails.
  }
}

export function taskViewAfterUnarchive(
  status: "todo" | "in_progress" | "done",
) {
  return status === "done" ? "completed" : "active";
}

export function roleVisibleSteps<T extends { roles?: readonly Role[] }>(
  steps: T[],
  role: Role,
): T[] {
  return steps.filter((step) => !step.roles || step.roles.includes(role));
}
