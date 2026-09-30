# API reference

Base URL: `/api/v1` · Interactive OpenAPI docs: **`/api/docs`**

## Authentication

Logging in sets an **httpOnly, SameSite=Lax** cookie (`udc_session`) holding a signed JWT.
Browsers send it automatically; non-browser clients may use `Authorization: Bearer <token>`.

Because the cookie is httpOnly, page JavaScript cannot read the token — "who am I" is always
answered by `GET /auth/me`.

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "message must be at least 10 characters",
    "details": { "fields": { "message": "message must be at least 10 characters" } }
  }
}
```

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed validation; `details.fields` maps field → message |
| `UNAUTHORIZED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Authenticated, but not allowed this resource |
| `NOT_FOUND` | 404 | No such resource |
| `CONFLICT` | 409 | Already exists (duplicate email) |
| `UNPROCESSABLE` | 422 | Well-formed but semantically rejected |
| `RATE_LIMITED` | 429 | Too many requests |
| `CLASSIFIER_UNAVAILABLE` | 503 | The model service is not responding |
| `INTERNAL_ERROR` | 500 | Unexpected fault — never includes internal detail |

Paginated endpoints return `{ items, pagination: { page, pageSize, total, totalPages } }`.
`pageSize` is clamped server-side so a client cannot request the whole table.

---

## Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Always creates a `STUDENT`; the role is never read from input |
| POST | `/auth/login` | — | Identical error for unknown email and wrong password |
| POST | `/auth/logout` | — | Clears the session cookie |
| GET | `/auth/me` | session | Current user, including `departmentId` for staff |
| POST | `/auth/forgot-password` | — | Always 200. Outside production returns `devToken` (no mail transport) |
| POST | `/auth/reset-password` | — | Consumes a single-use token |
| POST | `/auth/change-password` | session | Requires the current password; rejects reuse |

Auth endpoints are limited to **10 requests per minute per IP**.

---

## Requests — the core flow

All require a session.

| Method | Path | Description |
|---|---|---|
| POST | `/requests` | Classify a message and create the routed ticket |
| GET | `/requests` | The caller's own requests (paginated, `status` filter) |
| GET | `/requests/{id}` | One request — owner, assigned department's staff, or admin |
| PATCH | `/requests/{id}/status` | Move status — **staff of the assigned department, or admin** |

```http
POST /api/v1/requests
{ "message": "Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm." }

→ 201
{
  "request": {
    "id": "a3f1…",
    "ticketNumber": 1004,
    "message": "Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm.",
    "status": "NEW",
    "department": { "id": "…", "name": "İT Dəstək", "slug": "it-destek" },
    "confidence": 0.896,
    "modelVersion": "request-router-v1.0",
    "probabilities": [
      { "label": "İT Dəstək", "probability": 0.896 },
      { "label": "Maliyyə",   "probability": 0.041 },
      { "label": "Dekanat",   "probability": 0.036 },
      { "label": "Kitabxana", "probability": 0.027 }
    ],
    "createdAt": "2026-09-25T09:14:02.881Z"
  }
}
```

`confidence` is the model's own `predict_proba` maximum. `probabilities` is the full distribution,
sorted descending; it sums to 1. Messages must be 10–4000 characters. Limited to **20 per minute**.

```http
PATCH /api/v1/requests/{id}/status
{ "status": "IN_REVIEW" }     # NEW | IN_REVIEW | RESOLVED
```

A student gets **403** on their own ticket's status — only the handling department may move it.

---

## Profile

The signed-in user's own account. There is deliberately **no `/profile/:id`** — the user comes
from the session, so there is no identifier a client could substitute.

| Method | Path | Description |
|---|---|---|
| GET | `/profile` | The caller's account plus a `completion` percentage |
| PATCH | `/profile` | Update `firstName`, `lastName`, `phone`, `studentId` |

```http
GET /api/v1/profile
→ 200
{
  "profile": {
    "id": "…", "email": "student@udc.local",
    "firstName": "Leyla", "lastName": "Məmmədova",
    "role": "STUDENT", "departmentId": null, "departmentName": null,
    "phone": "+994 50 111 22 33", "studentId": "ST-2024-0117",
    "isActive": true, "createdAt": "…", "updatedAt": "…"
  },
  "completion": 100
}
```

`email`, `role`, `departmentId` and `isActive` are **not editable here** — they are absent from the
update's column map, so extra keys in the body have no effect. `phone` and `studentId` accept an
empty string to clear them. `studentId` is unique across accounts (case-insensitive) and returns
409 on a clash.

---

## Departments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/departments` | — | The active routing targets (cached 5 minutes) |
| GET | `/departments/{idOrSlug}` | — | One department |

## Department queue

`DEPARTMENT` staff or `ADMIN`. The department comes from the **session**; a `departmentId`
parameter is ignored for staff and honoured only for admins.

| Method | Path | Description |
|---|---|---|
| GET | `/department/me` | The caller's department |
| GET | `/department/requests` | That department's queue — NEW first, then IN_REVIEW, then RESOLVED |
| GET | `/department/stats` | Counts per status for that department |

Queue items include the submitting student's name and email; a student reading their own ticket
does not get their details echoed back.

## Model

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/model/info` | — | Version, algorithm, training date, dataset size, full metrics, confusion matrix |
| GET | `/model/health` | — | Whether the inference service is reachable |

Every metric comes from `ml/train.py`'s evaluation. If the service is down, the endpoint falls
back to the values registered in `ml_models` and sets `source: "registry"`.

## Contact

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/contact` | — | Store a message. Limited to 5 per 10 minutes |

---

## Admin

All require `ADMIN`.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats` | Totals, per-department and per-status counts, average confidence, 14-day volume, low-confidence tickets |
| GET | `/admin/requests` | All requests; filter by `departmentId`, `status`, `search` |
| GET | `/admin/users` | Search and paginate users |
| PATCH | `/admin/users/{id}` | `{ isActive }` or `{ role, departmentId }`. Cannot deactivate or demote yourself. `DEPARTMENT` requires a `departmentId` |
| GET/POST | `/admin/departments` | List (including inactive) / create. Create returns `retrainingRequired: true` |
| PATCH | `/admin/departments/{id}` | Update name, description, email, active flag |
| GET | `/admin/models` | Model registry with stored metrics |
| GET | `/admin/contacts` | Filter by `status` |
| PATCH | `/admin/contacts/{id}` | `{ status: "NEW" \| "READ" \| "RESOLVED" }` |
| GET | `/admin/audit` | Paginated audit log |

## Health

`GET /health` → `{ "status": "ok", "version": "1.0.0", "classifier": "up" }`.
Runs a real query, so it fails when the database is unreachable; `classifier` reports the model
service separately, because the API can be healthy while inference is down.
