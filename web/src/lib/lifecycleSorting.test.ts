import { describe, expect, it } from "vitest";
import {
  compareLifecycleItems,
  defaultLifecycleSort,
} from "./lifecycleSorting";

describe("lifecycle sort defaults", () => {
  it.each([
    ["active", "dueDate:asc"],
    ["completed", "completedAt:desc"],
    ["archived", "archivedAt:desc"],
    ["bin", "deletedAt:desc"],
  ] as const)("uses %s default sort", (view, expected) => {
    expect(defaultLifecycleSort(view)).toBe(expected);
  });

  it("falls back from a missing bin date to the latest lifecycle date", () => {
    const olderArchive = {
      name: "Older archive",
      createdAt: "2025-01-01T00:00:00.000Z",
      archivedAt: "2025-02-01T00:00:00.000Z",
      deletedAt: null,
      priority: "medium" as const,
    };
    const newerArchive = {
      name: "Newer archive",
      createdAt: "2025-01-02T00:00:00.000Z",
      archivedAt: "2025-03-01T00:00:00.000Z",
      deletedAt: null,
      priority: "medium" as const,
    };

    expect(
      compareLifecycleItems(olderArchive, newerArchive, "deletedAt:desc"),
    ).toBeGreaterThan(0);
  });
});
