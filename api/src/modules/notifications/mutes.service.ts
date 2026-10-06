import mongoose from "mongoose";
import { Membership } from "../../models/Membership.js";
import { Project } from "../../models/Project.js";
import { AppError } from "../../lib/errors.js";
import { getTenantContext } from "../../tenancy/context.js";
import {
  assertTaskVisible,
  findTaskInLiveProject,
} from "../tasks/tasks.service.js";
import type { SetMuteInput } from "./notifications.schemas.js";

// The projects and tasks the signed-in person has muted here.
export async function getMyMutes() {
  const context = getTenantContext()!;
  const membership = await Membership.findOne({ userId: context.userId })
    .select("+mutedProjectIds +mutedTaskIds +mutedAllProjects")
    .lean();
  return {
    projectIds: (membership?.mutedProjectIds ?? []).map(String),
    taskIds: (membership?.mutedTaskIds ?? []).map(String),
    allProjects: membership?.mutedAllProjects ?? false,
  };
}

export async function setMute(input: SetMuteInput) {
  const context = getTenantContext()!;
  if (input.allProjects) {
    await Membership.updateOne(
      { userId: context.userId },
      { $set: { mutedAllProjects: input.muted } },
    );
    return getMyMutes();
  }
  let field: "mutedProjectIds" | "mutedTaskIds";
  let id: mongoose.Types.ObjectId;
  if (input.taskId) {
    const task = await findTaskInLiveProject(input.taskId);
    if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");
    await assertTaskVisible(task);
    field = "mutedTaskIds";
    id = task._id;
  } else {
    const project = await Project.findById(input.projectId);
    if (!project) throw new AppError(404, "NOT_FOUND", "Project not found");
    field = "mutedProjectIds";
    id = project._id;
  }
  await Membership.updateOne(
    { userId: context.userId },
    input.muted ? { $addToSet: { [field]: id } } : { $pull: { [field]: id } },
  );
  return getMyMutes();
}
