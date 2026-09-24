import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import { listAuditLogsQuerySchema } from "./audit.schemas.js";
import { listAuditLogsController } from "./audit.controller.js";

const router = Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("audit:read"),
  validate({ query: listAuditLogsQuerySchema }),
  listAuditLogsController,
);

export { router as auditRouter };
