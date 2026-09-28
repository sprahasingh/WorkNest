# WorkNest

A multi-tenant project and task management SaaS where organizations can invite members, assign roles, manage projects and tasks, and enforce plan limits. Every organization's data is isolated, and that isolation is enforced centrally in one place, not scattered across every query by hand.

## Table of Contents

| | Section |
|---|---|
| 01 | [Why I Built This](#why-i-built-this) |
| 02 | [Tech Stack](#tech-stack) |
| 03 | [Architecture](#architecture) |
| 04 | [Request Flow](#request-flow) |
| 05 | [Tenancy](#tenancy) |
| 06 | [RBAC](#rbac) |
| 07 | [Concurrency](#concurrency) |
| 08 | [Features](#features) |
| 09 | [API Example](#api-example) |
| 10 | [Local Setup](#local-setup) |
| 11 | [Seed Demo Data](#seed-demo-data) |
| 12 | [Testing](#testing) |
| 13 | [Project Structure](#project-structure) |

## Why I Built This

I wanted a project that went past CRUD and forced me to solve the parts of a real B2B SaaS that actually matter: how you guarantee one customer's data can never leak into another's, how you enforce who can do what without trusting the client, how two requests racing for the same limited resource resolve without either overselling it or serializing everything, and how all of that stays auditable after the fact. WorkNest is those four problems — multi-tenancy, RBAC, concurrent resource allocation, and auditability — built end to end, not mocked.

## Tech Stack

**Backend:** Node.js, TypeScript (strict), Express 5, MongoDB Atlas, Mongoose, Zod, JWT + bcrypt, Vitest + Supertest

**Frontend:** React 19, Vite, TypeScript (strict), React Router, TanStack Query, React Hook Form + Zod, Axios, Tailwind CSS v4, Recharts

## Architecture

### Request Flow

How a request to a tenant-scoped endpoint (e.g. `PATCH /api/orgs/:orgId/tasks/:taskId`) actually moves through the system, from the middleware chain in `app.ts` down to the query that finally hits MongoDB:

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

A caller who isn't a member of the target org gets a 404 regardless of whether that org actually exists — cross-tenant access and a nonexistent org are indistinguishable from the outside, so the API never confirms or denies an org's existence to someone who doesn't belong to it.

### Tenancy

Every organization's data lives in the same MongoDB database and collections, distinguished by a `tenantId` field. A single Mongoose plugin, applied to every tenant-owned model, does the enforcement:

- Query hooks (`find`, `updateOne`, `deleteMany`, `aggregate`, etc.) inject the current tenant's ID into the filter automatically.
- Document hooks stamp `tenantId` on create and reject any attempt to save a document with a mismatched tenant ID.
- `tenantId` is `immutable` in every schema, so no update can move a document to another tenant.
- If a query runs with no tenant context and isn't explicitly marked to skip tenant scoping, it throws rather than returning unscoped (i.e., all-tenants) data.

The tenant ID itself always comes from the URL (`/api/orgs/:orgId/...`), is validated against the caller's actual membership, and is then attached to an `AsyncLocalStorage` context for the rest of that request — no need to thread it through every function call by hand.

### RBAC

| Permission | admin | manager | member |
|---|---|---|---|
| org:read | ✓ | ✓ | ✓ |
| org:update, plan:change | ✓ | – | – |
| member:read | ✓ | ✓ | ✓ |
| member:manage | ✓ | – | – |
| invite:manage | ✓ | – | – |
| project:read | ✓ | ✓ | ✓ |
| project:write | ✓ | ✓ | – |
| task:read, task:create | ✓ | ✓ | ✓ |
| task:update:any, task:delete, task:assign | ✓ | ✓ | – |
| task:update:own | ✓ | ✓ | ✓ |
| audit:read | ✓ | – | – |
| dashboard:read | ✓ | ✓ | – |

RBAC and ownership are checked separately: RBAC answers "can this role do this kind of action at all," ownership answers "on this specific task." A last-admin rule guarantees an organization always keeps at least one admin, enforced with a conditional update inside the same transaction as the role change or removal so two concurrent demotions can't both succeed.

### Concurrency

Seat and project-slot limits are enforced with atomic, condition-guarded MongoDB updates (`findOneAndUpdate` with an `$expr` condition) inside transactions, not a check-then-write pattern — so concurrent requests racing for the last available seat or project slot can't overshoot the limit.

## Features

- **Multi-tenant isolation** — a single Mongoose plugin enforces tenant scoping on every query, write, and aggregation across all tenant-owned collections, propagated via `AsyncLocalStorage` request context. Fails closed: a query with no tenant context throws rather than silently returning data.
- **Authentication** — JWT access tokens (15 min) plus rotating refresh tokens; only refresh-token hashes are ever stored server-side. Reuse of an already-rotated refresh token — a sign of a stolen token — revokes the entire token family and forces re-login.
- **Role-based access control** — three roles (admin, manager, member) across a fixed permission set, enforced server-side on every request. The frontend hides controls a role can't use, but the API is the actual authority.
- **Organizations and plans** — free and pro plans with seat and project limits. Upgrading is simulated; downgrading is blocked if current usage exceeds the target plan's limits, with the exact excess reported back.
- **Invites** — one-time-reveal invite links (only the token's hash is ever stored), with seat reservation that holds correctly under concurrent invite requests.
- **Projects and tasks** — cursor-paginated task boards with status, priority, assignee, and due-date filters; ownership rules on top of RBAC (a member can edit a task they created or are assigned to, but can't reassign it); optimistic status updates on the board with rollback on failure.
- **Audit log** — every mutating action (org, member, invite, project, task, and plan changes) is recorded inside the same transaction as the change itself, so a rolled-back action never leaves a log entry. Rendered as human-readable rows with filters and cursor pagination.
- **Dashboard** — task counts by status and priority, a 14-day task-creation trend, top assignees by open task count, overdue count, and plan usage, gated to roles with dashboard access.

## API Example

Every error follows the same envelope, with a `details` array whose shape depends on the error code. Downgrading a plan while usage exceeds the target plan's limits, for example:

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

Requires Node 24 (see `.nvmrc`) and a MongoDB Atlas cluster (the free M0 tier works — it's a replica set, which transactions require).

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

- **Acme Corp** (free plan) — `admin@acme.demo`, `manager@acme.demo`, `member@acme.demo`
- **Globex Corporation** (pro plan) — `admin@globex.demo`

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

The backend test suite covers tenant isolation (including that the plugin fails closed with no context, and that cross-tenant reads/writes/aggregates are correctly scoped), the full RBAC permission matrix (every role × every permission), concurrent seat/project-slot allocation, the last-admin invariant under concurrent demotion, and refresh-token rotation with reuse detection.

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
