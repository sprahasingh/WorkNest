import type { Request, Response } from "express";
import { Membership } from "../../models/Membership.js";
import { changeMemberRole, removeMember } from "./members.service.js";
import type { ChangeRoleInput } from "./members.schemas.js";

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

  await removeMember(memberId as string);

  res.status(204).send();
}
