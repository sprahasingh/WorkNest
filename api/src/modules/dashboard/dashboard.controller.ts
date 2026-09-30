import type { Request, Response } from "express";
import {
  DAY_KEY,
  getDashboard,
  type DashboardRange,
} from "./dashboard.service.js";

export async function getDashboardController(
  req: Request,
  res: Response,
): Promise<void> {
  const { from, to } = req.query;
  const raw = req.query.days;
  const days = raw !== undefined ? Number(raw) : 14;
  let range: DashboardRange = raw === "all" ? "all" : isNaN(days) ? 14 : days;
  if (
    typeof from === "string" &&
    typeof to === "string" &&
    DAY_KEY.test(from) &&
    DAY_KEY.test(to) &&
    !isNaN(Date.parse(from)) &&
    !isNaN(Date.parse(to))
  ) {
    // Accept the dates in either order.
    range = from <= to ? { from, to } : { from: to, to: from };
  }
  const timeZone = typeof req.query.tz === "string" ? req.query.tz : "UTC";
  const dashboard = await getDashboard(range, timeZone);
  res.status(200).json(dashboard);
}
