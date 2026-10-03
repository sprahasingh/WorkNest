import type { Request, Response } from "express";
import {
  acceptProposal,
  cancelMeeting,
  createMeeting,
  dismissProposal,
  getMeeting,
  getMeetingSummary,
  listMeetings,
  proposeTime,
  respondToMeeting,
  updateMeeting,
} from "./meetings.service.js";
import type {
  CreateMeetingInput,
  ListMeetingsQuery,
  ProposeInput,
  UpdateMeetingInput,
} from "./meetings.schemas.js";

const params = (req: Request) =>
  req.validated!.params as { meetingId: string; userId?: string };

export async function listMeetingsController(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(200)
    .json(await listMeetings(req.validated!.query as ListMeetingsQuery));
}

export async function summaryController(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await getMeetingSummary());
}

export async function getMeetingController(
  req: Request,
  res: Response,
): Promise<void> {
  res.status(200).json(await getMeeting(params(req).meetingId));
}

export async function createMeetingController(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(201)
    .json(await createMeeting(req.validated!.body as CreateMeetingInput));
}

export async function updateMeetingController(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(200)
    .json(
      await updateMeeting(
        params(req).meetingId,
        req.validated!.body as UpdateMeetingInput,
      ),
    );
}

export async function cancelMeetingController(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.validated!.body as { scope?: "this" | "all" } | undefined;
  res.status(200).json(await cancelMeeting(params(req).meetingId, body?.scope));
}

export async function respondController(
  req: Request,
  res: Response,
): Promise<void> {
  const { response, scope } = req.validated!.body as {
    response: "accepted" | "tentative" | "declined";
    scope?: "this" | "all";
  };
  res
    .status(200)
    .json(await respondToMeeting(params(req).meetingId, response, scope));
}

export async function proposeController(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(200)
    .json(
      await proposeTime(
        params(req).meetingId,
        req.validated!.body as ProposeInput,
      ),
    );
}

export async function acceptProposalController(
  req: Request,
  res: Response,
): Promise<void> {
  const { meetingId, userId } = params(req);
  res.status(200).json(await acceptProposal(meetingId, userId!));
}

export async function dismissProposalController(
  req: Request,
  res: Response,
): Promise<void> {
  const { meetingId, userId } = params(req);
  res.status(200).json(await dismissProposal(meetingId, userId!));
}
