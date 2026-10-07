import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import {
  getLifecycleSortPreferencesSchema,
  putLifecycleSortPreferenceSchema,
} from "./preferences.schemas.js";
import {
  getLifecycleSortPreferencesController,
  putLifecycleSortPreferenceController,
} from "./preferences.controller.js";

const router = Router({ mergeParams: true });

router.get(
  "/lifecycle-sort",
  requirePermission("org:read"),
  validate({ query: getLifecycleSortPreferencesSchema }),
  getLifecycleSortPreferencesController,
);

router.put(
  "/lifecycle-sort",
  requirePermission("org:read"),
  validate({ body: putLifecycleSortPreferenceSchema }),
  putLifecycleSortPreferenceController,
);

export { router as preferencesRouter };
