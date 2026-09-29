import type { Request, Response } from "express";
import {
  getUnreadNotifications,
  markNotificationsRead,
} from "./notifications.service.js";

export async function listNotificationsController(
  req: Request,
  res: Response,
): Promise<void> {
  const notifications = await getUnreadNotifications();
  res.status(200).json({ notifications });
}

export async function markReadController(
  req: Request,
  res: Response,
): Promise<void> {
  const ids = req.body?.ids as string[] | undefined;
  await markNotificationsRead(ids);
  res.status(204).send();
}
