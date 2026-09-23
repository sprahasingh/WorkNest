import { describe, it, expect } from "vitest";
import { canUpdateTask } from "../src/auth/ownership.js";
import type { TaskUpdateChanges } from "../src/auth/ownership.js";

const userId = "user-1";
const otherUserId = "user-2";

function makeTask(
  overrides: Partial<{ createdBy: string; assigneeId: string | null }> = {},
) {
  return {
    createdBy: { toString: () => overrides.createdBy ?? userId },
    assigneeId:
      overrides.assigneeId === undefined
        ? null
        : { toString: () => overrides.assigneeId as string },
  };
}

describe("canUpdateTask", () => {
  it("allows admins to update any task regardless of ownership", () => {
    const task = makeTask({ createdBy: otherUserId, assigneeId: otherUserId });
    const result = canUpdateTask({ userId, role: "admin" }, task, {});
    expect(result).toBe(true);
  });

  it("allows managers to update any task regardless of ownership", () => {
    const task = makeTask({ createdBy: otherUserId, assigneeId: otherUserId });
    const result = canUpdateTask({ userId, role: "manager" }, task, {});
    expect(result).toBe(true);
  });

  it("allows a member to update a task they created", () => {
    const task = makeTask({ createdBy: userId, assigneeId: null });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      title: "New title",
    } as unknown as TaskUpdateChanges);
    expect(result).toBe(true);
  });

  it("allows a member to update a task they are assigned to", () => {
    const task = makeTask({ createdBy: otherUserId, assigneeId: userId });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      status: "done",
    } as unknown as TaskUpdateChanges);
    expect(result).toBe(true);
  });

  it("denies a member updating a task they neither created nor are assigned to", () => {
    const task = makeTask({ createdBy: otherUserId, assigneeId: otherUserId });
    const result = canUpdateTask({ userId, role: "member" }, task, {});
    expect(result).toBe(false);
  });

  it("denies a member from reassigning a task, even one they own", () => {
    const task = makeTask({ createdBy: userId, assigneeId: null });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      assigneeId: otherUserId,
    });
    expect(result).toBe(false);
  });

  it("denies a member from reassigning even when explicitly setting assigneeId to null", () => {
    const task = makeTask({ createdBy: userId, assigneeId: userId });
    const result = canUpdateTask({ userId, role: "member" }, task, {
      assigneeId: null,
    });
    expect(result).toBe(false);
  });
});
