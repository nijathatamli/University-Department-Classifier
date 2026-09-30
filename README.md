# Tələbə Müraciətlərinin Avtomatik Yönləndirilməsi
### University Department Classifier (DEPTIFY)

A student writes a request in their own words. An NLP model classifies the text and the resulting
ticket is **routed automatically to the responsible university department** — Dekanat, Maliyyə,
Kitabxana or İT Dəstək. The student tracks its status; department staff work their own queue.

```
"Wi-Fi işləmədiyi üçün portala daxil ola bilmirəm."
        ↓  TF-IDF + Logistic Regression
   İT Dəstək · 89.6% confidence
        ↓
   Ticket #1004 → İT Dəstək queue → NEW
```

---

## Contents

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, layering, request flow, directory map |
| [DATABASE.md](DATABASE.md) | Schema, relationships, indexes, migrations, seeds |
| [API.md](API.md) | Every endpoint, request/response shapes, error codes |
| [ML.md](ML.md) | Dataset, training pipeline, evaluation, retraining |
| [SECURITY.md](SECURITY.md) | Authentication, authorization, isolation, hardening |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploying to Render, production configuration, operations |

---

## Stack

| Layer | Choice |
|---|---|
| NLP | Python · scikit-learn · TF-IDF (char n-grams) + Logistic Regression |
| Inference | FastAPI service, model loaded once at start-up |
| Backend | Node.js 20+ · TypeScript · [Fastify 5](https://fastify.dev) |
| Database | PostgreSQL 14+ (SQL migrations, parameterised queries via `pg`) |
| Auth | Argon2id password hashing · JWT in an httpOnly cookie |
| Frontend | Multi-page vanilla HTML/CSS/ES modules, one shared design system |
| Landing page | Three.js WebGL scene (self-contained, design unchanged) |
| API docs | OpenAPI 3.0 at `/api/docs` |

**Why two processes.** scikit-learn lives in Python; the web app is Node. `ml/serve.py` loads the
trained pipeline once and answers `/predict` on localhost. The Node API calls it and owns
authentication — the model service is never exposed to the browser. This is also what keeps the
model from being retrained on every request.

**Why the frontend is not a framework.** The landing page is one self-contained file with an
inline Three.js scene. Its design system was extracted into `web/assets/design-system.css`, and
every other page is built from the same tokens, served by the same Fastify process.

---

## Quick start

Requires **Node.js 20+**, **Python 3.9+** and a running **PostgreSQL 14+**.

```bash
git clone <repo> && cd University-Department-Classifier
npm install
pip3 install -r ml/requirements.txt

cp .env.example .env
# Generate a real secret with: openssl rand -base64 48
# and paste it into JWT_SECRET

npm run ml:train      # trains the model, writes ml/models/ and prints the metrics
npm run db:setup      # creates the database, migrates, seeds departments + accounts

# Two processes — run each in its own terminal:
npm run ml:serve      # http://127.0.0.1:8001   (inference)
npm run dev           # http://localhost:4000   (API + frontend)
```

Open <http://localhost:4000>.

### Demo accounts

Created by the seed for development only. **Remove them before deploying** — see
[DEPLOYMENT.md](DEPLOYMENT.md#before-you-go-live).

| Email | Password | Role | Lands on |
|---|---|---|---|
| `student@udc.local` | `StudentPass123!` | STUDENT | `/classifier` |
| `dekanat@udc.local` | `DekanatPass123!` | DEPARTMENT · Dekanat | `/department` |
| `maliyye@udc.local` | `MaliyyePass123!` | DEPARTMENT · Maliyyə | `/department` |
| `kitabxana@udc.local` | `KitabxanaPass123!` | DEPARTMENT · Kitabxana | `/department` |
| `it@udc.local` | `ItPass123!` | DEPARTMENT · İT Dəstək | `/department` |
| `admin@udc.local` | `AdminPass123!` | ADMIN | `/admin` |

---

## Commands

Run from the repository root.

| Command | What it does |
|---|---|
| `npm install` | Install Node dependencies |
| `npm run ml:train` | Train the classifier; writes `ml/models/` and prints evaluation |
| `npm run ml:serve` | Start the Python inference service on port 8001 |
| `npm run dev` | Start the API + frontend with hot reload on port 4000 |
| `npm run build` | Type-check and compile the server to `server/dist` |
| `npm start` | Run the compiled server (production) |
| `npm run lint` | Type-check without emitting |
| `npm test` | Backend test suite (needs `ml:serve` running) |
| `python3 ml/test_model.py` | Model tests: artifacts, metrics, routing, probabilities |
| `npm run db:setup` | Create database, migrate, seed (first-time setup) |
| `npm run db:migrate` | Apply pending migrations only |
| `npm run db:seed` | Re-run seeds (idempotent) |
| `npm run db:reset` | Drop, migrate, reseed (refuses to run in production) |

`tools/build-pages.py` regenerates the static page shells from one shared template.

---

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | `postgresql://localhost:5432/udc_test` | Dropped and rebuilt by `npm test` |
| `JWT_SECRET` | yes | — | Session signing key; **32+ characters** |
| `ML_SERVICE_URL` | no | `http://127.0.0.1:8001` | Python inference service |
| `PORT` / `HOST` | no | `4000` / `127.0.0.1` | Listen address |
| `NODE_ENV` | no | `development` | `production` enables stricter behaviour |
| `CORS_ORIGIN` | no | `http://localhost:4000` | Comma-separated allowed origins |
| `COOKIE_SECURE` | no | `false` | Set `true` when served over HTTPS |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | no | `300` / `1 minute` | Global rate limit |

---

## Pages

**Public** — `/` landing · `/how-it-works` · `/about` · `/contact`
**Auth** — `/login` · `/register` · `/forgot-password` · `/reset-password`
**Student** — `/classifier` (write a request) · `/requests` (history and status) · `/profile` (account)
**Department staff** — `/department` (their own queue, status controls) · `/profile`
**Admin** — `/admin` (statistics, requests, model metrics, departments, users, messages, audit)

---

## The model

TF-IDF over **character n-grams** (`char_wb`, 2–5) feeding a Logistic Regression, trained on 151
Azerbaijani student messages balanced across the four departments.

Character n-grams rather than words because Azerbaijani is agglutinative: *kitab*, *kitabı*,
*kitabxanadan* are three word-tokens sharing one root. Measured 5-fold accuracy was **0.56 for
word features against 0.80 for character features** — that choice is what makes a 151-sentence
corpus usable.

| Metric | Value |
|---|---|
| Hold-out accuracy | 0.79 |
| Macro precision / recall / F1 | 0.83 / 0.79 / 0.79 |
| 5-fold CV accuracy | **0.80** (± 0.08) |

The confidence shown to students is the model's own `predict_proba` output. Full details,
including how to retrain and how to add a department, are in [ML.md](ML.md).

---

## Testing

```bash
python3 ml/test_model.py   # model: artifacts, metrics, routing, probability sanity
npm run ml:serve &         # the API tests exercise the real classifier
npm test                   # 59 backend tests against a real PostgreSQL database
```

- **Model** — artifacts exist, metrics in range and above chance, all 10 canonical messages route
  correctly (including misspelled and diacritic-free input), probabilities sum to 1 and vary by
  input, identical input gives identical output.
- **Authentication** — Argon2id hashing, cookie flags, weak-password and duplicate-email
  rejection, account-enumeration resistance, single-use password reset, instant lockout of
  deactivated accounts.
- **Classification & routing** — each canonical example routes to the expected department, the
  returned distribution is real (sums to 1, sorted, matches the assignment), the ticket and its
  prediction are persisted and read back from the database.
- **Ownership** — a student can never read another student's request or see it in their list, and
  cannot resolve their own ticket.
- **Department isolation** — staff see only their own queue, a forged `departmentId` parameter is
  ignored, opening or modifying another department's ticket is 403, students are blocked entirely.
- **Administration** — students and staff are blocked from every admin route, statistics come from
  the database, granting the DEPARTMENT role requires a department, admins cannot lock themselves
  out, audit entries are written.
- **Profile** — the account is resolved from the session only, updates persist in PostgreSQL,
  `email`/`role`/`isActive` cannot be changed through it, a user id in the body cannot touch
  another account, student IDs are unique, and changing a password requires the current one.
- **Error handling** — documented error envelope, no stack traces or filesystem paths.

Rate limiting is disabled under `NODE_ENV=test`; it is verified against a running server instead
(see [SECURITY.md](SECURITY.md#rate-limiting)).

---

## Deploying

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/nijathatamli/University-Department-Classifier)

`render.yaml` deploys the whole stack to [Render](https://render.com) as one Docker web service
plus a managed PostgreSQL database — see [DEPLOYMENT.md](DEPLOYMENT.md#render-recommended-path).

This is **not** a static site: choosing "Static Site" in the Render UI fails with
`StaticPublishPath must be a relative path`. Use **Blueprint** or **Web Service → Docker**.

## Known gaps

- **Small dataset.** 151 sentences. Roughly one request in five is routed to the wrong desk.
  Low-confidence tickets are surfaced separately in the admin console so a human can catch them,
  and staff can re-route, but there is no one-click reassignment UI yet.
- **Adding a department needs retraining.** The schema and pipeline are not limited to four
  labels, but a new department receives nothing until `ml/data/dataset.json` gains labelled
  examples for it and the model is retrained. The admin API returns `retrainingRequired: true` to
  make this explicit.
- **No email delivery.** Password reset creates a real single-use token, but there is no mail
  transport; outside production the token is returned in the API response so the flow is testable.
- **Application pages are Azerbaijani-only.** The landing page is trilingual (AZ/EN/RU) and the
  shared header and footer follow that choice, but the application page bodies are Azerbaijani.
  Extension point: `CHROME_I18N` in `web/assets/shell.js`.
- **No committed frontend test suite.** The full journey was driven in a real browser
  (register → submit → route → department status change → student sees it), but that is not
  committed as an automated suite.
- **Single-process deployment.** Rate limiting is in-memory; see
  [DEPLOYMENT.md](DEPLOYMENT.md#scaling) before scaling horizontally.
