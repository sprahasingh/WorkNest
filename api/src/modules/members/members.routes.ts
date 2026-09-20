import { Router } from "express";
import { requirePermission } from "../../auth/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { changeRoleSchema } from "./members.schemas.js";
import {
  listMembersController,
  changeMemberRoleController,
  removeMemberController,
} from "./members.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("member:read"), listMembersController);
router.patch(
  "/:memberId",
  requirePermission("member:manage"),
  validate({ body: changeRoleSchema }),
  changeMemberRoleController,
);

router.delete(
  "/:memberId",
  requirePermission("member:manage"),
  removeMemberController,
);
export { router as membersRouter };
