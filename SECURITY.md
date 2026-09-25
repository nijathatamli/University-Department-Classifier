# Security

## Passwords

Hashed with **Argon2id** (`@node-rs/argon2`) at OWASP's baseline: 19 MiB memory, 2 iterations,
parallelism 1. Plain passwords are never stored, logged, or returned by any endpoint.

A test asserts the stored hash starts with `$argon2id$`, so a library default change cannot
silently downgrade the algorithm. `verifyPassword` returns `false` on a malformed stored hash
rather than throwing, so corrupt data reads as "wrong password" instead of a 500.

Registration requires 8+ characters with an uppercase letter, a lowercase letter and a digit.

## Sessions

A signed HS256 JWT in an **httpOnly, SameSite=Lax** cookie, `Secure` when `COOKIE_SECURE=true`.
httpOnly means page JavaScript — and therefore XSS — cannot read the token.

`attachUser` re-reads the user from the database on every request, so a **deactivated or deleted
account loses access immediately** rather than when its token happens to expire. A test covers
this.

`Authorization: Bearer` is also accepted for non-browser clients.

## Account enumeration

Login returns the **same status and the same message** whether the email is unknown or the
password is wrong, and spends the hashing time either way so response timing does not leak
account existence. `forgot-password` always returns 200 with an identical message. Both are
covered by tests.

## Password reset

- Token is 32 random bytes; only its **SHA-256** is stored.
- Expires after one hour.
- **Single-use**, enforced by one atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now()
  RETURNING user_id` — there is no read-then-write race.
- A test asserts a replayed token is rejected.

No mail transport is configured, so outside production the token is returned in the response to
keep the flow testable. In production it is withheld. **Wire an email provider before going
live.**

## Authorization

Three roles: `STUDENT`, `DEPARTMENT`, `ADMIN`. The role is assigned by the server on registration
(always `STUDENT`) and is never read from user input.

| | STUDENT | DEPARTMENT | ADMIN |
|---|---|---|---|
| Submit and read own requests | ✅ | ✅ | ✅ |
| Read a request assigned to their department | — | ✅ | ✅ (any) |
| Change a request's status | — | ✅ (own department only) | ✅ |
| Department queue | — | ✅ (own only) | ✅ |
| Admin console | — | — | ✅ |

An admin cannot deactivate their own account or remove their own admin role. Granting the
`DEPARTMENT` role requires a `departmentId`; a database CHECK constraint backs this up, because a
staff account with no department could see nothing.

## Data ownership and department isolation

**Enforced in the service layer, never in the browser.** `getRequestFor()` and `changeStatus()` in
`services/request.service.ts` are the only places these rules are written:

- the student who submitted it,
- staff **of the department it is assigned to**,
- any admin.

The department used for a queue comes from the **authenticated session**, not from a query
parameter — so there is no parameter for staff to tamper with. Admins may pass `departmentId`
explicitly; for anyone else it is ignored.

Tests assert that:
- a second student gets **403** reading another student's request and sees `total: 0` in their own
  list, while anonymous requests get **401**;
- a student gets **403** trying to resolve their own ticket — only the handling department may;
- İT staff get **403** on a Maliyyə ticket, for both read and status change;
- a forged `departmentId` parameter does not widen a staff member's queue;
- students are blocked from every `/department/*` route.

The client-side `requireUser` guard only avoids rendering an unusable page; removing it changes
nothing about what the API returns.

## Input validation

`server/src/lib/validation.ts` is the security boundary. `web/assets/validation.js` mirrors the
same rules for immediate feedback but is never trusted.

- Request messages must be 10–4000 characters; the database additionally requires at least 5
  characters after trimming.
- Status values are checked against an allow-list and rejected with 422 otherwise — the enum in
  PostgreSQL rejects anything that slipped through.
- Every field error is reported at once so the UI can highlight all of them.
- Request bodies are capped at 256 KB.

### The model service as an input path

`ml/serve.py` is bound to `127.0.0.1` and is never reachable from the browser. It accepts a text
field of at most 5000 characters and returns a probability distribution — it performs no database
access, holds no credentials, and has no authentication of its own because nothing but the Node
API can reach it. If you ever expose it, put authentication in front of it first.

## SQL injection

All queries are parameterised through `pg`. Identifiers are never interpolated from user input;
the two places that build SQL dynamically (department search, partial updates) assemble a fixed
set of known column names and push values into the parameter array.

## XSS

Server data rendered into HTML goes through `escapeHtml()` from `web/assets/ui.js`. The CSP
restricts scripts to `'self'` plus the pinned Three.js CDN used by the landing page.

## HTTP hardening

Via `@fastify/helmet`: Content-Security-Policy (scoped to `'self'`, the Three.js CDN and Google
Fonts), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`frame-ancestors 'none'`, HSTS, `objectSrc: 'none'`, `baseUri`/`formAction` pinned to `'self'`.

CORS allows only the origins in `CORS_ORIGIN`, with credentials. A foreign origin receives no
`Access-Control-Allow-Origin` header.

Request bodies are capped at 256 KB.

## Rate limiting

| Scope | Limit |
|---|---|
| Global | `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW` (default 300/min) |
| `/auth/*` | 10 per minute |
| `POST /requests` | 20 per minute |
| `POST /contact` | 5 per 10 minutes |

Disabled under `NODE_ENV=test` so the suite can create users quickly. Verify it against a running
server:

```bash
for i in $(seq 1 13); do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:4000/api/v1/auth/login \
    -H 'content-type: application/json' -d '{"email":"a@b.dev","password":"Whatever123"}'
done
# 401 401 401 401 401 401 401 401 401 401 429 429 429
```

The limiter is **in-memory**; see [DEPLOYMENT.md](DEPLOYMENT.md#scaling) before running more than
one instance.

## Error responses

Deliberate failures return a typed code and a safe message. Everything else is logged
server-side with full detail and returned as a generic 500 — no stack traces, no filesystem
paths, no internal text. Tests assert both.

## Logging

Pino with redaction of `authorization`, `cookie`, `body.password` and `body.token`. Credentials
and session tokens never reach the logs.

## Audit trail

`audit_logs` records registration, successful and failed logins, password-reset requests and
completions, request submission (with the routed department, confidence and model version),
status changes (from → to), user activation/deactivation, role changes and department writes —
with actor, resource, IP and timestamp.
Audit writes are wrapped in try/catch so auditing can never break the request it is recording.
Metadata never contains credentials.

## Secrets

`JWT_SECRET` is required and must be at least 32 characters; the process refuses to start
otherwise. `.env` is gitignored and `.env.example` contains no real values. Database credentials
live only in the server environment and are never exposed to the browser.

## Not done yet

- No CSRF token. The `SameSite=Lax` cookie blocks cross-site form posts, which covers the
  realistic vector here, but add double-submit tokens if you ever need `SameSite=None`.
- No 2FA, no account lockout after repeated failures (rate limiting only).
- **Request text is stored in plain text.** Students may write personal or sensitive details into
  a support request. It is protected by access control, not encryption at rest; consider
  encrypting `requests.message` if your institution requires it.
- No fairness or bias audit of the classifier.
- No dependency-vulnerability scanning in CI.
