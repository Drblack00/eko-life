# Èkó Life 🌆

An original Lagos-inspired 3D life-simulation web game (working title).
100% original code, art, and copy — see `docs/`.

## Quick start

```bash
npm run install:all
npm run build:web   # build the client
npm start           # server on http://localhost:3000 (serves client + API + WS)
```

Local dev: `npm run dev:server` + `npm run dev:web` (Vite on :5173, proxy `/api`+`/ws`).

## Tests

```bash
npm test       # server unit + WS integration tests (node:test) — 108/108
npm run test:all  # server tests + client vitest unit tests (36 tests)
```

## Deploy

Render Blueprint (`render.yaml`): one web service + Postgres. `SESSION_SECRET`
and `DATABASE_URL` are injected by Render.

## Docs

- `docs/AUDIT_REPORT.md` — reference feature inventory (facts only, paraphrased)
- `docs/PROJECT_PLAN.md` — platform recommendation & milestones
- `docs/ARCHITECTURE.md` — stack decision, module layout, invariants
- `docs/API_SPEC.md` — REST + WebSocket contract (the client/server boundary)
- `docs/SECURITY.md` — threat model, rate limits, headers, M6 re-scan results
- `docs/DEPLOY.md` — Render Blueprint deploy guide + post-deploy smoke test
- `docs/A11Y.md` — M6 accessibility static audit (pass/fail per item)
- `docs/KNOWN_LIMITATIONS.md` — everything unverified or out of scope
- `docs/PARITY_CHECKLIST.md` — parity vs audit, per milestone
