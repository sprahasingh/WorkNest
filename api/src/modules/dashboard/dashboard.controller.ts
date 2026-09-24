import type { Request, Response } from "express";
import { getDashboard } from "./dashboard.service.js";

export async function getDashboardController(
  req: Request,
  res: Response,
): Promise<void> {
  const dashboard = await getDashboard();
  res.status(200).json(dashboard);
}
