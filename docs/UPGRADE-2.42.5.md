# n8n 2.42.5 — production upgrade and recovery

## Scope

Production service `heylisa-n8n-prod`, Railway project `sincere-insight`,
environment `production`. GitHub `heylisa-app/heylisa-n8n`, auto-deploy from `main`.
Pinned image changes from `n8nio/n8n:2.8.4` to `n8nio/n8n:2.42.5`.
The entrypoint, production variables, PostgreSQL image and volumes are unchanged.
The upgrade runs n8n's own database migrations automatically at startup.

## Verified pre-upgrade baseline

- Running n8n: 2.8.4; repository baseline: `ca429045ef2dc0095df4c888fe6f9a4cc45d7456`.
- Effective runtime `DB_TYPE=postgresdb`; server PostgreSQL 17.11.
- `N8N_ENCRYPTION_KEY` is populated in the running container. Its value was never exposed.
- 53 workflows, 20 credentials, 2772 execution records in a read-only transaction.
- All 20 credentials decrypt and parse successfully in memory; only counts were returned.
- TEC A: `TMVlr6aalNkbKKwz`, active; TEC B: `4HvtFVoW5IlrRyih`, active.
- Volume `heylisa-n8n-volume`, mount `/home/node/.n8n`, maximum 5 GB.
- `N8N_USER_FOLDER=/home/node/.n8n`; preserve this existing setting as-is.
- n8n daily volume snapshot approximately 21 hours old, 1007 MB.
- PostgreSQL daily volume snapshot approximately 12 hours old, 1.1 GB.
- PostgreSQL point-in-time recovery is off. The accepted snapshots have different times.

The snapshot ages and baseline counts are observations at preflight, not fixed ongoing values.
The user accepted the backup age and time discrepancy. No snapshot restoration was performed.

## Validation

Official documentation lists 2.42.5 as stable and supports PostgreSQL 16, 17 and 18.
Docker cannot run on the user's Mac due to resource constraints; local build is NOT RUN.
An isolated GitHub runner built the exact Dockerfile and verified `su`, version 2.42.5,
and readiness through the existing entrypoint with no production data or external network.
Build evidence: https://github.com/heylisa-app/heylisa-n8n/actions/runs/37892566605

A separate isolated runner test passed migration from 2.8.4 to 2.42.5 against PostgreSQL 17,
using an inert workflow, a synthetic encrypted credential and a synthetic historical row.
It never executes a workflow. This test is a compatibility check, not a restored-production rehearsal.
Migration evidence: https://github.com/heylisa-app/heylisa-n8n/actions/runs/37895278133
The temporary tests remain on `codex/n8n-upgrade-2-42-5`, outside the production diff.
The official Cipher interface changed: the validation uses `decryptWithInstanceKey` in 2.42
to check legacy ciphertext without exposing decrypted data. The production key is unchanged.

## Recovery procedure — requires explicit authorization before execution

Returning to the old Docker image alone is NOT a guaranteed rollback after migrations.

1. Diagnose the deployment and migration errors first. Do not overwrite either live volume.
2. Obtain approval for the precise restore scope and the accepted loss window. A PostgreSQL
   volume restore affects the whole cluster, including any other databases using that service.
3. Stop n8n and every other writer to the affected database/volumes before restoring. Prevent
   automatic deployments and scheduled consumers from racing with the restore. This is an
   authorized maintenance action, not part of the upgrade preflight.
4. Restore the chosen pre-upgrade PostgreSQL volume snapshot using the same PostgreSQL 17
   service/image. Keep n8n stopped until database recovery finishes. Do not downgrade PostgreSQL.
5. Restore the corresponding pre-upgrade n8n volume if required by binary data, installed nodes
   or persisted configuration. The accepted snapshots are not synchronized: reconcile database
   references to binary files and any missing artifacts before resuming. Their consistency is
   not guaranteed solely by their existence.
6. Preserve the current encryption key and database connection variables. Neither volume
   backup should be assumed to restore Railway service variables. Never rotate the key here.
7. Deploy the original Git revision `ca429045ef2dc0095df4c888fe6f9a4cc45d7456` with image 2.8.4
   only after the compatible pre-upgrade database has been recovered.
8. Verify version, readiness, migration state, workflow and execution counts, credential
   decryption, TEC A/B and binary references. Account for the accepted snapshot data-loss window.
   Resume normal traffic only after validation. Do not run business workflows as a smoke test.

Avoid untested migration reversals and destructive SQL. No automatic restoration is configured.

## Required production checks after deploy

- Railway deployment succeeds and points to the new Git SHA.
- Runtime n8n version is 2.42.5; HTTPS editor on `n8n.heylisa.io` loads.
- Same PostgreSQL database and volume, same encryption key availability.
- Workflow/credential inventory and historical rows remain present; all credentials decrypt.
- TEC A/B keep their identifiers and active status.
- Startup migrations finish with no critical errors.
- No business workflow is manually triggered during validation.
