import { scaled } from "../../lib/rateLimit.js";
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
  limit: scaled(6),
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
    const user = await User.findById(sub).select("name email status").lean();
    if (!user || (user as { status?: string }).status === "deleted")
      return null;
    return { name: user.name, email: user.email };
  } catch {
    return null;
  }
}

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const IMAGE_SIGNATURES: Record<string, { ext: string; magic: number[] }> = {
  png: { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpeg: { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  webp: { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
};

// Pictures are only taken from signed-in people, so a stranger can't use the
// form to push files into the inbox. The bytes must really be that image type.
function toAttachment(dataUrl: string, signedIn: boolean) {
  if (!signedIn) {
    throw new AppError(
      400,
      "ATTACHMENT_REQUIRES_SIGN_IN",
      "Sign in to attach a screenshot.",
    );
  }
  const [header, base64] = dataUrl.split(",") as [string, string];
  const kind = header.slice("data:image/".length, header.indexOf(";"));
  const rules = IMAGE_SIGNATURES[kind]!;
  const bytes = Buffer.from(base64, "base64");
  const looksRight = rules.magic.every((byte, index) => bytes[index] === byte);
  if (!looksRight || bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new AppError(
      400,
      "INVALID_ATTACHMENT",
      "That picture couldn't be used. Try a smaller PNG, JPG or WebP.",
    );
  }
  return { name: `screenshot.${rules.ext}`, content: base64 };
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
      const attachment = input.screenshot
        ? toAttachment(input.screenshot, Boolean(sender))
        : undefined;
      await sendFeedbackEmail({
        to: env.FEEDBACK_TO_EMAIL,
        message: input.message,
        senderName: sender?.name ?? null,
        senderEmail: sender?.email ?? input.email ?? null,
        page: input.page ?? null,
        attachment,
      });
      res.status(202).json({ message: "Thank you for your feedback." });
    } catch (error) {
      next(error);
    }
  },
);

export { router as feedbackRouter };
