# WorkNest

A multi-tenant project and task management SaaS with organizations, roles, projects, tasks, and plan limits. Tenant isolation is enforced centrally instead of relying on every query to remember to add a `tenantId` filter.

## Table of Contents

|     | Section                                 |
| --- | --------------------------------------- |
| 01  | [Why I Built This](#why-i-built-this)   |
| 02  | [Tech Stack](#tech-stack)               |
| 03  | [Architecture](#architecture)           |
| 04  | [Request Flow](#request-flow)           |
| 05  | [Tenancy](#tenancy)                     |
| 06  | [RBAC](#rbac)                           |
| 07  | [Concurrency](#concurrency)             |
| 08  | [Features](#features)                   |
| 09  | [API Example](#api-example)             |
| 10  | [Local Setup](#local-setup)             |
| 11  | [Seed Demo Data](#seed-demo-data)       |
| 12  | [Testing](#testing)                     |
| 13  | [Project Structure](#project-structure) |

## Why I Built This

I wanted a project that went past CRUD and forced me to deal with some of the harder parts of a B2B SaaS. I wanted to solve tenant isolation, server-side authorization, concurrent resource allocation, and auditability properly. WorkNest focuses on four problems: multi-tenancy, RBAC, concurrency, and auditability.

## Tech Stack

**Backend:** Node.js, TypeScript (strict), Express 5, MongoDB Atlas, Mongoose, Zod, JWT + bcrypt, Vitest + Supertest

**Frontend:** React 19, Vite, TypeScript (strict), React Router, TanStack Query, React Hook Form + Zod, Axios, Tailwind CSS v4, Recharts

## Architecture

### Request Flow

A request to a tenant-scoped endpoint such as `PATCH /api/orgs/:orgId/tasks/:taskId` moves through the middleware chain in `app.ts` before reaching the MongoDB query:

```mermaid
flowchart TD
    A["Client request<br/>/api/orgs/:orgId/..."] --> B["authenticate<br/>verify JWT access token"]
    B --> C["resolveTenant<br/>validate :orgId, look up Membership"]
    C --> D{"Membership found?"}
    D -->|no| E["404 Not Found"]
    D -->|yes| F["runWithTenant<br/>AsyncLocalStorage context"]
    F --> G["requirePermission<br/>RBAC check"]
    G -->|denied| H["403 Forbidden"]
    G -->|allowed| I["Route handler<br/>controller / service"]
    I --> J["Mongoose tenant plugin<br/>injects tenantId into the<br/>query, write, or aggregate"]
    J --> K[("MongoDB<br/>tenant-scoped read/write")]
    K --> L["Response"]
```

A caller who isn't a member of the target org gets a 404 regardless of whether that org actually exists. Cross-tenant access and a nonexistent org are indistinguishable from the outside, so the API never confirms or denies an org's existence to someone who doesn't belong to it.

### Tenancy

Every organization's data lives in the same MongoDB database and collections, distinguished by a `tenantId` field. A single Mongoose plugin, applied to every tenant-owned model, does the enforcement:

- Query hooks (`find`, `updateOne`, `deleteMany`, `aggregate`, etc.) inject the current tenant's ID into the filter automatically.
- Document hooks stamp `tenantId` on create and reject any attempt to save a document with a mismatched tenant ID.
- `tenantId` is `immutable` in every schema, so no update can move a document to another tenant.
- If a query runs with no tenant context and isn't explicitly marked to skip tenant scoping, it throws rather than returning unscoped (i.e., all-tenants) data.

The tenant ID comes from the URL (`/api/orgs/:orgId/...`), is validated against the caller's membership, and is stored in an `AsyncLocalStorage` context for the rest of the request. This avoids passing the tenant ID through every function call.

### RBAC

| Permission                                | admin | manager | member |
| ----------------------------------------- | ----- | ------- | ------ |
| org:read                                  | ✓     | ✓       | ✓      |
| org:update, plan:change                   | ✓     | –       | –      |
| member:read                               | ✓     | ✓       | ✓      |
| member:manage                             | ✓     | –       | –      |
| invite:manage                             | ✓     | –       | –      |
| project:read                              | ✓     | ✓       | ✓      |
| project:write                             | ✓     | ✓       | –      |
| task:read, task:create                    | ✓     | ✓       | ✓      |
| task:update:any, task:delete, task:assign | ✓     | ✓       | –      |
| task:update:own                           | ✓     | ✓       | ✓      |
| audit:read                                | ✓     | –       | –      |
| dashboard:read                            | ✓     | ✓       | –      |

RBAC and ownership are checked separately. RBAC determines whether the role can perform an action, while ownership determines whether the user can perform it on a specific task. A last-admin rule prevents an organization from ending up with zero admins. The check is done with a conditional update inside the same transaction as the role change or removal, so two concurrent demotions can't both succeed.

### Concurrency

Seat and project-slot limits use atomic MongoDB updates with `$expr` conditions inside transactions. This avoids the usual check-then-write race when two requests compete for the last available seat or project slot.

## Features

- **Multi-tenant isolation**: a single Mongoose plugin enforces tenant scoping on every query, write, and aggregation across all tenant-owned collections. The current tenant is stored in `AsyncLocalStorage` for the duration of the request. It fails closed: a query with no tenant context throws rather than silently returning data.
- **Authentication**: JWT access tokens (15 min) plus rotating refresh tokens; only refresh-token hashes are ever stored server-side. Reusing an already-rotated refresh token revokes the entire token family and requires the user to log in again.
- **Role-based access control**: three roles (admin, manager, member) across a fixed permission set, enforced server-side on every request. The frontend hides controls a role can't use, but all permission checks are enforced by the API.
- **Organizations and plans**: free and pro plans with seat and project limits. Upgrading is simulated; downgrading is blocked if current usage exceeds the target plan's limits, with the excess reported in the error response.
- **Invites**: one-time-reveal invite links (only the token's hash is ever stored), with seat reservation handled atomically under concurrent invite requests.
- **Projects and tasks**: cursor-paginated task boards with status, priority, assignee, and due-date filters; ownership rules on top of RBAC (a member can edit a task they created or are assigned to, but can't reassign it); optimistic status updates on the board with rollback on failure.
- **Audit log**: every mutating action (org, member, invite, project, task, and plan changes) is recorded inside the same transaction as the change itself, so a rolled-back action never leaves a log entry. The UI renders these as human-readable rows with filters and cursor pagination.
- **Dashboard**: task counts by status and priority, a 14-day task-creation trend, top assignees by open task count, overdue count, and plan usage, gated to roles with dashboard access.

## API Example

API errors use the same envelope. The details array varies by error code. Downgrading a plan while usage exceeds the target plan's limits, for example:

```
POST /api/orgs/:orgId/plan
{ "plan": "free" }
```

```json
409 Conflict
{
  "error": {
    "code": "PLAN_DOWNGRADE_BLOCKED",
    "message": "Current usage exceeds the limits of the target plan",
    "details": [
      { "seatsUsed": 6, "projectCount": 4, "targetSeatLimit": 5, "targetProjectLimit": 3 }
    ]
  }
}
```

## Local Setup

Requires Node 24 (see .nvmrc) and a MongoDB Atlas cluster. The free M0 tier works because it supports replica sets, which MongoDB transactions require.

```bash
git clone https://github.com/sprahasingh/WorkNest.git
cd WorkNest
```

**Backend:**

```bash
cd api
npm install
cp .env.example .env   # fill in MONGODB_URI and JWT_ACCESS_SECRET
npm run dev            # runs on http://localhost:4000
```

**Frontend** (in a separate terminal):

```bash
cd web
npm install
npm run dev             # runs on http://localhost:5173, proxies /api to localhost:4000
```

Open `http://localhost:5173` and register a new account, or seed demo data first (see below).

### Seed Demo Data

```bash
cd api
npm run seed
```

Creates two demo organizations (password `password123` for all accounts):

- **Acme Corp** (free plan): `admin@acme.demo`, `manager@acme.demo`, `member@acme.demo`
- **Globex Corporation** (pro plan): `admin@globex.demo`

## Testing

```bash
cd api
npm test          # 44 tests across 11 files, run against an in-memory MongoDB replica set
npm run typecheck
npm run lint
```

```bash
cd web
npm run build      # includes a full TypeScript build
npm run lint
```

The backend test suite covers tenant isolation, including fail-closed behavior when there is no tenant context. It also covers the full RBAC permission matrix, concurrent seat/project-slot allocation, the last-admin invariant under concurrent demotion, and refresh-token rotation with reuse detection.

## Project Structure

```
api/
  src/
    tenancy/       AsyncLocalStorage context, the isolation plugin, tenant resolution middleware
    auth/           authentication middleware, RBAC, ownership checks
    modules/        one folder per domain area (auth, orgs, members, invites, projects, tasks, audit, dashboard)
    models/         one Mongoose schema per collection
  tests/            Vitest + Supertest, against mongodb-memory-server
web/
  src/
    auth/            AuthProvider, route guards
    features/        one folder per domain area, each with its own api/queries/components
    components/      shared UI (layout, modal, error boundary)
    hooks/            useCan (permission checks), useOrg (tenant context)
```

## Author

**Spraha Singh** · [GitHub](https://github.com/sprahasingh)
