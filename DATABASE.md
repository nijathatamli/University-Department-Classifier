# Database

PostgreSQL 14+. All access goes through `server/src/repositories/` using parameterised queries —
no string-interpolated SQL, so the application is not exposed to SQL injection.

## Commands

```bash
npm run db:setup     # create database + migrate + seed
npm run db:migrate   # apply pending migrations
npm run db:seed      # re-run seeds (idempotent)
npm run db:reset     # drop schema, migrate, reseed — refuses NODE_ENV=production
```

## Migrations

`server/src/db/migrations/*.sql`, applied in filename order, each inside its own transaction, so a
failure leaves the database on the last good migration. Applied names are recorded in
`schema_migrations`.

**Migrations are immutable.** Once one has run anywhere, change the schema by adding `002_….sql`,
never by editing an existing file.

## Entity relationships

```
departments ─1:N─ users            (DEPARTMENT staff belong to one department)
            ─1:N─ requests         (assigned_department_id — the routing target)
            ─1:N─ request_predictions

users ─1:N─ requests ─1:N─ request_predictions
users ─1:N─ password_reset_tokens
users ─1:N─ audit_logs

ml_models   (registry, one active)
contacts    (standalone)
```

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `departments` | The four routing targets | Unique name + slug; `is_active` gates visibility |
| `users` | Accounts | Case-insensitive unique email; `role` enum; `department_id` for staff |
| `password_reset_tokens` | Reset flow | Stores only the SHA-256 of the token; single-use |
| `requests` | Tickets | `ticket_number` identity starting at 1000; `status` enum; `assigned_department_id` |
| `request_predictions` | One row per classification | `confidence`, `model_version`, full `probabilities` JSONB |
| `ml_models` | Model registry | Partial unique index enforces **one active model** |
| `contacts` | Contact-form messages | Status enum |
| `audit_logs` | Sensitive actions | `user_id` nullable with ON DELETE SET NULL |

## Design decisions worth knowing

**A ticket and its prediction are written together.** `createRequestWithPrediction()` runs both
inserts in one transaction. A request can never exist without the classification that routed it.

**Predictions accumulate, they do not overwrite.** Re-classifying after a retrain adds a row. The
history of how a ticket was routed stays auditable, and `model_version` on each row says which
model produced it.

**The full probability distribution is stored**, not just the winner. That is what the result page
shows, and what makes later analysis (which classes get confused) possible without re-running the
model.

**A DEPARTMENT account must have a department.** A CHECK constraint enforces
`role <> 'DEPARTMENT' OR department_id IS NOT NULL` — a staff account without a queue could see
nothing, so the database refuses to create one.

**Four departments is seed data, not schema.** Nothing in the schema limits the number of routing
targets. Adding one is an INSERT — plus retraining, which is the real constraint (see
[ML.md](ML.md#adding-a-department)).

**`updated_at` is maintained by triggers**, not application code, so a direct SQL update cannot
leave a stale timestamp.

## Indexes

Beyond primary and unique keys:

- `users (lower(email))` unique — case-insensitive login
- `users (department_id)` — staff lookup
- `requests (user_id, created_at DESC)` — a student's history
- `requests (assigned_department_id, status, created_at DESC)` — the department queue, the hottest
  query in the system
- `request_predictions (request_id, created_at DESC)` — latest prediction per ticket
- `request_predictions (model_version)` — per-model analysis
- `contacts (status, created_at DESC)`, `audit_logs (user_id, created_at DESC)` — admin lists

## Constraints worth noting

- `requests.message` must be at least 5 characters after trimming.
- `request_predictions.confidence` must be between 0 and 1.
- `users.email` must match an email shape; `contacts.email` too.
- `ml_models` has a partial unique index on `is_active WHERE is_active` — at most one active model.

## Seeds

`npm run db:seed` is idempotent — every insert upserts on a natural key. It loads the four
departments, six demo accounts (one student, four department staff, one admin), and registers the
trained model by reading `ml/models/metrics.json`. If the model has not been trained yet it says
so and skips that step rather than inventing metrics.
