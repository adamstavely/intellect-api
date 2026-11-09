# intellect-api

Backend for **Intellect**, a research-portfolio management app. The Angular frontend lives in [`scaling-doodle`](https://github.com/adamstavely/scaling-doodle).

## Stack

- **NestJS** (TypeScript)
- **Elastic** as the only datastore. Production uses Elastic Cloud; local dev runs Elasticsearch locally.
- Paper impact metrics (downloads, views, citations, altmetric, mentions) come from an internal metrics API.
- Auth is stubbed for now with a Chief/PI role switch; real auth comes later.

## Deployment

- **Dev:** everything runs locally.
- **Prod:** EKS + Elastic Cloud.

## Local development

Requires Node 22+ and Docker.

```bash
cp .env.example .env
npm ci
docker compose up -d          # single-node Elasticsearch 8 on :9200 (add --profile kibana for Kibana on :5601)
npm run es:migrate            # index templates, versioned indices and aliases
npm run es:seed               # load the prototype dataset (replaces what's there)
npm run es:reconcile          # nightly job: recompute topic rollups, log drift, snapshot this month's health
npm run start:dev             # API on :3000
```

- `GET /health`: liveness/readiness, checks Elasticsearch. Public.
- `GET /docs`: Swagger UI; the spec is at `/docs/openapi.json`. `openapi.json` at the repo root is the committed contract the frontend generates its client from. After changing an endpoint or DTO, run `npm run openapi:export` and commit the result; CI fails if it is stale.
- `GET /me`: the current user and their topic scope.

### Read endpoints

All scoped to the caller (see Auth below). Full schemas at `/docs`.

| Endpoint | Serves |
|---|---|
| `GET /people`, `GET /people/:id` | People page; load vs capacity |
| `GET /portfolio/summary?period=` | Dashboard KPIs, health mix, bin mix, coverage, reads trend |
| `GET /topics?sort=risk&bin=&health=` | Dashboard priorities table |
| `GET /topics/:id` | Topic header and resourcing strip |
| `GET /topics/:id/spine` | Question → Gap → Work → Paper → Citation nodes and edges |
| `GET /gaps?attention=true&limit=5` | Gaps needing attention (open, no active work; most severe first) |
| `GET /papers`, `GET /papers/top?limit=3&period=`, `GET /papers/:id` | Papers list, impact pulse, detail with monthly metrics |
| `GET /org` | Centers → teams → topic roll-ups |
| `GET /search?q=` | ⌘K search over topics, gaps, papers and people |

### Writes and brief

| Endpoint | Notes |
|---|---|
| `POST /topics` | New Topic flow: topic plus opening questions. Chief, or a PI creating a topic they lead. Health is computed, never entered. |
| `PATCH /papers/:id/grade` | `{ "grade": "excellent" }` or `null` to clear. Chief only (403 otherwise). Sets `gradedBy`/`gradedAt` and recomputes the topic's grade roll-up (`stats.grades`). |
| `GET /brief?period=FY26-Q2` | Directorate Brief: executive summary, at-a-glance, centers scorecard, exposure register, investment vs priority, impact highlights and rule-based decisions. No LLM. |

`period` is `ytd` (default), `FY26` or `FY26-Q2`, on the US federal fiscal year (FY26 starts 2025-10-01). Out-of-scope ids return 404, not 403.

### Auth (stub)

Every route except `/health` and `/docs` needs an `X-Intellect-User` header holding a person id from the seed (`hv` is the Chief; `mo`, `pr`, `sa`, `dw`, `lk`, `am` are PIs). `StubAuthGuard` is the only piece real auth replaces. `ScopeService` turns the user into one Elastic filter: the Chief sees every topic, anyone else sees topics they lead or have FTE on.

### Audit trail

Every API request is audited, reads included, along with requests refused by auth or validation. The liveness and readiness probes (`/health`) and the docs (`/docs`) are skipped. Each event records:

- who: person id, name and role, or the claimed id when auth refused it;
- what: an action such as `PATCH /papers/:id/grade`, plus the route params, query and, for changes, the redacted body;
- when, and the outcome: status code and duration.

The response carries the event's id as `X-Request-Id`.

Events go to the append-only `audit` index, written in batches so requests don't wait on them. A failed write is retried, including individual items Elasticsearch rejects as throttled or failed. An event that can't be written is logged in full at error level, as is anything still queued when a shutdown's last few flushes fail. Set a retention ILM policy on `audit-v*` in production.

**Forwarding to an external service.** Set `AUDIT_WEBHOOK_URL` to POST the trail to an HTTPS endpoint. Plain http is accepted only on localhost, for development.

| Variable | Default | |
|---|---|---|
| `AUDIT_WEBHOOK_URL` | unset (Elastic only) | Where to POST events |
| `AUDIT_WEBHOOK_SECRET` | unset | Signs each delivery; set it whenever the URL is set |
| `AUDIT_FORWARD_INTERVAL_MS` | 5000 | How often to look for new events |
| `AUDIT_FORWARD_BATCH` | 200 | Most events per POST |
| `AUDIT_WEBHOOK_TIMEOUT_MS` | 10000 | How long to wait for the endpoint |
| `AUDIT_FORWARD_SETTLE_MS` | 30000 | How long after it is stored an event waits before it is sent. Keep this above write latency plus clock skew between replicas. |

Each delivery is `POST {"events":[…]}` with these headers:
- `X-Intellect-Delivery`: unique per attempt;
- `X-Intellect-Timestamp`: epoch seconds;
- `X-Intellect-Signature`: `sha256=` plus the hex HMAC-SHA256 of `"<timestamp>.<body>"` keyed with the secret.

The receiver should verify the signature, reject stale timestamps, and answer 2xx.

Delivery follows a cursor kept in the `audit-cursor` index, which moves only on a 2xx. An outage or a restart therefore loses nothing: failed deliveries back off (doubling, up to 5 minutes) and resume where they stopped. Events go out in the order they were stored (`indexedAt`), not the order the requests finished (`at`). An event written late, for example after a retried write, is still delivered: each scan also looks back behind the cursor by the longest an Elasticsearch write can take (request timeout × attempts, 2 minutes by default) plus `AUDIT_FORWARD_SETTLE_MS`, and each event the endpoint accepts is marked `forwardedAt` so that look-back doesn't send it again. Delivery is **at-least-once**, so de-duplicate on each event's `id`.

## Data model

Elastic is the only datastore (see milestone-1 plan §1 in `scaling-doodle/docs/milestone-1-plan.md`). Index definitions live in [`src/elastic/indices.ts`](src/elastic/indices.ts): each index sits behind an alias (`topics` → `topics-v1`) with a `dynamic: strict` mapping. Adding fields is applied in place by `es:migrate` (`mapping-updated`). For anything else, such as a changed field type, bump the definition's `version` and run `es:migrate`; it creates the new index and reports `needs-reindex`. Reindex, then swap the alias.

- Every record carries `topicId`; each link is stored once, on the child (`gap.questionIds`, `work.gapIds`, `paper.workIds`, `citation.paperId`).
- Topic rollups (`stats`, `healthScore`, `health`, `trend`, `momentum`) are computed by [`src/topic-health/topic-health.ts`](src/topic-health/topic-health.ts) and stored on the topic. `TopicRollupService.recompute()` refreshes them after a write, using optimistic concurrency.
- `paper-metrics` is filled through the `MetricsSource` interface; `SeedMetricsSource` serves the prototype's figures until the internal metrics API is integrated.

### Seed

`seed/data.js` is the design prototype's dataset, extracted verbatim from `scaling-doodle/claude-design/Intellect (standalone).html`. `npm run es:seed` converts it to the plan's shapes and recomputes health as of today. Pass `-- --as-of YYYY-MM-DD` (or set `SEED_AS_OF`) to pin the date, or `-- --ndjson out.ndjson` to write the bulk body instead of loading it.

## Tests

```bash
npm test          # unit
npm run test:int  # integration: starts Elasticsearch with Testcontainers (needs Docker)
npm run lint
```
