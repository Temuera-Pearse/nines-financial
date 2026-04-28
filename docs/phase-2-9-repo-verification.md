# Phase 2.9 Repo Verification

Use the repo-local `verify` script before moving work toward Phase 3.

| Repo | Standard command | Notes |
| --- | --- | --- |
| `nines-financial` | `npm run verify` | Runs typecheck, Vitest, and build. Lint is not configured yet. |
| `nines-back-end` | `npm run verify` | Runs TypeScript checks, Vitest, and build. Lint is not configured yet. |
| `nines-front-end` | `npm run verify` | Runs TypeScript checks and Vite build. Tests and lint are not configured yet. |
| `nines-admin` | `npm run verify` | Runs TypeScript checks, any future test script, and build. Currently blocked in this checkout because admin dependencies are not installed (`tsc: command not found`). |

Generated outputs are not source of truth and should stay out of Git:

- `dist/` and `dist-ssr/`
- `node_modules/`
- `.vite/`
- `.vitest/`
- `coverage/`
- `test-results/`
- local `.env*` files, except checked-in examples
- log files
