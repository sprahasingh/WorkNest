import type { Request, Response } from "express";
import { Membership } from "../../models/Membership.js";
import { can } from "../../auth/rbac.js";
import { AppError } from "../../lib/errors.js";
import { getTenantContext } from "../../tenancy/context.js";
import type { Role } from "../../constants/roles.js";
import { describeMeetingImpact } from "../people/departure.service.js";
import { changeMemberRole, removeMember } from "./members.service.js";
import type { ChangeRoleInput, RemoveMemberInput } from "./members.schemas.js";

export async function listMembersController(
  req: Request,
  res: Response,
): Promise<void> {
  const members = await Membership.find({}).populate("userId", "name email");

  res.status(200).json({ members });
}

export async function changeMemberRoleController(
  req: Request,
  res: Response,
): Promise<void> {
  const { memberId } = req.params;
  const input = req.validated!.body as ChangeRoleInput;

  const membership = await changeMemberRole(memberId as string, input.role);

  res.status(200).json({ member: membership });
}

export async function removeMemberController(
  req: Request,
  res: Response,
): Promise<void> {
  const { memberId } = req.params;
  const input = req.validated?.body as RemoveMemberInput;

  await removeMember(memberId as string, input?.meetings);

  res.status(204).send();
}

// Before removing someone (or leaving): how many upcoming meetings they run.
export async function meetingImpactController(
  req: Request,
  res: Response,
): Promise<void> {
  const context = getTenantContext()!;
  const membership = await Membership.findById(req.params.memberId);
  if (!membership) {
    throw new AppError(404, "NOT_FOUND", "Member not found");
  }
  const isSelf = String(membership.userId) === context.userId;
  if (!isSelf && !can(context.role as Role, "member:manage")) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission");
  }
  res
    .status(200)
    .json(await describeMeetingImpact(String(membership.userId), isSelf));
}
