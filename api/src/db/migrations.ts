import { Task } from "../models/Task.js";
import { logger } from "../lib/logger.js";

// Tasks created before multi-assignee support stored a single `assigneeId`.
// Move it into `assigneeIds` so old tasks keep their assignee, stay editable
// by that person, and are hidden from members when assigned to a lead.
// Uses the raw collection because the schema no longer knows `assigneeId`.
export async function migrateLegacyTaskAssignees(): Promise<void> {
  const converted = await Task.collection.updateMany(
    { assigneeId: { $exists: true } },
    [
      {
        $set: {
          assigneeIds: {
            $cond: [
              { $eq: [{ $ifNull: ["$assigneeId", null] }, null] },
              { $ifNull: ["$assigneeIds", []] },
              ["$assigneeId"],
            ],
          },
        },
      },
      { $unset: "assigneeId" },
    ],
  );

  const backfilled = await Task.collection.updateMany(
    { assigneeIds: { $exists: false } },
    { $set: { assigneeIds: [] } },
  );

  if (converted.modifiedCount > 0 || backfilled.modifiedCount > 0) {
    logger.info(
      {
        converted: converted.modifiedCount,
        backfilled: backfilled.modifiedCount,
      },
      "Migrated legacy task assignees",
    );
  }
}
