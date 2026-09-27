import type { AuditLogEntry } from "./api";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  return String(value);
}

// Renders the metadata shape task.updated/project.updated actually store:
// Record<field, { from: unknown; to: unknown }> -- confirmed from the
// backend's own change-tracking code, not guessed.
function formatChanges(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([field, change]) => {
      const { from, to } = change as { from: unknown; to: unknown };
      return `${field} from "${formatValue(from)}" to "${formatValue(to)}"`;
    })
    .join(", ");
}

export function describeAuditEntry(entry: AuditLogEntry): string {
  const actor = entry.actorId.name;
  const m = entry.metadata;

  switch (entry.action) {
    case "member.role_changed": {
      const role = m.role as { from: string; to: string };
      return `${actor} changed a member's role from ${role.from} to ${role.to}`;
    }
    case "member.removed":
      return `${actor} removed a ${String(m.role)} from the organization`;
    case "invite.created":
      return `${actor} invited ${String(m.email)} as ${String(m.role)}`;
    case "invite.revoked":
      return `${actor} revoked the invite for ${String(m.email)}`;
    case "invite.accepted":
      return m.viaSignup
        ? `${String(m.email)} joined by accepting an invite and creating an account`
        : `${String(m.email)} accepted an invite to join as ${String(m.role)}`;
    case "project.created":
      return `${actor} created project "${String(m.name)}" (${String(m.key)})`;
    case "project.updated":
      return `${actor} updated a project: ${formatChanges(m)}`;
    case "project.archived":
      return `${actor} archived a project`;
    case "project.deleted":
      return `${actor} deleted project "${String(m.name)}" (${String(m.key)})`;
    case "task.created":
      return `${actor} created task "${String(m.title)}"`;
    case "task.updated":
      return `${actor} updated a task: ${formatChanges(m)}`;
    case "task.deleted":
      return `${actor} deleted task "${String(m.title)}"`;
    case "plan.changed": {
      const plan = m.plan as { from: string; to: string };
      return `${actor} changed the plan from ${plan.from} to ${plan.to}`;
    }
    default:
      return `${actor} performed ${entry.action}`;
  }
}
