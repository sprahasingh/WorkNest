import { Suspense, lazy } from "react";
import { useParams } from "react-router";
import { Navigate, Route, Routes } from "react-router";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { GuestRoute } from "@/auth/GuestRoute";
import { OrgRoute } from "@/auth/OrgRoute";
import { Login } from "@/pages/Login";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import { Register } from "@/pages/Register";
import { VerifyEmailChange } from "@/pages/VerifyEmailChange";
import { VerifyRegistration } from "@/pages/VerifyRegistration";
import { InviteAccept } from "@/pages/InviteAccept";
import { OrgPicker } from "@/pages/OrgPicker";
import { AppLayout } from "@/components/AppLayout";
import { NotFound } from "@/pages/NotFound";
import { ServerWakeScreen } from "@/components/ServerWakeScreen";
import { RouteEffects } from "@/components/RouteEffects";

// Pages load when they are first opened, so the first screen doesn't carry the
// charts, the chat and the settings code along with it.
const Landing = lazy(() =>
  import("@/pages/Landing").then((m) => ({ default: m.Landing })),
);
const HowToUse = lazy(() =>
  import("@/pages/HowToUse").then((m) => ({ default: m.HowToUse })),
);
const DashboardPage = lazy(() =>
  import("@/features/dashboard/DashboardPage").then((m) => ({
    default: m.DashboardPage,
  })),
);
const ProjectBoard = lazy(() =>
  import("@/features/tasks/ProjectBoard").then((m) => ({
    default: m.ProjectBoard,
  })),
);
const MembersPage = lazy(() =>
  import("@/features/members/MembersPage").then((m) => ({
    default: m.MembersPage,
  })),
);
const AuditPage = lazy(() =>
  import("@/features/audit/AuditPage").then((m) => ({ default: m.AuditPage })),
);
const MessagesPage = lazy(() =>
  import("@/features/chat/MessagesPage").then((m) => ({
    default: m.MessagesPage,
  })),
);
const MeetingsPage = lazy(() =>
  import("@/features/meetings/MeetingsPage").then((m) => ({
    default: m.MeetingsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const ProjectsPage = lazy(() =>
  import("@/features/projects/ProjectsPage").then((m) => ({
    default: m.ProjectsPage,
  })),
);

// A different project gets a fresh board, so an open task panel or a half-made
// change can't carry over to it.
function ProjectBoardForProject() {
  const { projectId } = useParams();
  return <ProjectBoard key={projectId} />;
}

export function AppRoutes() {
  return (
    <>
      <ServerWakeScreen />
      <RouteEffects />
      <Suspense
        fallback={
          <div
            role="status"
            className="flex min-h-dvh items-center justify-center bg-slate-100 dark:bg-slate-950"
          >
            <p className="text-slate-500 dark:text-slate-400">Loading…</p>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/how-to-use" element={<HowToUse />} />
          <Route path="/verify-email-change" element={<VerifyEmailChange />} />
          <Route path="/verify-email" element={<VerifyRegistration />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/register" element={<Register />} />
          </Route>
          <Route path="/invite/:token" element={<InviteAccept />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/orgs" element={<OrgPicker />} />
            <Route path="/orgs/:orgId" element={<OrgRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route
                  path="projects/:projectId"
                  element={<ProjectBoardForProject />}
                />
                <Route path="members" element={<MembersPage />} />
                <Route
                  path="messages/:conversationId?"
                  element={<MessagesPage />}
                />
                <Route path="meetings" element={<MeetingsPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
