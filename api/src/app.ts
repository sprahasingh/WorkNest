import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { authenticate } from "./auth/authenticate.js";
import { resolveTenant } from "./tenancy/resolveTenant.js";
import { membersRouter } from "./modules/members/members.routes.js";
import { orgsRouter } from "./modules/orgs/orgs.routes.js";
import { invitesRouter } from "./modules/invites/invites.routes.js";
import { invitesPublicRouter } from "./modules/invites/invitesPublic.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import {
  projectTasksRouter,
  tasksRouter,
} from "./modules/tasks/tasks.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", db: "connected", uptime: process.uptime() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/invites", invitesPublicRouter);

  const orgRouter = express.Router({ mergeParams: true });
  orgRouter.use("/members", membersRouter);
  orgRouter.use("/", orgsRouter);
  orgRouter.use("/invites", invitesRouter);
  orgRouter.use("/projects", projectsRouter);
  orgRouter.use("/projects/:projectId/tasks", projectTasksRouter);
  orgRouter.use("/tasks", tasksRouter);
  app.use("/api/orgs/:orgId", authenticate, resolveTenant, orgRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
