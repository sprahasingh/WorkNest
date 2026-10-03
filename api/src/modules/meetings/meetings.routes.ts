import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  cancelSchema,
  createMeetingSchema,
  listMeetingsQuerySchema,
  meetingIdParamsSchema,
  proposalParamsSchema,
  proposeSchema,
  respondSchema,
  updateMeetingSchema,
} from "./meetings.schemas.js";
import {
  acceptProposalController,
  cancelMeetingController,
  createMeetingController,
  dismissProposalController,
  getMeetingController,
  listMeetingsController,
  proposeController,
  respondController,
  summaryController,
  updateMeetingController,
} from "./meetings.controller.js";

const meetingsRouter = Router({ mergeParams: true });

meetingsRouter.get("/summary", summaryController);
meetingsRouter.get(
  "/",
  validate({ query: listMeetingsQuerySchema }),
  listMeetingsController,
);
meetingsRouter.post(
  "/",
  validate({ body: createMeetingSchema }),
  createMeetingController,
);
meetingsRouter.get(
  "/:meetingId",
  validate({ params: meetingIdParamsSchema }),
  getMeetingController,
);
meetingsRouter.patch(
  "/:meetingId",
  validate({ params: meetingIdParamsSchema, body: updateMeetingSchema }),
  updateMeetingController,
);
meetingsRouter.post(
  "/:meetingId/cancel",
  validate({ params: meetingIdParamsSchema, body: cancelSchema }),
  cancelMeetingController,
);
meetingsRouter.put(
  "/:meetingId/response",
  validate({ params: meetingIdParamsSchema, body: respondSchema }),
  respondController,
);
meetingsRouter.post(
  "/:meetingId/proposals",
  validate({ params: meetingIdParamsSchema, body: proposeSchema }),
  proposeController,
);
meetingsRouter.post(
  "/:meetingId/proposals/:userId/accept",
  validate({ params: proposalParamsSchema }),
  acceptProposalController,
);
meetingsRouter.delete(
  "/:meetingId/proposals/:userId",
  validate({ params: proposalParamsSchema }),
  dismissProposalController,
);

export { meetingsRouter };
