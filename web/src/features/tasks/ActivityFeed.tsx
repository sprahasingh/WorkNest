import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { parseApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatFullTime, formatRelativeTime } from "@/lib/time";
import type { ActivityScope, ActivityType } from "./api";
import { ACTIVITY_BADGE_STYLES, ACTIVITY_LABELS } from "./activityTypes";
import { ActivityIcon } from "./ActivityIcon";
import { useActivity, useCreateActivity } from "./queries";
import { useMembers } from "@/features/members/queries";
import { MentionTextarea } from "./MentionTextarea";
import type { ActivityMentions } from "./MentionTextarea";
import { ActivityConfirmation } from "./ActivityConfirmation";

interface ActivityFeedProps {
  orgId: string;
  scope: ActivityScope;
  // Admins and managers: can request updates and reply.
  canLead: boolean;
  // Assignees: can post updates and ask questions.
  canContribute: boolean;
  // Project feeds link each task update back to its task.
  onOpenTask?: (taskId: string) => void;
}

export function ActivityFeed({
  orgId,
  scope,
  canLead,
  canContribute,
  onOpenTask,
}: ActivityFeedProps) {
  const { data: activities, isPending, isError } = useActivity(orgId, scope);
  const createActivity = useCreateActivity(orgId, scope);
  const { data: members = [] } = useMembers(orgId);
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<ActivityMentions>({
    memberIds: [],
    roles: [],
  });
  const [contentError, setContentError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ActivityType | null>(null);
  const [pendingSend, setPendingSend] = useState<{
    type: ActivityType;
    content?: string;
    mentionMemberIds: string[];
    mentionRoles: ActivityMentions["roles"];
  } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const isProject = scope.kind === "project";
  const canPost = canLead || canContribute;
  const hasText = content.trim().length > 0;
  const entryCount = activities?.length ?? 0;

  // Newest entries are at the bottom; keep them in view as they arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entryCount]);

  const preparePost = (type: ActivityType) => {
    setPendingSend({
      type,
      content: content.trim() || undefined,
      mentionMemberIds: mentions.memberIds,
      mentionRoles: mentions.roles,
    });
  };

  const post = async () => {
    if (!pendingSend) return;
    const sentType = pendingSend.type;
    setContentError(null);
    setPendingType(sentType);
    try {
      const result = await createActivity.mutateAsync({
        ...pendingSend,
      });
      setContent("");
      setMentions({ memberIds: [], roles: [] });
      setPendingSend(null);
      const count = result.notifiedCount;
      const successMessages: Record<ActivityType, string> = {
        update_request:
          count !== undefined
            ? `Update request sent to ${count} ${count === 1 ? "person" : "people"}`
            : "Update request sent",
        update: "Update posted",
        question: "Question sent",
        reply: "Reply posted",
      };
      toast.success(successMessages[sentType]);
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

  const mentionedLabels = [
    ...members
      .filter((member) => mentions.memberIds.includes(member.userId.id))
      .map((member) => `${member.userId.name} (${member.userId.email})`),
    ...mentions.roles.map((role) =>
      role === "assignee"
        ? "Task assignees"
        : `All ${role === "member" ? "members" : `${role}s`}`,
    ),
  ];
  const isUpdateRequest = pendingSend?.type === "update_request";
  const confirmationAudience = isUpdateRequest
    ? isProject
      ? "the assignees of open tasks in this project"
      : "the assignees of this task"
    : pendingSend?.type === "reply"
      ? isProject
        ? "the assignees of open tasks in this project"
        : "the assignees of this task"
      : isProject
        ? "the admins and managers of this workspace"
        : "the admins, managers and assignees of this task";
  const confirmationMessage = isUpdateRequest
    ? `This request will ask ${confirmationAudience} for an update.`
    : `This ${pendingSend?.type ?? "message"} will be sent to ${confirmationAudience}.`;

  const busy = createActivity.isPending;
  const audienceHint = canLead
    ? isProject
      ? "Requests and replies notify other people assigned to open tasks; you won't be notified about your own request."
      : "Requests and replies notify this task's other assignees; you won't be notified about your own request."
    : isProject
      ? "Updates and questions notify your admins and managers."
      : "Updates and questions notify your admins, managers and anyone else on this task.";

  return (
    <div className="space-y-4">
      {isPending && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/60"
            />
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load updates.
        </p>
      )}
      {!isPending && !isError && entryCount === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            No updates yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isProject
              ? "Update requests, progress updates and questions from this project will appear here."
              : "Update requests, progress updates and questions about this task will appear here."}
          </p>
        </div>
      )}
      {entryCount > 0 && (
        <ol
          ref={listRef}
          aria-label="Updates"
          className={cn(
            "space-y-4 overflow-y-auto pr-1",
            isProject ? "max-h-[45vh]" : "max-h-72",
          )}
        >
          {activities!.map((entry) => (
            <li key={entry._id} className="flex gap-3 text-sm">
              <ActivityIcon type={entry.type} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {entry.author?.name ?? "Former member"}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      ACTIVITY_BADGE_STYLES[entry.type],
                    )}
                  >
                    {ACTIVITY_LABELS[entry.type]}
                  </span>
                  <time
                    dateTime={entry.createdAt}
                    title={formatFullTime(entry.createdAt)}
                    className="ml-auto text-xs text-slate-400"
                  >
                    {formatRelativeTime(entry.createdAt)}
                  </time>
                </div>
                {isProject && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {entry.task ? (
                      <>
                        on{" "}
                        <button
                          type="button"
                          onClick={() => onOpenTask?.(entry.task!._id)}
                          className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                        >
                          {entry.task.title}
                        </button>
                      </>
                    ) : (
                      "to the whole project"
                    )}
                  </p>
                )}
                {entry.content && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">
                    {entry.content}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {canPost ? (
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <label
            htmlFor={`activity-${scope.kind}-${scope.id}`}
            className="sr-only"
          >
            Message
          </label>
          <MentionTextarea
            id={`activity-${scope.kind}-${scope.id}`}
            rows={3}
            placeholder={
              canLead
                ? "Add a note (optional when requesting an update)… Use @ to mention someone"
                : "Share your progress, or ask a question… Use @ to mention someone"
            }
            value={content}
            onChange={(value) => {
              setContent(value);
              setContentError(null);
            }}
            members={members}
            mentions={mentions}
            onMentionsChange={setMentions}
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
                  onClick={() => preparePost("question")}
                  disabled={busy || !hasText}
                  loading={pendingType === "question"}
                >
                  Ask question
                </Button>
                <Button
                  type="button"
                  onClick={() => preparePost("update")}
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
                  onClick={() => preparePost("reply")}
                  disabled={busy || !hasText}
                  loading={pendingType === "reply"}
                >
                  Reply
                </Button>
                <Button
                  type="button"
                  onClick={() => preparePost("update_request")}
                  disabled={busy}
                  loading={pendingType === "update_request"}
                >
                  {isProject
                    ? "Request updates from everyone"
                    : "Request update"}
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {audienceHint}
          </p>
        </div>
      ) : (
        <p className="border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {isProject
            ? "Only people assigned to a task in this project, managers and admins can post here."
            : "Only this task's assignees, managers and admins can post here."}
        </p>
      )}
      <ActivityConfirmation
        open={pendingSend !== null}
        title={isUpdateRequest ? "Send update request?" : "Send activity?"}
        message={confirmationMessage}
        mentions={mentionedLabels}
        confirmLabel={isUpdateRequest ? "Send request" : "Send"}
        isPending={busy}
        onCancel={() => setPendingSend(null)}
        onConfirm={() => void post()}
      />
    </div>
  );
}
