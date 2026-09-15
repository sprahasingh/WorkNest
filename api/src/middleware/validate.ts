import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

declare module "express-serve-static-core" {
  interface Request {
    validated?: {
      body?: unknown;
      params?: unknown;
      query?: unknown;
    };
  }
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.validated = {};

    if (schemas.body) {
      req.validated.body = schemas.body.parse(req.body);
    }
    if (schemas.params) {
      req.validated.params = schemas.params.parse(req.params);
    }
    if (schemas.query) {
      req.validated.query = schemas.query.parse(req.query);
    }

    next();
  };
}
