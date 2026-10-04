import { billingRouter } from "./modules/billing/billing.routes.js";
import { webhookController } from "./modules/billing/billing.controller.js";
import express, { type Express } from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { feedbackRouter } from "./modules/feedback/feedback.routes.js";
import { authenticate } from "./auth/authenticate.js";
import { resolveTenant } from "./tenancy/resolveTenant.js";
import { membersRouter } from "./modules/members/members.routes.js";
import { orgsRouter } from "./modules/orgs/orgs.routes.js";
import { createOrgController } from "./modules/orgs/orgs.controller.js";
import { createOrgSchema } from "./modules/orgs/orgs.schemas.js";
import { validate } from "./middleware/validate.js";
import { invitesRouter } from "./modules/invites/invites.routes.js";
import { invitesPublicRouter } from "./modules/invites/invitesPublic.routes.js";
import { myInvitesRouter } from "./modules/invites/myInvites.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import {
  projectTasksRouter,
  projectActivityRouter,
  tasksRouter,
} from "./modules/tasks/tasks.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { chatRouter } from "./modules/chat/chat.routes.js";
import { meetingsRouter } from "./modules/meetings/meetings.routes.js";
import { downloadChatFileController } from "./modules/chat/chatFiles.controller.js";

export function createApp(): Express {
  const app = express();

  if (env.NODE_ENV === "production") {
    app.set("trust proxy", env.TRUST_PROXY_HOPS);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  // Razorpay signs the exact bytes it sends, so its webhook needs the raw body.
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "100kb" }),
    webhookController,
  );
  // Feedback may carry one small screenshot; everything else stays tiny.
  app.use("/api/feedback", express.json({ limit: "3mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.get("/api/health", healthLimiter, (_req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    res.status(dbConnected ? 200 : 503).json({
      status: dbConnected ? "ok" : "degraded",
      db: dbConnected ? "connected" : "disconnected",
    });
  });

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    // Chat has its own, more generous limit below: it refreshes often and a
    // whole office can share one IP address.
    skip: (req) =>
      /^\/api\/orgs\/[^/]+\/chat(\/|$)/.test(req.path) ||
      req.path.startsWith("/api/chat-files/") ||
      req.path === "/api/auth/registration-status",
  });
  app.use(globalLimiter);

  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? "anonymous",
    validate: { keyGeneratorIpFallback: false },
  });

  // Chat files load through <img> and links, which can't send a login header,
  // so they carry a short-lived signed token and are checked on every open.
  const fileLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.get("/api/chat-files/:token", fileLimiter, downloadChatFileController);

  app.use("/api/auth", authRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/invites", invitesPublicRouter);
  app.use("/api/me/invites", myInvitesRouter);

  app.post(
    "/api/orgs",
    authenticate,
    validate({ body: createOrgSchema }),
    createOrgController,
  );

  const orgRouter = express.Router({ mergeParams: true });
  orgRouter.use("/members", membersRouter);
  orgRouter.use("/", orgsRouter);
  orgRouter.use("/invites", invitesRouter);
  orgRouter.use("/projects", projectsRouter);
  orgRouter.use("/projects/:projectId/tasks", projectTasksRouter);
  orgRouter.use("/projects/:projectId/activity", projectActivityRouter);
  orgRouter.use("/tasks", tasksRouter);
  orgRouter.use("/audit-logs", auditRouter);
  orgRouter.use("/dashboard", dashboardRouter);
  orgRouter.use("/notifications", notificationsRouter);
  orgRouter.use("/chat", chatLimiter, chatRouter);
  orgRouter.use("/meetings", meetingsRouter);
  orgRouter.use("/billing", billingRouter);
  app.use("/api/orgs/:orgId", authenticate, resolveTenant, orgRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
