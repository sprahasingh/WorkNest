import { apiClient } from "@/api/client";

export type AuditAction =
  | "member.role_changed"
  | "member.removed"
  | "invite.created"
  | "invite.revoked"
  | "invite.accepted"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "project.deleted"
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "plan.changed";

export const AUDIT_ACTIONS: AuditAction[] = [
  "member.role_changed",
  "member.removed",
  "invite.created",
  "invite.revoked",
  "invite.accepted",
  "project.created",
  "project.updated",
  "project.archived",
  "project.deleted",
  "task.created",
  "task.updated",
  "task.deleted",
  "plan.changed",
];

export const AUDIT_ENTITY_TYPES = [
  "Membership",
  "Invite",
  "Project",
  "Task",
  "Organization",
];

// Populated via .populate("actorId", "name email") on a .lean() query --
// lean() skips User's own toJSON transform even for populated paths, so
// this comes back with the raw _id, never the transformed id. Confirmed
// against the real API response, not assumed from how User normally
// serializes.
export interface AuditActor {
  _id: string;
  name: string;
  email: string;
}

export interface AuditLogEntry {
  _id: string;
  tenantId: string;
  actorId: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListAuditLogsParams {
  action?: AuditAction;
  actorId?: string;
  entityType?: string;
  cursor?: string;
  limit?: number;
}

export interface ListAuditLogsResponse {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

export async function listAuditLogs(
  orgId: string,
  params: ListAuditLogsParams = {},
): Promise<ListAuditLogsResponse> {
  const response = await apiClient.get<ListAuditLogsResponse>(
    `/orgs/${orgId}/audit-logs`,
    { params },
  );
  return response.data;
}
