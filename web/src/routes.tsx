import { Navigate, Route, Routes } from "react-router";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { GuestRoute } from "@/auth/GuestRoute";
import { OrgRoute } from "@/auth/OrgRoute";
import { Landing } from "@/pages/Landing";
import { HowToUse } from "@/pages/HowToUse";
import { Login } from "@/pages/Login";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import { Register } from "@/pages/Register";
import { VerifyEmailChange } from "@/pages/VerifyEmailChange";
import { VerifyRegistration } from "@/pages/VerifyRegistration";
import { InviteAccept } from "@/pages/InviteAccept";
import { OrgPicker } from "@/pages/OrgPicker";
import { AppLayout } from "@/components/AppLayout";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { ProjectBoard } from "@/features/tasks/ProjectBoard";
import { MembersPage } from "@/features/members/MembersPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { MessagesPage } from "@/features/chat/MessagesPage";
import { MeetingsPage } from "@/features/meetings/MeetingsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { NotFound } from "@/pages/NotFound";
import { ServerWakeScreen } from "@/components/ServerWakeScreen";

export function AppRoutes() {
  return (
    <>
      <ServerWakeScreen />
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
              <Route path="projects/:projectId" element={<ProjectBoard />} />
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
    </>
  );
}
