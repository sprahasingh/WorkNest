import { z } from "zod";
import { RECURRENCE_FREQUENCIES } from "../../models/Meeting.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const MAX_ATTENDEES = 100;
export const MAX_MEETING_HOURS = 12;
export const MAX_OCCURRENCES = 60;
const MAX_SERIES_DAYS = 800;

const webUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Use an http or https link");

const baseFields = {
  title: z.string().trim().min(1).max(120),
  agenda: z.string().trim().max(4000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  joinUrl: z
    .union([webUrl, z.literal("")])
    .nullable()
    .optional(),
  location: z.string().trim().max(200).optional(),
  attendeeIds: z.array(objectId).max(MAX_ATTENDEES).optional(),
  projectId: objectId.nullable().optional(),
  taskId: objectId.nullable().optional(),
};

function checkTimes(
  value: { startsAt?: Date; endsAt?: Date },
  context: z.RefinementCtx,
) {
  if (!value.startsAt || !value.endsAt) return;
  if (value.endsAt <= value.startsAt) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "The end time must be after the start time",
    });
  } else if (
    value.endsAt.getTime() - value.startsAt.getTime() >
    MAX_MEETING_HOURS * 60 * 60 * 1000
  ) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: `Meetings can run up to ${MAX_MEETING_HOURS} hours`,
    });
  }
}

// The browser works out each date, so repeats follow the person's own
// calendar, including daylight saving changes.
const repeatSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQUENCIES),
    starts: z.array(z.coerce.date()).min(2).max(MAX_OCCURRENCES),
  })
  .strict();

export const createMeetingSchema = z
  .object({ ...baseFields, repeat: repeatSchema.optional() })
  .strict()
  .superRefine((value, context) => {
    checkTimes(value, context);
    if (!value.repeat) return;
    const { starts } = value.repeat;
    const increasing = starts.every(
      (start, index) => index === 0 || start > starts[index - 1],
    );
    const spanDays =
      (starts[starts.length - 1].getTime() - starts[0].getTime()) / 86_400_000;
    if (
      starts[0].getTime() !== value.startsAt.getTime() ||
      !increasing ||
      spanDays > MAX_SERIES_DAYS
    ) {
      context.addIssue({
        code: "custom",
        path: ["repeat"],
        message: "The repeat dates aren't valid",
      });
    }
  });
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const scopeSchema = z.enum(["this", "all"]);

export const updateMeetingSchema = z
  .object({
    ...baseFields,
    title: baseFields.title.optional(),
    startsAt: baseFields.startsAt.optional(),
    endsAt: baseFields.endsAt.optional(),
    notes: z.string().trim().max(8000).optional(),
    scope: scopeSchema.optional(),
  })
  .strict()
  .superRefine(checkTimes);
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const meetingIdParamsSchema = z.object({ meetingId: objectId });
export const proposalParamsSchema = z.object({
  meetingId: objectId,
  userId: objectId,
});

export const respondSchema = z
  .object({
    response: z.enum(["accepted", "tentative", "declined"]),
    scope: scopeSchema.optional(),
  })
  .strict();

export const cancelSchema = z
  .object({ scope: scopeSchema.optional() })
  .strict()
  .optional();

export const proposeSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine(checkTimes);
export type ProposeInput = z.infer<typeof proposeSchema>;

export const listMeetingsQuerySchema = z
  .object({
    view: z.enum(["upcoming", "past", "range"]).default("upcoming"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    projectId: objectId.optional(),
    taskId: objectId.optional(),
  })
  .strict()
  .refine((value) => value.view !== "range" || (value.from && value.to), {
    message: "A range needs both from and to",
    path: ["from"],
  });
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
