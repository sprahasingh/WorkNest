import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { cn } from "@/lib/cn";
import { hasSeenOnboarding } from "@/lib/onboarding";
import { OnboardingTour } from "@/components/OnboardingTour";

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
  const { memberships, logout } = useAuth();
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
    <div ref={containerRef} className="relative border-b border-slate-200 p-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
          W
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-800">
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
        <div className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
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
                  className="block truncate px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {membership.tenantId.name}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {membership.role}
                  </span>
                </Link>
              ))}
              <div className="my-1 border-t border-slate-100" />
            </>
          )}

          <Link
            to="/orgs"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            All organizations
          </Link>

          <div className="my-1 border-t border-slate-100" />

          <button
            type="button"
            onClick={() => void logout()}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Log out
          </button>
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
                  : "text-slate-600 hover:bg-slate-100",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-2">
        <Link
          to="/how-to-use"
          target="_blank"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold">
            ?
          </span>
          How to use WorkNest
        </Link>
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
    <div className="min-h-screen bg-slate-100 md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileNavOpen}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
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
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            W
          </span>
          <span className="font-semibold text-slate-800">WorkNest</span>
        </div>
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="font-semibold text-slate-800">Menu</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
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
