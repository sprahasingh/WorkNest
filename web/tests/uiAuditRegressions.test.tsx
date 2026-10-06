import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../src/components/ui/Button";
import { Modal } from "../src/components/Modal";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
} from "../src/features/audit/labels";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "../src/features/audit/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("frontend audit regressions", () => {
  it("gives shared buttons a 44px minimum target", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(
      "min-h-11",
    );
  });

  it("resizes a long dialog to the visible viewport", () => {
    render(
      <Modal open onClose={() => undefined} title="Long form">
        <div>Form body</div>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Long form" });
    expect(dialog.style.maxHeight).toContain("744px");

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(420);
    fireEvent(window, new Event("resize"));
    expect(dialog.style.maxHeight).toContain("396px");
  });

  it("provides a readable label for every audit filter value", () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual(
      [...AUDIT_ACTIONS].sort(),
    );
    expect(Object.keys(AUDIT_ENTITY_LABELS).sort()).toEqual(
      [...AUDIT_ENTITY_TYPES].sort(),
    );
    expect(AUDIT_ACTION_LABELS["org.timezone_changed"]).toBe(
      "Time zone changed",
    );
    expect(AUDIT_ENTITY_LABELS.Membership).toBe("Member");
  });
});
