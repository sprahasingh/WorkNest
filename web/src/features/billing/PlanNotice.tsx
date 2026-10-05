import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails } from "@/features/org/queries";
import { PLAN_NAMES } from "@/lib/plans";

const DISMISS_KEY = "worknest:plan-expired-dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
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
  const [dismissed, setDismissed] = useState(readDismissed);

  // Deleting or archiving can lift the lock, so look again as people move
  // around.
  useEffect(() => {
    void refetch();
  }, [location.pathname, refetch]);

  if (!org) return null;
  const settingsPath = `/orgs/${orgId}/settings`;
  const usage = org.usage;

  if (usage?.overLimit) {
    const parts: string[] = [];
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
