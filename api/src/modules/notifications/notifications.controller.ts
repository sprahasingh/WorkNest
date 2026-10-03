import type { Request, Response } from "express";
import {
  listNotifications,
  markNotificationsRead,
  dismissNotifications,
} from "./notifications.service.js";
import type {
  DismissNotificationsInput,
  ListNotificationsQuery,
  MarkReadInput,
} from "./notifications.schemas.js";

export async function listNotificationsController(
  req: Request,
  res: Response,
): Promise<void> {
  const { status } = req.validated!.query as ListNotificationsQuery;
  const result = await listNotifications(status ?? "all");
  res.status(200).json(result);
}

export async function markReadController(
  req: Request,
  res: Response,
): Promise<void> {
  const { ids } = req.validated!.body as MarkReadInput;
  await markNotificationsRead(ids);
  res.status(204).send();
}

export async function dismissNotificationsController(
  req: Request,
  res: Response,
): Promise<void> {
  const { ids } = req.validated!.body as DismissNotificationsInput;
  await dismissNotifications(ids);
  res.status(204).send();
}
