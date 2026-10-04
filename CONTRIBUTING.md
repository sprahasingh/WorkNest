# Working on WorkNest

The README has the setup. These are the checks to run before opening a pull request, and the same ones CI runs.

```bash
cd api && npm run lint && npm run typecheck && npm run format:check && npm test
cd web && npm run lint && npm run format:check && npm run screens:check && npm run build
cd e2e && npm run typecheck && npm test
```

A few habits:

- Every route that works on an organization's data needs a test showing another organization can't reach it. `api/tests/crossTenantRoutes.test.ts` covers every route at once, and it finds new routes by reading the route files.
- Anything that changes how a screen looks should come with a before and after picture in the pull request.
- Keep the README and the How to use guide in step with what you change.
