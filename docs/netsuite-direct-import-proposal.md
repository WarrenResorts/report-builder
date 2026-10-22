# NetSuite direct import (proposal)

**Status:** Discovery mostly complete; API client scaffolding (`feature/netsuite-client-scaffolding`) implemented, not yet wired into the pipeline. Tracked as Phase 15 in `PROJECT_PLAN.md`. Pipeline-integration work can proceed next with no external dependency; sandbox verification is blocked on the hotels' NetSuite admin (see [Suggested next steps](#suggested-next-steps)).

## Goal

The hotels currently take the JE/StatJE CSV files we email them and manually upload them into NetSuite via NetSuite's own CSV Import feature. They've asked to cut out that manual step.

**Requirement (confirmed):** this is additive, not a replacement. We keep generating and emailing the daily JE/StatJE CSVs exactly as we do today, **and** we push the same data directly into NetSuite via API. The email stays as a human-readable record and a fallback if the direct import ever fails for a given day.

---

## Current state (why this is feasible)

Our existing CSV output was already built to mirror NetSuite's own import field names, not arbitrary column labels:

- **JE CSV** (`journal-entry-generator.ts`): `Entry`, `Date`, `Sub Name`, `Subsidiary`, `acctnumber`, `internal id`, `location`, `account name`, `Debit`, `Credit`, `Comment`, `Payment Type`
- **StatJE CSV** (`statistical-entry-generator.ts`): `Transaction ID`, `Date`, `Subsidiary`, `Property Name`, `Unit of Measure Type`, `Unit of Measure`, `acctNumber`, `internal id`, `account name`, `department id`, `location`, `Amount`, `Line Units`

Both generators already produce one fully-formed, per-property "record" in memory (`TransformedJEData` / `TransformedStatJEData`) before ever touching CSV formatting. That's the natural seam to reuse: instead of only handing those records to the CSV writer, we'd also hand them to a new NetSuite API client.

---

## How it would work

### High-level flow

```
file-processor Lambda (unchanged: PDF/Opera/Choice parsing + mapping)
        │
        ▼
Transformed JE / StatJE records (unchanged, in-memory)
        │
        ├──────────────────────────┐
        ▼                          ▼
CSV generation (unchanged)   NEW: NetSuite API client
        │                          │
        ▼                          ▼
Email to accounting          POST to NetSuite (JE + StatJE records)
(unchanged, always runs)     (new — logged to the summary email either way)
```

Both paths run independently in the same Lambda invocation. If the NetSuite push fails, the email still goes out exactly as it does today — accounting is never left without the data, they'd just fall back to the manual upload for that day.

### New component: NetSuite API client

A new module (e.g. `src/netsuite/netsuite-client.ts`) responsible for:

1. **Authenticating** to NetSuite (OAuth2 or Token-Based Authentication — TBD based on what NetSuite supports on their account; see [open questions](#open-questions-for-the-hotelsnetsuite-admin)).
2. **Mapping** our existing `TransformedJEData` / `TransformedStatJEData` records into NetSuite's REST record payload shape for Journal Entry and Statistical Journal Entry.
3. **Submitting one JE record per property per day** (not one API call per line) — NetSuite Journal Entries are submitted as a single record containing multiple lines, so posting succeeds or fails as a unit. This is much simpler to reason about than trying to post line-by-line and reconcile partial failures.
4. **Idempotency**: we already generate a unique entry ID per property/day (`WR{locationId}{YYYYMMDD}` for JE, `{date} WRH{subsidiaryId}` for StatJE). We'd send that as NetSuite's `externalId` field, so if `file-processor` is ever re-run for the same day (which already happens today via the documented reprocessing/override flow), NetSuite rejects or updates the duplicate instead of creating a second JE.
5. **Error handling & retries**: transient errors (timeouts, rate limits) get retried with backoff, reusing the existing `retry.ts` utility already used elsewhere in this codebase. Persistent failures (e.g. rejected due to a validation error, missing account, closed period) are caught, logged, and surfaced.
6. **Reporting status**: the existing summary email (`report-email-sender.ts`) gets a new section — "NetSuite Import Status" — showing which properties posted successfully and which fell back to email-only for that run, so nothing fails silently.

### Credentials

Following the existing pattern for all other secrets in this project (`/report-builder/{environment}/...` in SSM), NetSuite integration credentials would live in SSM Parameter Store (or Secrets Manager, if NetSuite's auth flow needs a refresh token that rotates), separately for dev and prod, matching the two-account AWS setup already in place.

### Sandbox-first rollout

1. Build and test entirely against a NetSuite **sandbox** account (never production) using historical report data we already have.
2. Pilot with one or two properties in the real dev pipeline, with a human comparing the auto-posted JE against what the manual CSV import would have produced, for at least a few days.
3. Roll out property-by-property, not all-at-once, so any per-property mapping quirks (custom subsidiary rules, Choice Hotels overrides, etc.) surface on a small blast radius.
4. Keep the email fallback indefinitely — it costs us nothing to keep sending it, and it's the safety net if NetSuite is ever unreachable or a payload is rejected.

---

## Open questions for the hotels/NetSuite admin

We can't move forward on implementation until these are answered — most of them need to come from whoever administers their NetSuite account (internal admin or an outside NetSuite partner/consultant).

### Licensing & environment
- ~~What is their NetSuite Account ID and edition?~~ **Answered:** SuiteSuccess Financials First, Standard Cloud Service.
- ~~Do they already have SuiteCloud Plus enabled?~~ **Effectively resolved, low risk:** SuiteCloud Plus only raises the account's API *concurrency* limit — it isn't a gate on API access itself, which is included in every NetSuite subscription. The Standard service tier's base concurrency (5 simultaneous requests) is far more than our usage needs (1 JE + 1 StatJE post per property, once daily, sequential — never in parallel bursts). Not a hard confirmation from their NetSuite admin, but not worth blocking on.
- Do they have a **Sandbox** NetSuite account available for us to build and test against before touching production? **Still open** — check Setup → Company → Manage Sandboxes in their account, or ask their NetSuite rep. This is the one remaining licensing/environment blocker.

### Access & authentication
- Who is the NetSuite admin/contact who can create an **Integration record** (Setup → Integration → Manage Integrations) and a dedicated integration user account on their end? We can't create this from our side.
- What auth method do they support — Token-Based Authentication (TBA) or OAuth2 client credentials?
- Can the integration user's role be scoped narrowly (create JE/StatJE, read Subsidiaries/Locations/Departments/Accounts) without hitting subsidiary/class restrictions that would block posting across all their properties?

### Record-type specifics — the biggest open unknown
- **Does their NetSuite edition/tier expose Statistical Journal Entry through the API at all?** This is a less common record type and isn't guaranteed to be available via SuiteTalk on every NetSuite tier. If it isn't, JE could still be automated while StatJE stays a manual/CSV process — need this confirmed before committing to a full-automation design.
- Have they customized the Journal Entry or Statistical Journal Entry forms with required custom fields, custom segments, or class/department requirements beyond what we currently populate?
- Is JE approval routing enabled in their NetSuite? If so, should our submissions land as "Pending Approval," or does someone want them posted immediately?

### Process/data validation
- Walk through **exactly what they do during today's manual CSV import** — do they ever edit/adjust a value before submitting? Any such adjustment is a gap in our current mapping that needs to be closed regardless of which integration approach we take.
- Any existing integrations already hitting their NetSuite API we'd need to be aware of (rate limits, conflicting automation)?

---

## Cost

| Item | Who pays | Estimate |
|---|---|---|
| SuiteCloud Plus / web services license | Hotels (NetSuite subscription) | Unknown until confirmed with their NetSuite admin/rep — this is the one potential real cost, and only they can see their contract/tier |
| AWS: additional Lambda compute for API calls | Us | Negligible — small increase in existing Lambda execution time |
| AWS: Secrets Manager for integration credentials | Us | ~$0.40/secret/month |
| Engineering time | Us | Real, but not a billed line item — building auth flow, error handling, retry/reconciliation logic, and monitoring |
| Ongoing maintenance | Us | Similar in kind to how we already track AWS SDK/dependency updates — NetSuite periodically revises API versions |
| Sandbox testing | Hotels | Free if already included in their NetSuite tier; a cost only if they need to add one |

---

## Risks

- **Silent partial success**: if we're not careful, a JE could partially post (some lines succeed, others don't). Submitting one full JE record per property/day per the design above avoids this — NetSuite treats the whole record as a unit.
- **Duplicate postings on reprocessing**: mitigated by using `externalId` idempotency (see above), but needs real testing against NetSuite's actual duplicate-detection behavior, not just assumed.
- **NetSuite-side customizations we don't know about yet**: custom required fields, approval workflows, or subsidiary restrictions could block posting in ways that only show up once we're testing against their real (sandbox) instance.
- **StatJE API availability**: if their tier doesn't expose this record type via API, we may end up with a split JE-automated / StatJE-manual state rather than full automation — see open questions above.
- **NetSuite outages/rate limits**: the email fallback protects against this operationally, but it means "fully automated" in practice still needs a manual-recovery path for edge cases.

---

## Suggested next steps

Tracked as **Phase 15** in `PROJECT_PLAN.md`, split across 4 branches so the work with no external dependency isn't blocked by the work that is:

1. **`feature/netsuite-client-scaffolding`** ✅ **done** — API client module (`src/netsuite/`): auth abstraction (both `TokenBasedAuthProvider`/TBA and `OAuth2JwtAuthProvider`/OAuth2 M2M JWT bearer, since which one the hotels' account supports is still unknown), JE/StatJE payload mapping from the existing `TransformedJEData`/`TransformedStatJEData` records, retry/error handling via `retry.ts`, full test coverage against mocked HTTP responses (47 tests). Not yet wired into `file-processor.ts` — that's branch #2 below. The StatJE payload shape is explicitly flagged in code comments as unverified until sandbox access confirms it.
2. **`feature/netsuite-pipeline-integration`** (no external dependency — proceed now) — wire the client into `file-processor.ts` behind a default-off config flag, add the "NetSuite Import Status" summary email section, and add the SSM/Secrets Manager credential plumbing (CDK changes). Stays safely mergeable since the flag defaults off.
3. **`feature/netsuite-sandbox-verification`** (**blocked**) — get sandbox credentials from the hotels' NetSuite admin, confirm StatJE API availability and auth method, point dev's flag at the real sandbox, and test against historical data.
4. **`feature/netsuite-production-rollout`** (depends on #3) — property-by-property production enablement and monitoring.

Remaining unanswered items from the [open questions](#open-questions-for-the-hotelsnetsuite-admin) above — sandbox availability, StatJE API availability (the biggest unknown), auth method, form customizations/approval routing, and manual-adjustment confirmation — all gate branch #3 specifically, not #1 or #2.
