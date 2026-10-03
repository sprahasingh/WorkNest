import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  listNotificationsQuerySchema,
  markReadSchema,
  dismissNotificationsSchema,
  setMuteSchema,
} from "./notifications.schemas.js";
import {
  listNotificationsController,
  markReadController,
  dismissNotificationsController,
  getMutesController,
  setMuteController,
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
notificationsRouter.patch(
  "/dismiss",
  validate({ body: dismissNotificationsSchema }),
  dismissNotificationsController,
);

notificationsRouter.get("/mutes", getMutesController);
notificationsRouter.put(
  "/mutes",
  validate({ body: setMuteSchema }),
  setMuteController,
);

export { notificationsRouter };
