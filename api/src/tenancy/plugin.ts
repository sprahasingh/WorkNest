import mongoose, { Schema, Query } from "mongoose";
import { getTenantContext, requireTenantId } from "./context.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";

const QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "countDocuments",
  "distinct",
] as const;

export function tenantPlugin(schema: Schema): void {
  QUERY_HOOKS.forEach((hookName) => {
    schema.pre(hookName, function (this: Query<unknown, unknown>) {
      const options = this.getOptions();

      if (options.skipTenant) {
        logger.warn(
          { collection: this.model.collection.collectionName, op: hookName },
          "skipTenant used",
        );
        return;
      }

      const tenantId = requireTenantId();
      this.where({ tenantId });
    });
  });

  schema.pre("validate", function () {
    const doc = this as unknown as {
      tenantId?: mongoose.Types.ObjectId | string;
      $locals: Record<string, unknown>;
    };

    if (doc.$locals?.skipTenant) {
      logger.warn({ op: "validate" }, "skipTenant used");
      return;
    }

    const context = getTenantContext();

    if (!context) {
      throw new AppError(
        500,
        "TENANT_CONTEXT_MISSING",
        "No tenant context available for this operation",
      );
    }

    if (doc.tenantId === undefined || doc.tenantId === null) {
      doc.tenantId = context.tenantId;
    } else if (doc.tenantId.toString() !== context.tenantId) {
      throw new AppError(
        403,
        "TENANT_MISMATCH",
        "Document tenantId does not match current tenant context",
      );
    }
  });

  schema.pre("insertMany", function (docs: unknown) {
    const context = getTenantContext();

    if (!context) {
      throw new AppError(
        500,
        "TENANT_CONTEXT_MISSING",
        "No tenant context available for this operation",
      );
    }

    const documents = Array.isArray(docs)
      ? (docs as Array<{ tenantId?: unknown }>)
      : [docs as { tenantId?: unknown }];

    for (const doc of documents) {
      doc.tenantId = context.tenantId;
    }
  });

  schema.pre("aggregate", function (this: mongoose.Aggregate<unknown>) {
    const options = this.options ?? {};

    if (options.skipTenant) {
      logger.warn({ op: "aggregate" }, "skipTenant used");
      return;
    }

    const tenantId = requireTenantId();
    this.pipeline().unshift({
      $match: { tenantId: new mongoose.Types.ObjectId(tenantId) },
    });
  });
}
