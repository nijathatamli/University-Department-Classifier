# Architecture

## Overview

Two processes. Node serves the API and the static frontend; Python serves the model.

```
Browser
  │
  ├── GET /                     → web/index.html   (landing page, self-contained + Three.js)
  ├── GET /classifier, /requests… → web/<page>.html  (shared design system, ES modules)
  └── /api/v1/*                 → Fastify JSON API
                                      │
                                      ▼
                          Route → validation → Service   ← business rules, ownership, isolation
                                      │
                                      ├── Repository     ← all SQL, parameterised
                                      │        │
                                      │        ▼
                                      │    PostgreSQL
                                      │
                                      └── classifier-client (HTTP, localhost only)
                                               │
                                               ▼
                                        ml/serve.py (FastAPI)
                                               │
                                        classifier.joblib
                                        (loaded once at start-up)
```

The browser never talks to the model service. Authentication, ownership and persistence all live
on the Node side; Python does one job — turn text into a probability distribution.

## Layering rules

| Layer | May depend on | Must never |
|---|---|---|
| `routes/` | services, validation, http helpers | write SQL, contain business rules |
| `services/` | repositories, classifier-client | know about HTTP requests or replies |
| `repositories/` | `db/pool` | contain business rules |
| `ml/` (Python) | nothing in the app | know about users, tickets or the database |

## The core request flow

`POST /api/v1/requests` — everything the product does, in one path:

1. `preHandler: requireAuth` rejects anonymous callers (401).
2. The route validates the message (10–4000 characters) and returns 400 listing every bad field.
3. `request.service.submitRequest()`:
   - calls `classifyText()` → the Python service returns `{label, confidence, probabilities}`,
   - resolves the label to a department row by name; a label with no matching department is a
     seed/retraining mismatch and fails loudly (500) rather than mis-routing,
   - `createRequestWithPrediction()` inserts the ticket **and** its prediction in one transaction,
     so a ticket can never exist without the classification that routed it,
   - writes an audit entry.
4. The created ticket is read back through the view query and returned.

If the model service is unreachable the client throws `CLASSIFIER_UNAVAILABLE` (503) and no ticket
is created — the student is told to try again rather than getting an unrouted ticket.

## Authorization model

Three roles, enforced in services rather than routes:

| | STUDENT | DEPARTMENT | ADMIN |
|---|---|---|---|
| Read and edit **own** account (`/profile`) | ✅ | ✅ | ✅ |
| Submit a request | ✅ | ✅ | ✅ |
| Read own requests | ✅ | ✅ | ✅ |
| Read a request assigned to their department | — | ✅ | ✅ (any) |
| Change a request's status | — | ✅ (own department only) | ✅ |
| Department queue | — | ✅ (own only) | ✅ (any, via parameter) |
| Admin console | — | — | ✅ |

`getRequestFor()` and `changeStatus()` in `services/request.service.ts` are the only places these
rules are expressed. The department id used for a queue comes from the **session**, never from a
query parameter — except for admins, who may pass one explicitly.

## Directory map

```
ml/
  data/dataset.json        151 labelled Azerbaijani student messages
  train.py                 cleaning → split → TF-IDF → LogReg → evaluate → refit → save
  serve.py                 FastAPI inference service (model loaded once)
  test_model.py            artifact, metric, routing and probability tests
  models/                  classifier.joblib + metrics.json  (generated)
  requirements.txt

server/
  src/
    app.ts                 Fastify factory: security, docs, routes, static files
    index.ts               Entry point, DB preflight, graceful shutdown
    config/env.ts          Validated environment configuration
    db/
      pool.ts              Pool, query(), withTransaction()
      migrate.ts           Migration runner (tracked in schema_migrations)
      cli.ts               db:setup | db:migrate | db:seed | db:reset
      migrations/*.sql     Ordered schema changes
      seeds/index.ts       Departments, staff accounts, model registration
    auth/
      password.ts          Argon2id hashing
      tokens.ts            JWT sign/verify, reset-token hashing
      middleware.ts        attachUser, requireAuth, requireRole
    lib/
      classifier-client.ts HTTP client for ml/serve.py
      errors.ts            AppError and typed constructors
      http.ts              Error handler, cookies, pagination, rate-limit config
      validation.ts        Server-side validator (the security boundary)
    repositories/          All SQL
    routes/v1/             HTTP surface (profile.routes.ts serves the session's own account)
    services/              Business rules, ownership, isolation
  tests/                   Integration tests against a real database

web/
  index.html               Landing page (self-contained; design must not be restructured)
  assets/
    design-system.css      Tokens and components extracted from the landing page
    shell.js               Shared header/footer, role-aware nav, language continuity
    api.js                 The only place that calls fetch()
    ui.js                  States, toasts, dialogs, pagination, escaping
    auth.js                Session state, route guards, role-aware home
    validation.js          Mirrors server validation for UX only
    <page>.js              One module per page
  <page>.html              Shells generated by tools/build-pages.py
```

## Frontend routing

There is no SPA router and no client-side history handling. `@fastify/static` serves `web/`, and a
single not-found handler maps an extensionless path to a file: `/profile` → `web/profile.html`,
`/classifier` → `web/classifier.html`. Anything under `/api` is excluded from that mapping and
falls through to the JSON error handler.

That is why direct URLs and refreshes work without extra configuration — each page is a real
document — and why a missing page file shows up as the API's JSON 404 rather than a blank screen.
Adding a route means adding a page to `tools/build-pages.py`.

## Frontend

Every page loads `design-system.css` and calls `mountShell()`, which renders the same header and
footer and resolves the session. Pages never call `fetch` directly — `api.js` owns every request.

The landing page is deliberately excluded: it keeps its own inline `<style>` and module so changes
to the shared system cannot break the approved design. The tokens in `design-system.css` are
copied from it verbatim.

Client-side guards (`requireUser`) only avoid rendering an unusable page. Every protected endpoint
re-checks authentication, role and ownership on the server.

## Error handling

One error handler in `lib/http.ts`. Deliberate failures are `AppError`s and surface their code and
message. Anything else is logged server-side with full detail and returned as a generic 500 — no
stack traces, no filesystem paths. Both properties are covered by tests.

## Extension points

- **A new page**: add it to `tools/build-pages.py`, write `web/assets/<page>.js`, call `mountShell()`.
- **A new endpoint**: route → service → repository.
- **A new department**: see [ML.md](ML.md#adding-a-department) — it needs training data, not just
  a database row.
- **A different model**: serve the same three HTTP endpoints; nothing else changes.
