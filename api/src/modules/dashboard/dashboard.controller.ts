import type { Request, Response } from "express";
import { getDashboard } from "./dashboard.service.js";

export async function getDashboardController(
  req: Request,
  res: Response,
): Promise<void> {
  const days = req.query.days !== undefined ? Number(req.query.days) : 14;
  const dashboard = await getDashboard(isNaN(days) ? 14 : days);
  res.status(200).json(dashboard);
}
