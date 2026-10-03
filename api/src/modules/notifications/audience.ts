import mongoose from "mongoose";
import { Membership } from "../../models/Membership.js";

type Id = mongoose.Types.ObjectId | string;

export async function getAdminAndManagerIds(): Promise<Id[]> {
  const memberships = await Membership.find({
    role: { $in: ["admin", "manager"] },
  })
    .select("userId")
    .lean();
  return memberships.map((m) => m.userId);
}

// Whoever created a task or project counts as involved, as long as they're
// still in the organization and can see it. A task assigned to an admin or
// manager is hidden from other members.
export async function creatorIfInvolved(
  creatorId: Id | null | undefined,
  task: { assigneeIds?: Id[] | null } | null,
): Promise<Id[]> {
  if (!creatorId) return [];
  const membership = await Membership.findOne({ userId: creatorId })
    .select("role")
    .lean();
  if (!membership) return [];
  if (task && membership.role === "member") {
    const assignees = (task.assigneeIds ?? []).map((id) => String(id));
    if (!assignees.includes(String(creatorId))) {
      const leadIds = new Set(
        (await getAdminAndManagerIds()).map((id) => String(id)),
      );
      if (assignees.some((id) => leadIds.has(id))) return [];
    }
  }
  return [creatorId];
}

// Of these people, the ones who muted this project or this task.
export async function mutedAmong(
  userIds: Id[],
  projectId: Id,
  taskId: Id | null,
  session?: mongoose.ClientSession,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const muted = await Membership.find({
    userId: { $in: userIds },
    $or: [
      { mutedProjectIds: projectId },
      ...(taskId ? [{ mutedTaskIds: taskId }] : []),
    ],
  })
    .select("userId")
    .session(session ?? null)
    .lean();
  return new Set(muted.map((m) => String(m.userId)));
}
