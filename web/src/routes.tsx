import { Navigate, Route, Routes } from "react-router";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { OrgRoute } from "@/auth/OrgRoute";
import { Landing } from "@/pages/Landing";
import { HowToUse } from "@/pages/HowToUse";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { InviteAccept } from "@/pages/InviteAccept";
import { OrgPicker } from "@/pages/OrgPicker";
import { AppLayout } from "@/components/AppLayout";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { ProjectBoard } from "@/features/tasks/ProjectBoard";
import { MembersPage } from "@/features/members/MembersPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { NotFound } from "@/pages/NotFound";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
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
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
