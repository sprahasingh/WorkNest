import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { cn } from "@/lib/cn";
import { hasSeenOnboarding } from "@/lib/onboarding";
import { OnboardingTour } from "@/components/OnboardingTour";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  useUnreadNotifications,
  useMarkNotificationsRead,
} from "@/features/notifications/queries";
import type { Notification } from "@/features/notifications/api";

interface NavItem {
  to: string;
  label: string;
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function WorkspaceSwitcher() {
  const { orgId, orgName, role } = useOrg();
  const { memberships, logout, isLoggingOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const otherMemberships = (memberships ?? []).filter(
    (membership) => membership.tenantId.id !== orgId,
  );

  return (
    <div
      ref={containerRef}
      className="relative border-b border-slate-200 p-2 dark:border-slate-700"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
          W
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">
            {orgName}
          </span>
          <span className="block font-mono text-xs text-slate-400">
            {role}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {otherMemberships.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Switch workspace
              </p>
              {otherMemberships.map((membership) => (
                <Link
                  key={membership._id}
                  to={`/orgs/${membership.tenantId.id}/dashboard`}
                  onClick={() => setOpen(false)}
                  className="block truncate px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {membership.tenantId.name}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {membership.role}
                  </span>
                </Link>
              ))}
              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
            </>
          )}

          <Link
            to="/orgs"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            All organizations
          </Link>

          <div className="my-1 border-t border-slate-100 dark:border-slate-700" />

          <button
            type="button"
            onClick={() => void logout()}
            disabled={isLoggingOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {isLoggingOut && (
              <svg
                className="h-3.5 w-3.5 animate-spin text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
            {isLoggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function notificationLink(orgId: string, n: Notification): string | null {
  if (!n.projectId) return null;
  const query = n.taskId ? `task=${n.taskId}` : "updates=1";
  return `/orgs/${orgId}/projects/${n.projectId}?${query}`;
}

function NotificationBell({
  placement = "up",
  onNavigate,
}: {
  placement?: "up" | "down";
  onNavigate?: () => void;
}) {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const { data: notifications } = useUnreadNotifications(orgId);
  const { mutate: markRead } = useMarkNotificationsRead(orgId);
  // While open, show the list as it was when opened, so marking it read
  // doesn't empty it under the reader. It's marked read on close.
  const [shown, setShown] = useState<Notification[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications?.length ?? 0;
  const open = shown !== null;

  const close = useCallback(() => {
    if (shown && shown.length > 0) {
      markRead(shown.map((n) => n._id));
    }
    setShown(null);
  }, [shown, markRead]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) {
      close();
    } else {
      setShown(notifications ?? []);
    }
  };

  const handleSelect = (n: Notification) => {
    const link = notificationLink(orgId, n);
    close();
    if (link) {
      onNavigate?.();
      void navigate(link);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative flex items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <BellIcon className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800",
            placement === "up"
              ? "bottom-full left-0 mb-2"
              : "right-0 top-full mt-2",
          )}
        >
          <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-700">
            Notifications
          </p>
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-400">
              You&apos;re all caught up
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
              {shown.map((n) => {
                const clickable = notificationLink(orgId, n) !== null;
                return (
                  <li key={n._id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(n)}
                      disabled={!clickable}
                      className="w-full px-3 py-2.5 text-left text-sm enabled:hover:bg-slate-50 disabled:cursor-default dark:enabled:hover:bg-slate-700/60"
                    >
                      <p className="text-slate-700 dark:text-slate-200">
                        {n.message}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(n.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const canViewDashboard = useCan("dashboard:read");
  const canViewAudit = useCan("audit:read");

  const navItems: NavItem[] = [
    ...(canViewDashboard ? [{ to: "dashboard", label: "Dashboard" }] : []),
    { to: "projects", label: "Projects" },
    { to: "members", label: "Members" },
    ...(canViewAudit ? [{ to: "audit", label: "Audit log" }] : []),
    { to: "settings", label: "Settings" },
  ];

  return (
    <div className="flex h-full flex-col">
      <WorkspaceSwitcher />

      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-teal-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
        <Link
          to="/how-to-use"
          target="_blank"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold dark:border-slate-600">
            ?
          </span>
          How to use
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell onNavigate={onNavigate} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !hasSeenOnboarding(),
  );

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileNavOpen}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <div className="flex flex-1 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            W
          </span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            WorkNest
          </span>
        </div>
        <NotificationBell placement="down" />
        <ThemeToggle />
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
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
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>

      {showOnboarding && (
        <OnboardingTour onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
