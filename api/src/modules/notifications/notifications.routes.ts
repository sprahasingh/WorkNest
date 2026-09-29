import { Router } from "express";
import {
  listNotificationsController,
  markReadController,
} from "./notifications.controller.js";

const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get("/", listNotificationsController);
notificationsRouter.patch("/read", markReadController);

export { notificationsRouter };
