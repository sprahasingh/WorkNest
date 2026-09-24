import { Router } from "express";
import { requirePermission } from "../../auth/requirePermission.js";
import { getDashboardController } from "./dashboard.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("dashboard:read"), getDashboardController);

export { router as dashboardRouter };
