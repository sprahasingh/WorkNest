import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { markReadSchema } from "./notifications.schemas.js";
import {
  listNotificationsController,
  markReadController,
} from "./notifications.controller.js";

const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get("/", listNotificationsController);
notificationsRouter.patch(
  "/read",
  validate({ body: markReadSchema }),
  markReadController,
);

export { notificationsRouter };
