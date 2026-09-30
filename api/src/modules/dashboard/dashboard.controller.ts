import type { Request, Response } from "express";
import { getDashboard, type DashboardRange } from "./dashboard.service.js";

export async function getDashboardController(
  req: Request,
  res: Response,
): Promise<void> {
  const raw = req.query.days;
  const days = raw !== undefined ? Number(raw) : 14;
  const range: DashboardRange = raw === "all" ? "all" : isNaN(days) ? 14 : days;
  const dashboard = await getDashboard(range);
  res.status(200).json(dashboard);
}
