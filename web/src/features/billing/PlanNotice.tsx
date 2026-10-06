import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useOrgDetails } from "@/features/org/queries";
import { PLAN_NAMES } from "@/lib/plans";
import { InfoButton, InfoPanel } from "@/components/ui/InfoToggle";

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
  const restrictionInfoId = useId();
  const [restrictionInfoOpen, setRestrictionInfoOpen] = useState(false);

  // Deleting or archiving can lift the lock, so look again as people move
  // around.
  useEffect(() => {
    void refetch();
  }, [location.pathname, refetch]);

  if (!org) return null;
  const settingsPath = `/orgs/${orgId}/settings#plan`;
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
        } more than ${usage.activeTaskLimit} open tasks`,
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
        <div className="flex items-center gap-1">
          <p className="font-semibold">
            Your plan expired: {daysLeft} {daysLeft === 1 ? "day" : "days"} left
            in the grace period. Your workspace is over the Free plan limits.
          </p>
          <InfoButton
            open={restrictionInfoOpen}
            onToggle={() => setRestrictionInfoOpen((open) => !open)}
            label="About plan limits during grace"
            controls={restrictionInfoId}
            className="text-orange-900 dark:text-orange-100"
          />
        </div>
        <InfoPanel
          id={restrictionInfoId}
          open={restrictionInfoOpen}
          onClose={() => setRestrictionInfoOpen(false)}
          className="bg-orange-100/70 text-orange-950 ring-orange-200 dark:bg-orange-900/40 dark:text-orange-100 dark:ring-orange-800"
        >
          <p>Current usage: {parts.join("; ")}.</p>
          <p className="mt-1">
            New projects, tasks, and invites that would increase an over-limit
            total are blocked. You can still edit, complete, archive, delete,
            and renew. When the grace period ends, excess active projects and
            open tasks are archived automatically. Members are never removed,
            and no data is deleted.
          </p>
          <p className="mt-1">
            The grace period ends{" "}
            {endsAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            .
          </p>
        </InfoPanel>
        <p className="mt-1">
          Clean up usage or{" "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              renew your plan
            </Link>
          ) : (
            "ask an admin to renew the plan"
          )}
          .
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
        <div className="flex items-center gap-1">
          <p className="font-semibold">
            Workspace restricted:{" "}
            {[
              usage.projectCount > usage.projectLimit && "project",
              usage.projectsOverTaskLimit > 0 && "task",
              usage.seatsUsed > usage.seatLimit && "member",
            ]
              .filter(Boolean)
              .map((item) => `${item} limits`)
              .join(" and ")}{" "}
            exceeded.
          </p>
          <InfoButton
            open={restrictionInfoOpen}
            onToggle={() => setRestrictionInfoOpen((open) => !open)}
            label="Why is this workspace restricted?"
            controls={restrictionInfoId}
            className="text-red-900 dark:text-red-100"
          />
        </div>
        <InfoPanel
          id={restrictionInfoId}
          open={restrictionInfoOpen}
          onClose={() => setRestrictionInfoOpen(false)}
          className="bg-red-100/70 text-red-950 ring-red-200 dark:bg-red-900/40 dark:text-red-100 dark:ring-red-800"
        >
          <ul className="list-disc space-y-1 pl-4">
            {usage.projectCount > usage.projectLimit && (
              <li>
                Projects: {usage.projectCount} active (limit{" "}
                {usage.projectLimit}; {usage.projectCount - usage.projectLimit}{" "}
                over).
              </li>
            )}
            {usage.taskLimitOverages.map((overage) => (
              <li key={overage.projectId}>
                Tasks in {overage.projectName}: {overage.activeCount} open
                (limit {overage.limit}; {overage.activeCount - overage.limit}{" "}
                over).
              </li>
            ))}
            {usage.seatsUsed > usage.seatLimit && (
              <li>
                Members: {usage.seatsUsed} (limit {usage.seatLimit};{" "}
                {usage.seatsUsed - usage.seatLimit} over).
              </li>
            )}
          </ul>
          <p className="mt-2">
            When the grace period ends, excess projects and open tasks are
            archived automatically. If project or task limits are still
            exceeded, archive or remove enough work to meet them. An admin must
            remove extra members; members are never removed automatically.
            Renewing restores the higher plan limits.
          </p>
        </InfoPanel>
        <p className="mt-1">
          {usage.seatsUsed > usage.seatLimit
            ? "An admin must remove extra members or renew the plan. "
            : "Archive or remove excess work, or renew the plan. "}
          {canChangePlan ? (
            <Link to={settingsPath} className="font-medium underline">
              View plans
            </Link>
          ) : (
            "Ask an admin to view plans."
          )}
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
          The grace period after your plan ended has ended. {summary} that
          exceeded the {PLAN_NAMES[org.plan]} plan limits{" "}
          {archivedCount === 1 ? "was" : "were"} archived. No data was deleted.
          After upgrading, use Review &amp; Restore to choose eligible projects
          to restore. You can restore eligible tasks from the Archived list when
          your plan has capacity.
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
