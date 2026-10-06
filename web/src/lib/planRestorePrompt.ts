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
  plan: string,
  planExpiresAt: string | null,
  projects: RestoreCandidate[],
  tasks: RestoreTaskCandidate[] = [],
  restoreEligible = true,
): string | null {
  // Only grace enforcement creates resources eligible for the post-upgrade
  // review. Archived records can also be old, manually archived or stale
  // cached query data, so their presence alone is never sufficient.
  if (!restoreEligible) return null;
  const eligible = eligibleRestoreCandidates(projects);
  if (plan === "free" || (eligible.length === 0 && tasks.length === 0))
    return null;
  return `${plan}:${planExpiresAt ?? "no-expiry"}:${eligible
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
