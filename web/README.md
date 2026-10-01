# WorkNest Web App

The WorkNest client is a React 19, TypeScript, and Vite application. It includes the public landing page and guide, account and organization flows, project and task boards, plan settings, dashboard, notifications, and audit log.

## Development

Run `npm install` and then `npm run dev`. The development server runs at `http://localhost:5173` and proxies API requests to the backend at `http://localhost:4000`.

## Checks

Run `npm run build` to typecheck and build the client. Run `npm run lint` to check the source.

Project limits apply to active projects only. Completed, archived, and binned projects do not use a project slot. Each plan also sets a separate per-project limit for active tasks.
