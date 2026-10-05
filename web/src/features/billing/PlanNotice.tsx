import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails } from "@/features/org/queries";
import { PLAN_NAMES } from "@/lib/plans";

const DISMISS_KEY = "worknest:plan-expired-dismissed";
const ARCHIVED_DISMISS_KEY = "worknest:plan-archived-dismissed";

function readDismissed(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Tells people when their paid plan ended, and when the account is locked
// because it uses more than the current plan allows.
export function PlanNotice() {
  const { orgId } = useOrg();
  const canChangePlan = useCan("plan:change");
  const { data: org, refetch } = useOrgDetails(orgId);
  const location = useLocation();
  const [now] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(() => readDismissed(DISMISS_KEY));
  const [archivedDismissed, setArchivedDismissed] = useState(() =>
    readDismissed(ARCHIVED_DISMISS_KEY),
  );

  // Deleting or archiving can lift the lock, so look again as people move
  // around.
  useEffect(() => {
    void refetch();
  }, [location.pathname, refetch]);

  if (!org) return null;
  const settingsPath = `/orgs/${orgId}/settings`;
  const usage = org.usage;

  const parts: string[] = [];
  if (usage?.overLimit) {
    if (usage.projectCount > usage.projectLimit) {
      parts.push(
        `${usage.projectCount} active projects (${PLAN_NAMES[org.plan]} allows ${usage.projectLimit})`,
      );
    }
    if (usage.projectsOverTaskLimit > 0 && usage.activeTaskLimit !== null) {
      parts.push(
        `${usage.projectsOverTaskLimit} ${
          usage.projectsOverTaskLimit === 1 ? "project has" : "projects have"
        } more than ${usage.activeTaskLimit} active tasks`,
      );
    }
    if (usage.seatsUsed > usage.seatLimit) {
      parts.push(
        `${usage.seatsUsed} seats used (${PLAN_NAMES[org.plan]} allows ${usage.seatLimit})`,
      );
    }
  }

  if (usage?.inGrace && usage.overLimit && usage.graceEndsAt) {
    const endsAt = new Date(usage.graceEndsAt);
    const daysLeft = Math.max(
      1,
      Math.ceil((endsAt.getTime() - now) / 86_400_000),
    );
    return (
      <div
        role="alert"
        className="border-b border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-100"
      >
        <p className="font-semibold">
          Your {org.planExpiredFrom ? PLAN_NAMES[org.planExpiredFrom] : "paid"}{" "}
          plan has ended. {daysLeft} {daysLeft === 1 ? "day" : "days"} left to
          renew or reduce usage.
        </p>
        <p className="mt-1">
          Right now: {parts.join("; ")}. On{" "}
          {endsAt.toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          , the least recently active projects and tasks over the{" "}
          {PLAN_NAMES[org.plan]} limits are archived. Nothing is deleted, and
          you can restore them once there is room. Until then nothing new can be
          added, but you can edit, finish, archive and delete.{" "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              Renew your plan
            </Link>
          ) : (
            "Ask an admin to renew the plan."
          )}
        </p>
      </div>
    );
  }

  if (usage?.paused) {
    return (
      <div
        role="alert"
        className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      >
        <p className="font-semibold">
          Your account is paused: it is over the {PLAN_NAMES[org.plan]} plan
          limits.
        </p>
        <p className="mt-1">
          Right now: {parts.join("; ")}. You can still look around, and delete
          or archive the extra projects or tasks. To keep using WorkNest, either
          remove them or{" "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              upgrade your plan
            </Link>
          ) : (
            "ask an admin to upgrade the plan"
          )}
          .
        </p>
      </div>
    );
  }

  const archivedCount =
    (org.graceArchived?.projects ?? 0) + (org.graceArchived?.tasks ?? 0);
  if (
    org.graceEnforcedAt &&
    archivedCount > 0 &&
    org.graceEnforcedAt !== archivedDismissed
  ) {
    const archivedAt = org.graceEnforcedAt;
    const summary = [
      org.graceArchived!.projects > 0
        ? `${org.graceArchived!.projects} ${
            org.graceArchived!.projects === 1 ? "project" : "projects"
          }`
        : null,
      org.graceArchived!.tasks > 0
        ? `${org.graceArchived!.tasks} ${
            org.graceArchived!.tasks === 1 ? "task" : "tasks"
          }`
        : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return (
      <div
        role="status"
        className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <p>
          The grace period after your plan ended is over, so {summary} over the{" "}
          {PLAN_NAMES[org.plan]} limits {archivedCount === 1 ? "was" : "were"}{" "}
          archived. Nothing was deleted. After you{" "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              renew your plan
            </Link>
          ) : (
            "renew the plan"
          )}
          , restore them from Archived.
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(ARCHIVED_DISMISS_KEY, archivedAt);
            } catch {
              // Not being able to remember it just means it shows again.
            }
            setArchivedDismissed(archivedAt);
          }}
          className="shrink-0 font-medium underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (org.planExpiredAt && org.planExpiredAt !== dismissed) {
    const dismiss = () => {
      try {
        localStorage.setItem(DISMISS_KEY, org.planExpiredAt!);
      } catch {
        // Not being able to remember it just means it shows again.
      }
      setDismissed(org.planExpiredAt);
    };
    return (
      <div
        role="status"
        className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <p>
          Your {org.planExpiredFrom ? PLAN_NAMES[org.planExpiredFrom] : "paid"}{" "}
          plan has ended, so this workspace is back on Free.{" "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              Choose a plan
            </Link>
          ) : (
            "Ask an admin to choose a plan"
          )}{" "}
          to get your higher limits back.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 font-medium underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
