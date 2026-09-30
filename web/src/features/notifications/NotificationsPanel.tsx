import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { cn } from "@/lib/cn";
import {
  formatDateInTimeZone,
  formatFullTime,
  formatRelativeTime,
} from "@/lib/time";
import { useOrgDetails } from "@/features/org/queries";
import { ActivityIcon } from "@/features/tasks/ActivityIcon";
import {
  isTaskReminder,
  notificationLink,
  type Notification,
  type NotificationStatus,
} from "./api";
import {
  useDismissNotifications,
  useMarkNotificationsRead,
  useNotifications,
} from "./queries";
import { useMyInvites } from "@/features/invites/myInvites";
import { MyInvitations } from "@/features/invites/MyInvitations";

const TABS: { value: NotificationStatus; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "all", label: "All" },
];

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationsPanel({ open, onClose }: NotificationsPanelProps) {
  if (!open) return null;
  return <PanelBody onClose={onClose} />;
}

function PanelBody({ onClose }: { onClose: () => void }) {
  const { orgId } = useOrg();
  const { data: organization } = useOrgDetails(orgId);
  const timeZone = organization?.timeZone ?? "UTC";
  const navigate = useNavigate();
  const [tab, setTab] = useState<NotificationStatus>("unread");
  const { data, isPending, isError, refetch } = useNotifications(orgId, tab);
  const markRead = useMarkNotificationsRead(orgId);
  const dismiss = useDismissNotifications(orgId);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const unreadCount = data?.unreadCount ?? 0;
  const readableUnreadCount = data?.readableUnreadCount ?? 0;
  const notifications = data?.notifications ?? [];
  const invites = useMyInvites().data ?? [];

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const handleSelect = (notification: Notification) => {
    if (!notification.readAt && !isTaskReminder(notification.type)) {
      markRead.mutate([notification._id]);
    }
    const link = notificationLink(orgId, notification);
    if (link) {
      onClose();
      void navigate(link);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-none"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        className={cn(
          "absolute inset-y-0 flex flex-col bg-white shadow-2xl motion-reduce:animate-none dark:bg-slate-900",
          // Phones: a drawer from the right, under the bell, leaving a strip
          // of the page visible so it reads as sliding over it.
          "right-0 w-[calc(100%-3rem)] max-w-sm rounded-l-2xl border-l border-slate-200 animate-[panel-in-right_260ms_cubic-bezier(0.32,0.72,0,1)] dark:border-slate-800",
          // Desktop: a card dropping down from the bell at the top right.
          "md:inset-y-auto md:right-3 md:top-[4.25rem] md:max-h-[min(70vh,560px)] md:w-[380px] md:max-w-none md:origin-top-right md:rounded-xl md:border md:shadow-xl md:animate-[popover-in_140ms_ease-out]",
        )}
      >
        <header className="border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="notifications-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-50"
              >
                Notifications
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {[
                  invites.length > 0 &&
                    `${invites.length} ${invites.length === 1 ? "invitation" : "invitations"}`,
                  unreadCount > 0 && `${unreadCount} unread`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "You're all caught up"}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Filter notifications"
              className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
            >
              {TABS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === option.value}
                  onClick={() => setTab(option.value)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                    tab === option.value
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {option.label}
                  {option.value === "unread" && unreadCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-teal-600 px-1.5 text-xs text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              disabled={readableUnreadCount === 0 || markRead.isPending}
              className="text-sm font-medium text-teal-700 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-teal-400 dark:disabled:text-slate-500"
            >
              Mark activity read
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {invites.length > 0 && (
            <section
              aria-labelledby="invitations-title"
              className="border-b border-slate-200 p-4 dark:border-slate-800"
            >
              <h3
                id="invitations-title"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                Invitations
              </h3>
              <MyInvitations invites={invites} onJoined={onClose} />
            </section>
          )}

          {isPending && (
            <ul className="space-y-1 p-4" aria-label="Loading notifications">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </ul>
          )}

          {isError && (
            <div className="p-6 text-center text-sm">
              <p className="text-red-600 dark:text-red-400">
                Couldn&apos;t load notifications.
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-2 font-medium text-teal-700 hover:underline dark:text-teal-400"
              >
                Try again
              </button>
            </div>
          )}

          {!isPending &&
            !isError &&
            notifications.length === 0 &&
            invites.length > 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {tab === "unread"
                  ? "No unread notifications."
                  : "No notifications yet."}
              </p>
            )}

          {!isPending &&
            !isError &&
            notifications.length === 0 &&
            invites.length === 0 && (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <ActivityIcon type={null} className="h-12 w-12" />
                <p className="mt-4 font-medium text-slate-700 dark:text-slate-200">
                  {tab === "unread"
                    ? "You're all caught up"
                    : "Nothing here yet"}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {tab === "unread"
                    ? "Task reminders, completions and team updates will show up here."
                    : "You'll be notified when someone asks you for an update, posts one, or asks a question."}
                </p>
                {tab === "unread" && (
                  <button
                    type="button"
                    onClick={() => setTab("all")}
                    className="mt-4 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    See earlier notifications
                  </button>
                )}
              </div>
            )}

          {!isPending && !isError && notifications.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.map((notification) => {
                const unread =
                  !notification.readAt && !notification.dismissedAt;
                const isReminder = isTaskReminder(notification.type);
                const linked = notificationLink(orgId, notification) !== null;
                return (
                  <li key={notification._id}>
                    <div
                      className={cn(
                        "flex items-start gap-1 px-2",
                        unread && "bg-teal-50/60 dark:bg-teal-900/10",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(notification)}
                        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <ActivityIcon type={notification.type} />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-sm",
                              unread
                                ? "font-medium text-slate-900 dark:text-slate-50"
                                : "text-slate-600 dark:text-slate-300",
                            )}
                          >
                            {notification.message}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                            {notification.projectName && (
                              <>{notification.projectName} · </>
                            )}
                            {notification.dueDate && (
                              <>
                                Due{" "}
                                {formatDateInTimeZone(
                                  notification.dueDate,
                                  timeZone,
                                )}{" "}
                                ·{" "}
                              </>
                            )}
                            <time
                              dateTime={notification.createdAt}
                              title={formatFullTime(notification.createdAt)}
                            >
                              {formatRelativeTime(notification.createdAt)}
                            </time>
                            {!linked && " · no longer available"}
                            {notification.dismissedAt && " · dismissed"}
                          </span>
                        </span>
                        {unread && (
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-teal-500"
                            aria-label="Unread"
                          />
                        )}
                      </button>
                      {isReminder && !notification.dismissedAt && (
                        <button
                          type="button"
                          onClick={() => dismiss.mutate([notification._id])}
                          disabled={dismiss.isPending}
                          aria-label={`Dismiss reminder: ${notification.message}`}
                          title="Dismiss reminder"
                          className="mt-2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Reminders stay unread until you dismiss them. Opening other
          notifications marks them as read.
        </footer>
      </section>
    </div>
  );
}
