import { Navigate, Route, Routes } from "react-router";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { OrgRoute } from "@/auth/OrgRoute";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { InviteAccept } from "@/pages/InviteAccept";
import { OrgPicker } from "@/pages/OrgPicker";
import { OrgHome } from "@/pages/OrgHome";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { NotFound } from "@/pages/NotFound";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:token" element={<InviteAccept />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/orgs" element={<OrgPicker />} />
        <Route path="/orgs/:orgId" element={<OrgRoute />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<OrgHome />} />
          <Route path="projects" element={<ProjectsPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/orgs" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
