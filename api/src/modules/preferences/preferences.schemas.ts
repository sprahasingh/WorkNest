import { z } from "zod";

const lifecycleView = z.enum(["active", "completed", "archived", "bin"]);
const lifecycleSort = z.enum([
  "createdAt:asc",
  "createdAt:desc",
  "dueDate:asc",
  "dueDate:desc",
  "completedAt:asc",
  "completedAt:desc",
  "archivedAt:asc",
  "archivedAt:desc",
  "deletedAt:asc",
  "deletedAt:desc",
  "priority:asc",
  "priority:desc",
]);

const sortFieldsByView = {
  active: ["createdAt", "dueDate", "priority"],
  completed: ["createdAt", "completedAt", "dueDate", "priority"],
  archived: ["createdAt", "archivedAt", "dueDate", "priority"],
  bin: ["createdAt", "deletedAt", "dueDate", "priority"],
} as const;

const context = z.union([
  z.literal("projects"),
  z.string().regex(/^[a-f\d]{24}$/i, "Invalid project context"),
]);

export const getLifecycleSortPreferencesSchema = z.object({ context }).strict();

export const putLifecycleSortPreferenceSchema = z
  .object({
    context,
    view: lifecycleView,
    sort: lifecycleSort,
  })
  .strict()
  .refine(
    ({ view, sort }) =>
      (sortFieldsByView[view] as readonly string[]).includes(
        sort.split(":")[0]!,
      ),
    { path: ["sort"], message: "That sort is not available for this view" },
  );

export type GetLifecycleSortPreferencesQuery = z.infer<
  typeof getLifecycleSortPreferencesSchema
>;
export type PutLifecycleSortPreferenceInput = z.infer<
  typeof putLifecycleSortPreferenceSchema
>;
