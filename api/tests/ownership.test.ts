import { describe, it, expect } from "vitest";
import { canUpdateTask } from "../src/auth/ownership.js";
import type { TaskUpdateChanges } from "../src/auth/ownership.js";

const userId = "user-1";
const otherUserId = "user-2";

function makeTask(
  overrides: Partial<{ createdBy: string; assigneeIds: string[] | null }> = {},
) {
  return {
    createdBy: { toString: () => overrides.createdBy ?? userId },
    assigneeIds:
      overrides.assigneeIds === undefined
        ? null
        : overrides.assigneeIds === null
          ? null
          : overrides.assigneeIds.map((id) => ({ toString: () => id })),
  };
}

describe("canUpdateTask", () => {
  it("allows admins to update any task regardless of ownership", () => {
    const task = makeTask({
      createdBy: otherUserId,
      assigneeIds: [otherUserId],
    });
    const result = canUpdateTask({ userId, role: "admin" }, task, {});
    expect(result).toBe(true);
  });

  it("allows managers to update any task regardless of ownership", () => {
    const task = makeTask({
      createdBy: otherUserId,
      assigneeIds: [otherUserId],
    });
    const result = canUpdateTask({ userId, role: "manager" }, task, {});
    expect(result).toBe(true);
  });

  it("denies a member updating a task they created but are not assigned to", () => {
    const task = makeTask({ createdBy: userId, assigneeIds: [otherUserId] });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      title: "New title",
    } as unknown as TaskUpdateChanges);
    expect(result).toBe(false);
  });

  it("allows a member to update a task they are one of several assignees on", () => {
    const task = makeTask({
      createdBy: otherUserId,
      assigneeIds: [otherUserId, userId],
    });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      title: "New title",
    } as unknown as TaskUpdateChanges);
    expect(result).toBe(true);
  });

  it("allows a member to update a task they are assigned to", () => {
    const task = makeTask({ createdBy: otherUserId, assigneeIds: [userId] });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      status: "done",
    } as unknown as TaskUpdateChanges);
    expect(result).toBe(true);
  });

  it("denies a member updating a task they neither created nor are assigned to", () => {
    const task = makeTask({
      createdBy: otherUserId,
      assigneeIds: [otherUserId],
    });
    const result = canUpdateTask({ userId, role: "member" }, task, {});
    expect(result).toBe(false);
  });

  it("denies a member from reassigning a task, even one they own", () => {
    const task = makeTask({ createdBy: userId, assigneeIds: null });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      assigneeIds: [otherUserId],
    });
    expect(result).toBe(false);
  });

  it("denies a member from reassigning even when explicitly setting assigneeIds to null", () => {
    const task = makeTask({ createdBy: userId, assigneeIds: [userId] });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      assigneeIds: null,
    });
    expect(result).toBe(false);
  });
});
