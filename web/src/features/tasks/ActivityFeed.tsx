import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { parseApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatFullTime, formatRelativeTime } from "@/lib/time";
import type { ActivityScope, ActivityType, TaskActivity } from "./api";
import { ACTIVITY_BADGE_STYLES, ACTIVITY_LABELS } from "./activityTypes";
import { ActivityIcon } from "./ActivityIcon";
import {
  useActivity,
  useCreateActivity,
  useMarkAnswer,
  useRemindWaiting,
} from "./queries";
import { useMembers } from "@/features/members/queries";
import { useAuth } from "@/auth/auth-context";
import { MentionTextarea } from "./MentionTextarea";
import type { ActivityMentions } from "./MentionTextarea";
import { ActivityConfirmation } from "./ActivityConfirmation";

interface ActivityFeedProps {
  orgId: string;
  scope: ActivityScope;
  // Admins and managers: can also ask for updates.
  canLead: boolean;
  // People working on it: can post updates and ask questions.
  canContribute: boolean;
  // Task feeds: names of the people a message sent to all assignees reaches
  // (other assignees and whoever created the task).
  involvedNames?: string[];
  // Project feeds link each task update back to its task.
  onOpenTask?: (taskId: string) => void;
  // A message to scroll to and highlight, e.g. from a notification.
  focusId?: string | null;
}

const NO_MENTIONS: ActivityMentions = { memberIds: [], roles: [] };

// Matches the server: the requester can nudge people once an hour.
const REMIND_COOLDOWN_MS = 60 * 60 * 1000;

// "Mia", "Mia and Leo", "Mia, Leo and Sam", "Mia, Leo and 3 others".
function joinNames(names: string[], total = names.length): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, 3);
  const others = total - shown.length;
  if (others > 0) {
    return `${shown.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  }
  return shown.length === 1
    ? shown[0]!
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

interface Thread {
  root: TaskActivity;
  replies: TaskActivity[];
}

// Replies sit under the message that started their thread.
function toThreads(activities: TaskActivity[]): Thread[] {
  const ids = new Set(activities.map((entry) => entry._id));
  const threads: Thread[] = [];
  const byRoot = new Map<string, Thread>();
  for (const entry of activities) {
    if (entry.parentId && ids.has(entry.parentId)) continue;
    const thread: Thread = { root: entry, replies: [] };
    threads.push(thread);
    byRoot.set(entry._id, thread);
  }
  for (const entry of activities) {
    if (entry.parentId && byRoot.has(entry.parentId)) {
      byRoot.get(entry.parentId)!.replies.push(entry);
    }
  }
  return threads;
}

// Sent only to the people mentioned, so only they and the author can reply.
// Mirrors the server.
function isDirected(root: TaskActivity): boolean {
  return root.notifyAll === false && (root.mentionIds?.length ?? 0) > 0;
}

// A note posted without telling anyone.
function isQuiet(root: TaskActivity): boolean {
  return (
    root.notifyAll === false &&
    (root.mentionIds?.length ?? 0) === 0 &&
    root.type !== "update_request"
  );
}

// Everyone taking part in a thread: who started it, who it was sent to,
// and whoever replied or was mentioned since.
function participantsOf(thread: Thread): string[] {
  return [
    ...new Set([
      thread.root.authorId,
      ...(thread.root.mentionIds ?? []),
      ...(thread.root.askedIds ?? []),
      ...thread.replies.flatMap((reply) => [
        reply.authorId,
        ...(reply.mentionIds ?? []),
      ]),
    ]),
  ];
}

interface ReplyTarget {
  rootId: string;
  replyToId: string;
  // Who will be told.
  names: string[];
}

// The current time, refreshed every minute, for "reminded 5 min ago".
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ActivityFeed({
  orgId,
  scope,
  canLead,
  canContribute,
  involvedNames,
  onOpenTask,
  focusId,
}: ActivityFeedProps) {
  const { data: activities, isPending, isError } = useActivity(orgId, scope);
  const createActivity = useCreateActivity(orgId, scope);
  const markAnswer = useMarkAnswer(orgId, scope);
  const remindWaiting = useRemindWaiting(orgId, scope);
  const { data: members = [] } = useMembers(orgId);
  const { user } = useAuth();
  const now = useNow();
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<ActivityMentions>(NO_MENTIONS);
  // null follows the default: everyone, unless someone is @mentioned.
  const [notifyAllChoice, setNotifyAllChoice] = useState<boolean | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ActivityType | null>(null);
  const [confirmingRequest, setConfirmingRequest] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyMentions, setReplyMentions] =
    useState<ActivityMentions>(NO_MENTIONS);
  const [replyError, setReplyError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusedRef = useRef<string | null>(null);
  const checkboxId = useId();

  const isProject = scope.kind === "project";
  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId.id, m.userId.name])),
    [members],
  );
  const nameOf = (id: string) =>
    id === user?.id ? "you" : (memberNames.get(id) ?? "a former member");

  // Someone mentioned or asked here can join in even if not assigned.
  const isInvolved =
    !!user &&
    (activities ?? []).some(
      (a) => a.mentionIds?.includes(user.id) || a.askedIds?.includes(user.id),
    );
  const canPost = canLead || canContribute || isInvolved;
  const hasText = content.trim().length > 0;
  const threads = useMemo(() => toThreads(activities ?? []), [activities]);
  const entryCount = activities?.length ?? 0;

  const mentionCount = mentions.memberIds.length + mentions.roles.length;
  const notifyAll = notifyAllChoice ?? mentionCount === 0;
  const mentionedNames = [
    ...members
      .filter((member) => mentions.memberIds.includes(member.userId.id))
      .map((member) => member.userId.name),
    ...mentions.roles.map((role) =>
      role === "assignee"
        ? "the assignees"
        : `all ${role === "member" ? "members" : `${role}s`}`,
    ),
  ];
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

  // Newest entries are at the bottom; keep them in view as they arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entryCount]);

  // Opened from a notification: bring that message into view once.
  useEffect(() => {
    if (!focusId || focusedRef.current === focusId || entryCount === 0) return;
    const target = listRef.current?.querySelector(
      `[data-activity-id="${focusId}"]`,
    );
    if (!target) return;
    focusedRef.current = focusId;
    target.scrollIntoView({ block: "center" });
  }, [focusId, entryCount]);

  const announce = (
    type: ActivityType,
    count: number | undefined,
    names: string[] | undefined,
  ) => {
    if (count === 0) {
      toast.success(
        type === "reply" ? "Reply posted" : "Posted. Nobody was notified",
      );
      return;
    }
    const who =
      names && names.length > 0 && count !== undefined
        ? joinNames(names, count)
        : `${count} ${count === 1 ? "person" : "people"}`;
    toast.success(
      type === "update_request"
        ? `Update request sent to ${who}`
        : `Sent to ${who}`,
    );
  };

  const post = async (type: ActivityType) => {
    setContentError(null);
    setPendingType(type);
    try {
      const result = await createActivity.mutateAsync({
        type,
        content: content.trim() || undefined,
        mentionMemberIds: mentions.memberIds,
        mentionRoles: mentions.roles,
        notifyAll,
      });
      setContent("");
      setMentions(NO_MENTIONS);
      setNotifyAllChoice(null);
      setConfirmingRequest(false);
      announce(type, result.notifiedCount, result.notifiedNames);
    } catch (error) {
      const parsed = parseApiError(error);
      setConfirmingRequest(false);
      if (parsed.fieldErrors.content) {
        setContentError(parsed.fieldErrors.content);
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setPendingType(null);
    }
  };

  const sendReply = async () => {
    if (!replyTarget || !replyContent.trim()) return;
    setReplyError(null);
    setPendingType("reply");
    try {
      const result = await createActivity.mutateAsync({
        type: "reply",
        replyToId: replyTarget.replyToId,
        content: replyContent.trim(),
        mentionMemberIds: replyMentions.memberIds,
        mentionRoles: replyMentions.roles,
      });
      setReplyTarget(null);
      setReplyContent("");
      setReplyMentions(NO_MENTIONS);
      announce("reply", result.notifiedCount, result.notifiedNames);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.fieldErrors.content) {
        setReplyError(parsed.fieldErrors.content);
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setPendingType(null);
    }
  };

  // Who a reply reaches, matching the server: the person answered, whoever
  // started the thread and, except on update requests, everyone else in it.
  const startReply = (thread: Thread, target: TaskActivity) => {
    const ids = [
      target.authorId,
      thread.root.authorId,
      ...(thread.root.type === "update_request" ? [] : participantsOf(thread)),
    ];
    const names = [
      ...new Set(
        ids.filter((id) => id !== user?.id && memberNames.has(id)).map(nameOf),
      ),
    ];
    setReplyTarget({ rootId: thread.root._id, replyToId: target._id, names });
    setReplyContent("");
    setReplyMentions(NO_MENTIONS);
    setReplyError(null);
  };

  // An update request this person was asked and hasn't answered yet.
  const waitingOnMe = (thread: Thread) =>
    !!user &&
    thread.root.type === "update_request" &&
    !!thread.root.askedIds?.includes(user.id) &&
    !thread.replies.some((reply) => reply.authorId === user.id);

  const canReplyIn = (thread: Thread) => {
    if (!user) return false;
    const inThread = participantsOf(thread).includes(user.id);
    return isDirected(thread.root) ? inThread : canPost || inThread;
  };

  const handleMarkAnswer = (thread: Thread, answerId: string | null) => {
    markAnswer.mutate(
      { questionId: thread.root._id, answerId },
      {
        onSuccess: () =>
          toast.success(answerId ? "Marked as the answer" : "Answer cleared"),
        onError: (error) => toast.error(parseApiError(error).message),
      },
    );
  };

  const handleRemind = (thread: Thread) => {
    remindWaiting.mutate(thread.root._id, {
      onSuccess: (result) =>
        toast.success(
          `Reminder sent to ${joinNames(result.notifiedNames, result.notifiedCount)}`,
        ),
      onError: (error) => toast.error(parseApiError(error).message),
    });
  };

  const busy = createActivity.isPending;
  const everyoneLabel = isProject
    ? "everyone working on this project"
    : involvedNames && involvedNames.length > 0
      ? joinNames(involvedNames)
      : null;
  let audienceLine: string;
  if (notifyAll) {
    if (everyoneLabel && mentionCount > 0) {
      audienceLine = `Notifies ${everyoneLabel}, plus ${joinNames(mentionedNames)}`;
    } else if (everyoneLabel) {
      audienceLine = `Notifies ${everyoneLabel} · @mention someone to send it only to them`;
    } else if (mentionCount > 0) {
      audienceLine = `Notifies ${joinNames(mentionedNames)}`;
    } else {
      audienceLine =
        "Nobody else is on this task yet · @mention someone so they see it";
    }
  } else if (mentionCount > 0) {
    audienceLine = `Only ${joinNames(mentionedNames)} will be notified and can reply`;
  } else {
    audienceLine = "Posts quietly. Nobody is notified";
  }
  const requestNeedsSomeone = !notifyAll && mentionCount === 0;

  const renderEntry = (
    entry: TaskActivity,
    thread: Thread,
    { isReply }: { isReply: boolean },
  ) => {
    const answering =
      isReply && entry.replyToId && entry.replyToId !== thread.root._id
        ? thread.replies.find((reply) => reply._id === entry.replyToId)
        : undefined;
    const root = thread.root;
    const isQuestion = root.type === "question";
    const isAnswer = isReply && isQuestion && root.answerId === entry._id;
    const iAsked = !!user && isQuestion && root.authorId === user.id;
    const answeredByOthers = thread.replies.some(
      (reply) => reply.authorId !== root.authorId,
    );
    return (
      <div
        data-activity-id={entry._id}
        className={cn(
          "flex gap-3 text-sm",
          focusId === entry._id && "flash-highlight",
        )}
      >
        {isReply ? (
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              isAnswer
                ? "bg-emerald-500 dark:bg-emerald-400"
                : "bg-sky-400 dark:bg-sky-500",
            )}
          />
        ) : (
          <ActivityIcon type={entry.type} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {entry.author?.name ?? "Former member"}
            </span>
            {!isReply && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs font-medium",
                  ACTIVITY_BADGE_STYLES[entry.type],
                )}
              >
                {ACTIVITY_LABELS[entry.type]}
              </span>
            )}
            {!isReply &&
              isQuestion &&
              (root.answerId &&
              thread.replies.some((reply) => reply._id === root.answerId) ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  ✓ Answered
                </span>
              ) : (
                !answeredByOthers && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    Unanswered
                  </span>
                )
              ))}
            {isAnswer && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                ✓ Answer
              </span>
            )}
            {answering && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                to {answering.author?.name ?? "a former member"}
              </span>
            )}
            <time
              dateTime={entry.createdAt}
              title={formatFullTime(entry.createdAt)}
              className="ml-auto text-xs text-slate-400"
            >
              {formatRelativeTime(entry.createdAt)}
            </time>
          </div>
          {!isReply && (isProject || isDirected(entry) || isQuiet(entry)) && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {isProject &&
                (entry.task ? (
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
                ))}
              {isProject && (isDirected(entry) || isQuiet(entry)) && " · "}
              {isDirected(entry)
                ? `${isProject ? "sent" : "Sent"} to ${joinNames((entry.mentionIds ?? []).map(nameOf))} only`
                : isQuiet(entry)
                  ? `${isProject ? "posted" : "Posted"} quietly, nobody was notified`
                  : null}
            </p>
          )}
          {entry.content && (
            <p className="mt-1 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">
              {entry.content}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3">
            {canReplyIn(thread) && !(waitingOnMe(thread) && !isReply) && (
              <button
                type="button"
                onClick={() => startReply(thread, entry)}
                className="text-xs font-medium text-slate-500 hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-400"
              >
                Reply
              </button>
            )}
            {isReply && iAsked && (
              <button
                type="button"
                onClick={() =>
                  handleMarkAnswer(thread, isAnswer ? null : entry._id)
                }
                disabled={markAnswer.isPending}
                className="text-xs font-medium text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-400"
              >
                {isAnswer ? "Not the answer" : "Mark as answer"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRequestStatus = (thread: Thread) => {
    // Only people still in the workspace can reply.
    const asked = (thread.root.askedIds ?? []).filter(
      (id) => memberNames.has(id) || id === user?.id,
    );
    if (thread.root.type !== "update_request" || asked.length === 0) {
      return null;
    }
    const repliedIds = new Set(thread.replies.map((reply) => reply.authorId));
    const replied = asked.filter((id) => repliedIds.has(id));
    const waiting = asked.filter((id) => !repliedIds.has(id));
    const isRequester = !!user && thread.root.authorId === user.id;
    const remindedAt = thread.root.remindedAt
      ? new Date(thread.root.remindedAt).getTime()
      : null;
    const coolingDown =
      remindedAt !== null && now - remindedAt < REMIND_COOLDOWN_MS;
    return (
      <div className="ml-11 mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {replied.map((id) => (
          <span
            key={id}
            className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
          >
            ✓ {nameOf(id)}
          </span>
        ))}
        {waiting.map((id) => (
          <span
            key={id}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          >
            Waiting on {nameOf(id)}
          </span>
        ))}
        {isRequester && canLead && waiting.length > 0 && (
          <button
            type="button"
            onClick={() => handleRemind(thread)}
            disabled={coolingDown || remindWaiting.isPending}
            title={
              coolingDown
                ? "You can send another reminder an hour after the last one"
                : `Notify ${joinNames(waiting.map(nameOf))} again. People who replied aren't notified.`
            }
            className="rounded-full px-2 py-0.5 font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent dark:text-teal-400 dark:hover:bg-teal-950/40 dark:disabled:text-slate-500"
          >
            {coolingDown && thread.root.remindedAt
              ? `Reminded ${formatRelativeTime(thread.root.remindedAt)}`
              : waiting.length === 1
                ? `Remind ${nameOf(waiting[0]!)}`
                : `Remind ${waiting.length} people`}
          </button>
        )}
      </div>
    );
  };

  const renderReplyBox = (thread: Thread) => {
    if (replyTarget?.rootId !== thread.root._id) return null;
    const answering =
      replyTarget.replyToId === thread.root._id
        ? thread.root
        : thread.replies.find((reply) => reply._id === replyTarget.replyToId);
    return (
      <div className="ml-11 mt-2 space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/30">
        <label
          htmlFor={`reply-${thread.root._id}`}
          className="block text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          Replying to {answering?.author?.name ?? "this message"}
        </label>
        <MentionTextarea
          id={`reply-${thread.root._id}`}
          rows={2}
          placeholder="Write a reply… Use @ to bring someone in"
          value={replyContent}
          onChange={(value) => {
            setReplyContent(value);
            setReplyError(null);
          }}
          members={members}
          mentions={replyMentions}
          onMentionsChange={setReplyMentions}
          allowRoleMentions={canLead}
        />
        {replyError && (
          <p className="text-sm text-red-600 dark:text-red-400">{replyError}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {replyTarget.names.length > 0
              ? `Notifies ${joinNames(replyTarget.names)}`
              : "Adds to the thread"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setReplyTarget(null)}
              className="px-3 py-1.5 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void sendReply()}
              disabled={busy || !replyContent.trim()}
              loading={pendingType === "reply"}
              className="px-3 py-1.5 text-xs"
            >
              Send reply
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Shown under a thread that's between particular people, to everyone else.
  const renderClosedNote = (thread: Thread) => {
    if (!isDirected(thread.root) || canReplyIn(thread)) return null;
    const names = participantsOf(thread)
      .filter((id) => memberNames.has(id))
      .map(nameOf);
    return (
      <p className="ml-11 mt-2 text-xs text-slate-400 dark:text-slate-500">
        Only {joinNames(names)} can reply here
      </p>
    );
  };

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
            "space-y-5 overflow-y-auto px-1.5 pt-1.5",
            isProject ? "max-h-[50vh]" : "max-h-80",
          )}
        >
          {threads.map((thread) => (
            <li key={thread.root._id}>
              {renderEntry(thread.root, thread, { isReply: false })}
              {renderRequestStatus(thread)}
              {thread.replies.length > 0 && (
                <ol
                  aria-label="Replies"
                  className="ml-11 mt-3 space-y-3 border-l-2 border-slate-100 pl-3 dark:border-slate-700"
                >
                  {thread.replies.map((reply) => (
                    <li key={reply._id}>
                      {renderEntry(reply, thread, { isReply: true })}
                    </li>
                  ))}
                </ol>
              )}
              {waitingOnMe(thread) &&
                replyTarget?.rootId !== thread.root._id && (
                  <div className="ml-11 mt-3">
                    <Button
                      type="button"
                      onClick={() => startReply(thread, thread.root)}
                      className="px-3 py-1.5 text-xs"
                    >
                      Reply to this request
                    </Button>
                  </div>
                )}
              {renderClosedNote(thread)}
              {renderReplyBox(thread)}
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
                ? "Share an update or ask a question… Use @ to send it to someone"
                : "Share your progress, or ask a question… Use @ to send it to someone"
            }
            value={content}
            onChange={(value) => {
              setContent(value);
              setContentError(null);
            }}
            members={members}
            mentions={mentions}
            onMentionsChange={setMentions}
            allowRoleMentions={canLead}
          />
          {contentError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {contentError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label
              htmlFor={checkboxId}
              className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={notifyAll}
                onChange={(event) => setNotifyAllChoice(event.target.checked)}
                className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800"
              />
              All assignees
            </label>
            <p className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">
              {audienceLine}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
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
              variant={canLead ? "secondary" : "primary"}
              onClick={() => void post("update")}
              disabled={busy || !hasText}
              loading={pendingType === "update"}
            >
              Post update
            </Button>
            {canLead && (
              <Button
                type="button"
                onClick={() => setConfirmingRequest(true)}
                disabled={busy || requestNeedsSomeone}
                title={
                  requestNeedsSomeone
                    ? "Mention who you're asking, or tick All assignees"
                    : undefined
                }
                loading={pendingType === "update_request"}
              >
                Request update
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {isProject
            ? "Only people working on this project, managers and admins can post here."
            : "Only this task's assignees, managers and admins can post here."}
        </p>
      )}
      <ActivityConfirmation
        open={confirmingRequest}
        title="Send update request?"
        message={
          notifyAll
            ? `This asks ${
                isProject
                  ? "everyone assigned to an open task in this project"
                  : "this task's assignees"
              }${mentionCount > 0 ? " and the people you mentioned" : ""} for an update. Each person can reply to it, and you'll see who has replied and who hasn't.`
            : `This asks only ${joinNames(mentionedNames)} for an update. You'll see who has replied and who hasn't.`
        }
        mentions={mentionedLabels}
        confirmLabel="Send request"
        isPending={pendingType === "update_request"}
        onCancel={() => setConfirmingRequest(false)}
        onConfirm={() => void post("update_request")}
      />
    </div>
  );
}
