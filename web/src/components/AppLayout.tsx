import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { orgName, role } = useOrg();
  const { logout } = useAuth();
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
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            W
          </span>
          <p className="truncate font-semibold text-slate-800">{orgName}</p>
        </div>
        <p className="mt-1 font-mono text-xs text-slate-400">{role}</p>
      </div>

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

      <div className="border-t border-slate-200 px-2 py-4">
        <button
          type="button"
          onClick={() => void logout()}
          className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            W
          </span>
          <span className="font-semibold text-slate-800">WorkNest</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
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
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-white shadow-xl">
            <div className="flex items-center justify-end px-2 py-2">
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
    </div>
  );
}
