import type { Request, Response } from "express";
import {
  getUnreadNotifications,
  markNotificationsRead,
} from "./notifications.service.js";
import type { MarkReadInput } from "./notifications.schemas.js";

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
  const { ids } = req.validated!.body as MarkReadInput;
  await markNotificationsRead(ids);
  res.status(204).send();
}
