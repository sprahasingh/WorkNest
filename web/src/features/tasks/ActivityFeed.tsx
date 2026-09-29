import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { inputStyles } from "@/components/ui/Field";
import { parseApiError } from "@/lib/apiError";
import type { ActivityScope, ActivityType } from "./api";
import { useActivity, useCreateActivity } from "./queries";

const TYPE_LABELS: Record<ActivityType, string> = {
  update_request: "Update requested",
  update: "Update",
  question: "Question",
  reply: "Reply",
};

const TYPE_STYLES: Record<ActivityType, string> = {
  update_request:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  update: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  question:
    "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  reply: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

interface ActivityFeedProps {
  orgId: string;
  scope: ActivityScope;
  // Admins and managers: can request updates and reply.
  canLead: boolean;
  // Assignees: can post updates and ask questions.
  canContribute: boolean;
}

export function ActivityFeed({
  orgId,
  scope,
  canLead,
  canContribute,
}: ActivityFeedProps) {
  const { data: activities, isPending, isError } = useActivity(orgId, scope);
  const createActivity = useCreateActivity(orgId, scope);
  const [content, setContent] = useState("");
  const [contentError, setContentError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ActivityType | null>(null);

  const isProject = scope.kind === "project";
  const canPost = canLead || canContribute;
  const hasText = content.trim().length > 0;

  const post = async (type: ActivityType) => {
    setContentError(null);
    setPendingType(type);
    try {
      const result = await createActivity.mutateAsync({
        type,
        content: content.trim() || undefined,
      });
      setContent("");
      if (type === "update_request") {
        const count = result.notifiedCount;
        toast.success(
          isProject && count !== undefined
            ? `Update request sent to ${count} ${count === 1 ? "person" : "people"}`
            : "Update requested from the assignees",
        );
      } else {
        toast.success(
          type === "question" ? "Question sent to your managers" : "Posted",
        );
      }
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.fieldErrors.content) {
        setContentError(parsed.fieldErrors.content);
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setPendingType(null);
    }
  };

  const busy = createActivity.isPending;

  return (
    <div className="space-y-4">
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {isPending && (
          <div className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        )}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load activity.
          </p>
        )}
        {!isPending && !isError && activities.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {isProject
              ? "No project updates yet."
              : "No updates or questions on this task yet."}
          </p>
        )}
        {activities?.map((entry) => (
          <div key={entry._id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {entry.author?.name ?? "Former member"}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLES[entry.type]}`}
              >
                {TYPE_LABELS[entry.type]}
              </span>
              <span className="ml-auto text-xs text-slate-400">
                {new Date(entry.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
            {entry.content && (
              <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                {entry.content}
              </p>
            )}
          </div>
        ))}
      </div>

      {canPost ? (
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <label htmlFor={`activity-${scope.id}`} className="sr-only">
            Message
          </label>
          <textarea
            id={`activity-${scope.id}`}
            rows={3}
            placeholder={
              canContribute && !canLead
                ? "Share progress, or ask your manager a question…"
                : "Write a message (optional when requesting an update)…"
            }
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setContentError(null);
            }}
            maxLength={2000}
            className={inputStyles}
          />
          {contentError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {contentError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {canContribute && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void post("question")}
                  disabled={busy || !hasText}
                  loading={pendingType === "question"}
                >
                  Ask question
                </Button>
                <Button
                  type="button"
                  onClick={() => void post("update")}
                  disabled={busy || !hasText}
                  loading={pendingType === "update"}
                >
                  Post update
                </Button>
              </>
            )}
            {canLead && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void post("reply")}
                  disabled={busy || !hasText}
                  loading={pendingType === "reply"}
                >
                  Reply
                </Button>
                <Button
                  type="button"
                  onClick={() => void post("update_request")}
                  disabled={busy}
                  loading={pendingType === "update_request"}
                >
                  {isProject
                    ? "Request updates from all assignees"
                    : "Request update"}
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {canLead
              ? isProject
                ? "Requests notify everyone assigned to an open task in this project. Replies notify them too."
                : "Requests and replies notify this task's assignees."
              : "Updates and questions notify your admins and managers."}
          </p>
        </div>
      ) : (
        <p className="border-t border-slate-200 pt-4 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
          {isProject
            ? "Only people assigned to a task in this project, managers and admins can post here."
            : "Only this task's assignees, managers and admins can post here."}
        </p>
      )}
    </div>
  );
}
