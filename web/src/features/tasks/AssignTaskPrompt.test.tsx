import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Member } from "@/features/members/api";
import type { Task } from "./api";
import { AssignTaskPrompt } from "./AssignTaskPrompt";
import { shouldPromptForAssignee } from "./assignmentPrompt";

const task = { _id: "task-1" } as Task;
const members = [
  {
    _id: "member-1",
    userId: { id: "user-1", name: "Alex", email: "alex@example.test" },
    role: "member",
  },
  {
    _id: "member-2",
    userId: { id: "user-2", name: "Sam", email: "sam@example.test" },
    role: "manager",
  },
] as Member[];

describe("AssignTaskPrompt", () => {
  afterEach(cleanup);

  it("only prompts for unassigned To do tasks moving to In progress when assignment is permitted", () => {
    expect(
      shouldPromptForAssignee(
        { status: "todo", assigneeIds: [] },
        "in_progress",
        true,
      ),
    ).toBe(true);
    expect(
      shouldPromptForAssignee(
        { status: "todo", assigneeIds: ["user-1"] },
        "in_progress",
        true,
      ),
    ).toBe(false);
    expect(
      shouldPromptForAssignee(
        { status: "todo", assigneeIds: [] },
        "done",
        true,
      ),
    ).toBe(false);
    expect(
      shouldPromptForAssignee(
        { status: "in_progress", assigneeIds: [] },
        "todo",
        true,
      ),
    ).toBe(false);
    expect(
      shouldPromptForAssignee(
        { status: "todo", assigneeIds: [] },
        "in_progress",
        false,
      ),
    ).toBe(false);
  });

  it("requires a valid selection, supports multiple assignees, and offers move without assignment", () => {
    const onAssignAndMove = vi.fn();
    const onMoveWithoutAssignee = vi.fn();
    render(
      <AssignTaskPrompt
        task={task}
        members={members}
        pending={false}
        error={null}
        canAssign
        onCancel={vi.fn()}
        onMoveWithoutAssignee={onMoveWithoutAssignee}
        onAssignAndMove={onAssignAndMove}
      />,
    );

    const assign = screen.getByRole("button", { name: "Assign & Move" });
    expect(assign.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText("Alex"));
    fireEvent.click(screen.getByLabelText("Sam"));
    const enabledAssign = screen.getByRole("button", { name: "Assign & Move" });
    expect(enabledAssign.hasAttribute("disabled")).toBe(false);
    fireEvent.click(enabledAssign);
    expect(onAssignAndMove).toHaveBeenCalledWith(["user-1", "user-2"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Move without assignee" }),
    );
    expect(onMoveWithoutAssignee).toHaveBeenCalledOnce();
  });

  it("hides assignment controls when the user cannot assign and keeps errors visible for retry", () => {
    render(
      <AssignTaskPrompt
        task={task}
        members={members}
        pending={false}
        error="This task changed while the reminder was open. Refresh and try again."
        canAssign={false}
        onCancel={vi.fn()}
        onMoveWithoutAssignee={vi.fn()}
        onAssignAndMove={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Assign & Move" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Move without assignee" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("task changed");
  });
});
