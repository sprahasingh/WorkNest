import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { verifyAccessToken } from "../../lib/jwt.js";
import { User } from "../../models/User.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { sendFeedbackEmail } from "../../lib/email.js";
import { feedbackSchema, type FeedbackInput } from "./feedback.schemas.js";

const router = Router();

// A handful an hour is plenty for real feedback and keeps the inbox safe.
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

// Anyone can send feedback. When they are signed in, their name and email are
// added so the reply knows who it is from.
async function signedInSender(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { sub } = verifyAccessToken(header.slice("Bearer ".length));
    const user = await User.findById(sub).select("name email").lean();
    return user ? { name: user.name, email: user.email } : null;
  } catch {
    return null;
  }
}

router.get("/", (_req: Request, res: Response) => {
  // Lets the app know whether to show the form or an email link.
  res.status(200).json({ enabled: Boolean(env.FEEDBACK_TO_EMAIL) });
});

router.post(
  "/",
  feedbackLimiter,
  validate({ body: feedbackSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.validated!.body as FeedbackInput;
      // Bots get the same "thanks" and nothing is sent.
      if (input.website) {
        res.status(202).json({ message: "Thank you for your feedback." });
        return;
      }
      if (!env.FEEDBACK_TO_EMAIL) {
        throw new AppError(
          503,
          "FEEDBACK_UNAVAILABLE",
          "Sending feedback from here isn't set up yet.",
        );
      }
      const sender = await signedInSender(req);
      await sendFeedbackEmail({
        to: env.FEEDBACK_TO_EMAIL,
        message: input.message,
        senderName: sender?.name ?? null,
        senderEmail: sender?.email ?? input.email ?? null,
        page: input.page ?? null,
      });
      res.status(202).json({ message: "Thank you for your feedback." });
    } catch (error) {
      next(error);
    }
  },
);

export { router as feedbackRouter };
