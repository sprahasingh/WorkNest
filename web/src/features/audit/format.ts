import type { AuditLogEntry } from "./api";
import { formatDateInTimeZone } from "@/lib/time";

export interface AuditFormatContext {
  // Resolves a user id to a current member's name, if they're still here.
  memberName: (userId: string) => string | undefined;
  timeZone: string;
}

type Change = { from: unknown; to: unknown };

const FIELD_LABELS: Record<string, string> = {
  assigneeIds: "assignees",
  assigneeId: "assignee",
  dueDate: "due date",
  timeZone: "time zone",
  chatRetentionDays: "how long chat messages are kept",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const FORMER_MEMBER = "a former member";

// Audit entries are history: they can predate today's data shapes, or name
// people who have since left. Read every field defensively.
function asChange(value: unknown): Change | null {
  if (
    value &&
    typeof value === "object" &&
    ("from" in value || "to" in value)
  ) {
    return value as Change;
  }
  return null;
}

function text(value: unknown, fallback = "unknown"): string {
  return value === null || value === undefined || value === ""
    ? fallback
    : String(value);
}

function formatFieldValue(
  field: string,
  value: unknown,
  ctx: AuditFormatContext,
): string {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return field === "chatRetentionDays" ? "forever" : "none";
  }
  if (field === "assigneeIds" || field === "assigneeId") {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => ctx.memberName(String(id)) ?? FORMER_MEMBER)
      .join(", ");
  }
  if (field === "dueDate") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : formatDateInTimeZone(date.toISOString(), ctx.timeZone);
  }
  if (field === "status") {
    return STATUS_LABELS[String(value)] ?? String(value);
  }
  if (field === "chatRetentionDays") {
    return `${value} days`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatChanges(
  metadata: Record<string, unknown>,
  ctx: AuditFormatContext,
): string {
  const parts = Object.entries(metadata).flatMap(([field, raw]) => {
    const change = asChange(raw);
    if (!change) return [];
    const label = FIELD_LABELS[field] ?? field;
    return [
      `${label} from "${formatFieldValue(field, change.from, ctx)}" to "${formatFieldValue(field, change.to, ctx)}"`,
    ];
  });
  return parts.length > 0 ? parts.join(", ") : "no visible changes";
}

function describe(entry: AuditLogEntry, ctx: AuditFormatContext): string {
  const actor = entry.actorId?.name ?? "A former member";
  const m = entry.metadata ?? {};

  switch (entry.action) {
    case "org.renamed": {
      const name = asChange(m.name);
      return name
        ? `${actor} renamed the organization from "${text(name.from)}" to "${text(name.to)}"`
        : `${actor} renamed the organization`;
    }
    case "org.timezone_changed":
      return `${actor} changed the organization time zone: ${formatChanges(m, ctx)}${m.dueDatesMoved === false ? " (due dates left as they were)" : ""}`;
    case "org.settings_updated":
      return `${actor} updated organization settings: ${formatChanges(m, ctx)}`;
    case "member.role_changed": {
      const role = asChange(m.role);
      return role
        ? `${actor} changed a member's role from ${text(role.from)} to ${text(role.to)}`
        : `${actor} changed a member's role`;
    }
    case "member.removed": {
      const who = typeof m.name === "string" ? m.name : null;
      if (m.self === true) return `${actor} left the organization`;
      return who
        ? `${actor} removed ${who} (${text(m.role, "member")}) from the organization`
        : `${actor} removed a ${text(m.role, "member")} from the organization`;
    }
    case "invite.created":
      return `${actor} invited ${text(m.email, "someone")} as ${text(m.role, "a member")}`;
    case "invite.revoked":
      return m.replaced === true
        ? `${actor} replaced the invite link for ${text(m.email, "someone")}`
        : `${actor} revoked the invite for ${text(m.email, "someone")}`;
    case "invite.declined":
      return `${text(m.email, "Someone")} declined the invite to join as ${text(m.role, "a member")}`;
    case "invite.accepted":
      return m.viaSignup
        ? `${text(m.email, "Someone")} joined by accepting an invite and creating an account`
        : `${text(m.email, "Someone")} accepted an invite to join as ${text(m.role, "a member")}`;
    case "project.created":
      return `${actor} created project "${text(m.name)}" (${text(m.key)})`;
    case "project.updated":
      return `${actor} updated a project: ${formatChanges(m, ctx)}`;
    case "project.archived":
      return `${actor} archived a project`;
    case "project.unarchived":
      return `${actor} unarchived project "${text(m.name)}"`;
    case "project.binned":
      return `${actor} moved project "${text(m.name)}" (${text(m.key)}) to the bin`;
    case "project.restored":
      return `${actor} restored project "${text(m.name)}" (${text(m.key)}) from the bin`;
    case "project.deleted":
      return `${actor} permanently deleted project "${text(m.name)}" (${text(m.key)})`;
    case "project.purged":
      return `Project "${text(m.name)}" (${text(m.key)}) was deleted automatically after 30 days in the bin`;
    case "task.created":
      return `${actor} created task "${text(m.title)}"`;
    case "task.updated":
      return `${actor} updated a task: ${formatChanges(m, ctx)}`;
    case "task.deleted":
      return `${actor} deleted task "${text(m.title)}"`;
    case "plan.changed": {
      const plan = asChange(m.plan);
      return plan
        ? `${actor} changed the plan from ${text(plan.from)} to ${text(plan.to)}`
        : `${actor} changed the plan`;
    }
    default:
      return `${actor} performed ${text(entry.action, "an action")}`;
  }
}

export function describeAuditEntry(
  entry: AuditLogEntry,
  ctx: AuditFormatContext,
): string {
  try {
    return describe(entry, ctx);
  } catch {
    // One unreadable entry must never take down the whole log.
    return `${entry.actorId?.name ?? "Someone"} performed ${text(entry.action, "an action")}`;
  }
}
