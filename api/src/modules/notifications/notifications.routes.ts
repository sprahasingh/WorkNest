import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  listNotificationsQuerySchema,
  markReadSchema,
} from "./notifications.schemas.js";
import {
  listNotificationsController,
  markReadController,
} from "./notifications.controller.js";

const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get(
  "/",
  validate({ query: listNotificationsQuerySchema }),
  listNotificationsController,
);
notificationsRouter.patch(
  "/read",
  validate({ body: markReadSchema }),
  markReadController,
);

export { notificationsRouter };
