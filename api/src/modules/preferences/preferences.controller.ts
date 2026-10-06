import type { Request, Response } from "express";
import { UserPreference } from "../../models/UserPreference.js";
import type {
  GetLifecycleSortPreferencesQuery,
  PutLifecycleSortPreferenceInput,
} from "./preferences.schemas.js";

export async function getLifecycleSortPreferencesController(
  req: Request,
  res: Response,
): Promise<void> {
  const { context } = req.validated!.query as GetLifecycleSortPreferencesQuery;
  const preferences = await UserPreference.find({
    userId: req.auth!.userId,
    context,
  }).lean();
  res.status(200).json({
    preferences: Object.fromEntries(
      preferences.map(({ view, sort }) => [view, sort]),
    ),
  });
}

export async function putLifecycleSortPreferenceController(
  req: Request,
  res: Response,
): Promise<void> {
  const { context, view, sort } = req.validated!
    .body as PutLifecycleSortPreferenceInput;
  await UserPreference.findOneAndUpdate(
    { userId: req.auth!.userId, context, view },
    { $set: { sort } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );
  res.status(200).json({ context, view, sort });
}
