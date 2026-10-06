import type { AuditAction } from "./api";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "org.renamed": "Organization renamed",
  "org.settings_updated": "Organization settings updated",
  "org.timezone_changed": "Time zone changed",
  "member.role_changed": "Member role changed",
  "member.removed": "Member removed",
  "invite.created": "Invitation created",
  "invite.revoked": "Invitation revoked",
  "invite.accepted": "Invitation accepted",
  "invite.declined": "Invitation declined",
  "project.created": "Project created",
  "project.updated": "Project updated",
  "project.archived": "Project archived",
  "project.unarchived": "Project restored from archive",
  "project.binned": "Project moved to bin",
  "project.restored": "Project restored from bin",
  "project.deleted": "Project deleted",
  "project.purged": "Project permanently deleted",
  "task.created": "Task created",
  "task.updated": "Task updated",
  "task.deleted": "Task deleted",
  "plan.changed": "Plan changed",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  Membership: "Member",
  Invite: "Invitation",
  Project: "Project",
  Task: "Task",
  Organization: "Organization",
};
