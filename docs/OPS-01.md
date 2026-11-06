# OPS-01 — Backend Production sentinel

## Runtime and authority

Approved architecture: existing n8n Railway → fixed native Vercel CLI → deterministic
classification → private Supabase state → conditional Slack. Hourly at `0 * * * *`
UTC. Only project `prj_FTT6fSIRVXoVUZaK6l7Z9MaGXmI1` Production and Slack channel
`C0CF5EEEB8V` are allowed. The monitor never calls business writers, payments,
recovery or rollback endpoints. No Log Drain or additional service is installed.

The generic Execute Command remains excluded. A private custom node invokes a fixed
executable without shell interpolation or user-provided arguments. It rejects a
different workflow ID before credential access. Only the instance owner is an
active n8n user in the verified inventory. The node uses existing n8n Slack and
Supabase credentials, without exporting their values into workflow JSON, execution
outputs or Git. The Vercel token lives in Railway `OPS01_VERCEL_TOKEN`.

Vercel native CLI 65.12.1 is pinned with npm integrity hashes for Linux arm64/x64
musl distributions. The final image contains only the official executable, not
the npm CLI's unused JavaScript build adapters. The collector uses patched Node
22.23.4 separately from n8n's existing Node runtime. No .env file is read or copied.

## State and delivery contract

The canonical SQL source is Mobile migration `20261105203855_ops01_production_sentinel.sql`.
Private schema `ops01` stores events, incidents, outbox, attempts and monitor state.
RLS is enabled; anon/authenticated cannot access schema or RPC. The public RPC
is SECURITY INVOKER and service-only, without any business-table references.

P0 is the first credible structured failure of an essential business operation,
a fatal runtime log, or server 5xx on auth/Stripe webhook routes with explicit
impact. Other 5xx/application errors are P1: five occurrences within fifteen
minutes, across at least three distinct real request IDs. The historical rolling
window is evaluated over the collected interval, not only the moment of the sweep.
Expected client 401/403/404 and next-intl ENVIRONMENT_FALLBACK are quiet unless a
structured critical business code is present. Names containing "test" never
exclude an account. Validated test-ID lists start empty.

One initial outbox row per incident episode. Repeated events update counts, exact
replays cannot duplicate them, and transactions serialize competing claims.
Severity upgrades can produce the first critical alert on an unalerted signature;
different affected invoice identities produce distinct incident signatures.
Resolution requires an explicit reason and positive operator action. A new event
after resolution opens a new episode. No automatic resolution from missing logs.
Daily reminders are disabled. Existing P0s at bootstrap are consolidated into one
summary; individual historical outboxes are baselined and are not republished.

Slack success records its timestamp; future reminders use the thread. Explicit
rate-limit refusals stay pending with exponential backoff and Retry-After. Network
timeouts, invalid responses and 5xx are ambiguous and become `uncertain`, rather
than being resent blindly. The incident becomes `requalify`; no exactly-once
promise is made across the external Slack commit boundary. Unknown failures are
not dropped. Claim tokens reject stale acknowledgements; stale sends are quarantined.
The unique `[TEST OPS-01]` outbox prevents a second initial test publication.

Events retain 31 days; attempts retain 90 days. Incident aggregates/outbox history
are retained for idempotence and audit. Store only fixed codes, hashed subjects,
sanitised routes, Vercel deployment/request IDs, timestamps and counters. No raw
logs, personal names, Stripe payloads, credentials or unfiltered stacks are stored.

## Collection, failures and operational limits

The CLI reads runtime error/fatal, request 5xx, and known critical business codes
independently, including HTTP 200 failures. Start = last complete watermark minus
15 minutes; end = fixed run start minus 2 minutes. A first run covers one hour.
Production is checked again on every returned record. IDs are deterministic
hashes of the source's stable event fields; identical cross-query records deduplicate.

Require a terminal summary, coherent time window/record count, no excluded interval
and no truncated record. Native CLI pagination is explicitly best-effort at equal
timestamps. Therefore saturated windows are bisected with overlap until non-saturated;
an indivisible saturated window, exceeded call ceiling, malformed output, timeout,
rate-limit failure or missing summary is COLLECTION_INCOMPLETE/FAILED. Never advance
the watermark on incomplete collection. Already ingested batches can be replayed.
The Pro retention boundary can make a gap unrecoverable: intervals over 23 hours
fail visibly as COVERAGE_GAP. No false claim of exhaustive upstream logging.

An expiring durable run lease avoids overlapping cycles. Collection failures retain
the watermark and persist a protocol error. Three consecutive failures enqueue one
monitor incident. A positive completed collection certifies pipeline recovery.
The health RPC exposes stale runs, failure counts, pending stale delivery and
ambiguous/blocked sends. The workflow preserves diagnostics in node output and
uses Stop And Error on failed cycles; it never prints only to console. If both
n8n and its host are down, it cannot send Slack itself: use Railway's independent
deployment/health state; no additional external heartbeat is claimed active.

## Deployment gates and procedure

1. Align n8n and Mobile canonical references. Validate tests, local image, restricted
   node discovery, generic-node exclusion, fixed native CLI and SQL contracts.
2. Commit the SQL owner source, register its exact commit/path/SHA-256 in Mobile,
   run fresh READ ONLY global migration drift, planner, applicable L3 Full and DAT.
3. Publish the validated canonical ledger, migration list and exact db push dry-run;
   apply only the authorized forward migration. Verify RLS/ACL and business isolation.
4. Create an inactive workflow using `sentinel/workflow.json`, bind the existing
   Slack and Cleanyz Supabase credential IDs, then configure Railway's public
   `OPS01_WORKFLOW_ID` to its exact ID and `OPS01_MODE=dry-run`.
5. Publish the validated n8n main candidate and verify exact Railway deployment,
   runtime CLI identity, custom-node load and prior workflow states unchanged.
6. Execute an actual Production dry-run, inspect classification/de-duplication and
   prove zero Slack calls. Select testSlack once, verify the single explicit test,
   then restore cycle. Changing the workflow operation does not grant generic shell.
7. Switch `OPS01_MODE=live`, verify settled deployment, activate the hourly workflow
   and execute its first cycle. Verify durable watermark, historical consolidation,
   outbox, execution output and exact workflow active state.

The owner's OPS-01 activation GO authorizes this sequence only after PASS. A failure
blocks the next live step; no speculative activation or generic shell enabling.

## Rollback

Deactivate only the OPS-01 workflow through n8n API. Set OPS01_MODE=dry-run or unset
OPS01_WORKFLOW_ID to make the node fail closed. Preserve watermark, incidents and
outbox for diagnosis. If required, redeploy the prior n8n Git revision
`f0c52924911a002580cd7966207d5ffa2b8ae5ea` (same n8n version, no n8n schema downgrade).
The additive observability migration stays applied and immutable; do not drop or
rewrite it. Revoke the dedicated Vercel token if compromised; do not rotate unrelated
n8n keys/credentials or restore volumes. No payment/business rollback is part of OPS-01.

## Local verification

`node --test sentinel/*.test.mjs`

`OPS01_MIGRATION_FILE=<canonical SQL path> node sentinel/integration.mjs`

The second command requires disposable PostgreSQL 16. All Slack responses and
business accounts are synthetic. Reports and runtime delivery evidence are recorded
separately; a local PASS never means the workflow has been activated.
