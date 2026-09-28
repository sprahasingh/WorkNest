import { NavLink, Outlet } from "react-router";
import { useOrg } from "@/hooks/useOrg";
import { useCan } from "@/hooks/useCan";
import { useAuth } from "@/auth/auth-context";

interface NavItem {
  to: string;
  label: string;
}

export function AppLayout() {
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
    <div className="flex min-h-screen bg-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <p className="truncate font-semibold text-slate-800">{orgName}</p>
          <p className="font-mono text-xs text-slate-400">{role}</p>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`
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
            className="block w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
