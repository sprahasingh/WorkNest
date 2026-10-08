import type mongoose from "mongoose";
import { Project, binnedProjectIds } from "../../models/Project.js";
import { Task } from "../../models/Task.js";

export interface TaskLimitOverage {
  projectId: string;
  projectName: string;
  activeCount: number;
  limit: number;
}

// Which active projects hold more open tasks than a plan's per-project limit.
// This is the one rule behind both the downgrade check and the over-limit
// check after a plan ends, so they always agree:
//   - open tasks (not done, not archived, not binned) in an active project count;
//   - tasks in an archived or binned project don't, because that project isn't
//     in use. (Restoring it is what checks its tasks against the plan.)
// Runs for the current organization (the tenant context). A null limit means
// the plan has none.
export async function findProjectsOverTaskLimit(
  limit: number | null,
  dbSession?: mongoose.ClientSession,
): Promise<TaskLimitOverage[]> {
  if (limit === null) return [];
  const unused = [
    ...(await binnedProjectIds(dbSession)),
    ...(await Project.find({ archivedAt: { $ne: null } })
      .session(dbSession ?? null)
      .distinct("_id")),
  ];
  const rows = await Task.aggregate<{
    _id: mongoose.Types.ObjectId;
    active: number;
  }>([
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
  if (rows.length === 0) return [];

  const projects = await Project.find({
    _id: { $in: rows.map((row) => row._id) },
    archivedAt: null,
  })
    .select("name")
    .session(dbSession ?? null)
    .lean();
  const names = new Map(
    projects.map((project) => [String(project._id), project.name]),
  );
  return rows
    .filter((row) => names.has(String(row._id)))
    .map((row) => ({
      projectId: String(row._id),
      projectName: names.get(String(row._id))!,
      activeCount: row.active,
      limit,
    }));
}

export async function countProjectsOverTaskLimit(
  limit: number | null,
  dbSession?: mongoose.ClientSession,
): Promise<number> {
  return (await findProjectsOverTaskLimit(limit, dbSession)).length;
}
