import { Router } from "express";
import { requirePermission } from "../../auth/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { changeRoleSchema, removeMemberSchema } from "./members.schemas.js";
import {
  listMembersController,
  changeMemberRoleController,
  removeMemberController,
  meetingImpactController,
} from "./members.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("member:read"), listMembersController);
router.patch(
  "/:memberId",
  requirePermission("member:manage"),
  validate({ body: changeRoleSchema }),
  changeMemberRoleController,
);

router.get("/:memberId/meeting-impact", meetingImpactController);
router.delete(
  "/:memberId",
  validate({ body: removeMemberSchema }),
  removeMemberController,
);
export { router as membersRouter };
