import type mongoose from "mongoose";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { Task } from "../../models/Task.js";

// How many projects hold more open tasks than a plan's per-project limit.
// This is the one rule behind both the downgrade check and the over-limit
// check after a plan ends, so they always agree:
//   - open tasks (not done, not archived, not binned) in an active project count;
//   - tasks in an archived or binned project don't, because that project isn't
//     in use. (Restoring it is what checks its tasks against the plan.)
// Runs for the current organization (the tenant context). A null limit means
// the plan has none.
export async function countProjectsOverTaskLimit(
  limit: number | null,
  dbSession?: mongoose.ClientSession,
): Promise<number> {
  if (limit === null) return 0;
  const unused = [
    ...(await binnedProjectIds()),
    ...(await Project.find({ archivedAt: { $ne: null } })
      .session(dbSession ?? null)
      .distinct("_id")),
  ];
  const rows = await Task.aggregate<{ _id: unknown }>([
    {
      $match: {
        status: { $ne: "done" },
        archivedAt: null,
        deletedAt: null,
        projectId: { $nin: unused },
      },
    },
    { $group: { _id: "$projectId", active: { $sum: 1 } } },
    { $match: { active: { $gt: limit } } },
  ]).session(dbSession ?? null);
  return rows.length;
}
