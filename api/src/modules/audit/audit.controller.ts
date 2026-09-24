import type { Request, Response } from "express";
import { AuditLog } from "../../models/AuditLog.js";
import type { ListAuditLogsQuery } from "./audit.schemas.js";

export async function listAuditLogsController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.validated!.query as ListAuditLogsQuery;
  const limit = query.limit ?? 20;

  const filter: Record<string, unknown> = {};

  if (query.action) filter.action = query.action;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.cursor) filter._id = { $lt: query.cursor };

  const logs = await AuditLog.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("actorId", "name email")
    .lean();

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? String(items[items.length - 1]?._id) : null;

  res.status(200).json({ items, nextCursor });
}
