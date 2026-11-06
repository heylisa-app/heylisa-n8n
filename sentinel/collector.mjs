import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const digest = s => createHash('sha256').update(s).digest('hex');
export const CLI_VERSION = '65.12.1';
export const queries = [
  ['runtime', 'level:(error OR fatal)'],
  ['requests', 'httpStatus >= 500 AND httpStatus < 600'],
  ['runtime', '(BILLING_MONTHLY_RUN_FAILED OR BILLING_SEND_FAILED OR BILLING_FISCAL_V2_SNAPSHOT_INVALID OR STRIPE_RUNTIME_ALERT OR INVOICE_RECONCILIATION_UNRESOLVED OR AUTH_SERVER_FAILED OR SIGNUP_SERVER_FAILED OR WORKER_CRITICAL_FAILED)'],
];
export function parsePage(stdout) {
  const rows = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const summary = rows.at(-1);
  if (summary?.type !== 'summary' || !Array.isArray(summary.excludedIntervals)
    || summary.excludedIntervals.length || typeof summary.pagination?.hasMore !== 'boolean') throw Error('COLLECTION_INCOMPLETE');
  const records = rows.slice(0, -1);
  if (records.length !== summary.recordsReturned || records.some(x => !['log', 'request'].includes(x.type) || !x.data || x.data.truncated)) throw Error('COLLECTION_INCOMPLETE');
  return { records, summary };
}
export function normalize({ type, data }, projectId) {
  if (data.projectId !== projectId || data.environment !== 'production') throw Error('COLLECTION_SCOPE_MISMATCH');
  const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.parse(data.timestamp);
  if (!Number.isFinite(timestamp)) throw Error('COLLECTION_INVALID_TIME');
  const id = digest(JSON.stringify([type, timestamp, data.requestId, data.spanId, data.level, data.message, data.httpStatus]));
  return { id, timestamp, projectId, environment: 'production', requestId: data.requestId,
    deploymentId: data.deploymentId, path: data.route ?? data.requestPath,
    level: type === 'request' ? 'error' : data.level, message: data.message ?? '', statusCode: data.httpStatus };
}
export async function collect({ projectId, start, end, run, limit = 1000, maxCalls = 120 }) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 23 * 3600000) throw Error('COVERAGE_GAP');
  const unique = new Map(); let calls = 0;
  for (const [source, query] of queries) {
    const pending = [[start, end]];
    while (pending.length) {
      const [from, to] = pending.pop();
      if (++calls > maxCalls) throw Error('COLLECTION_LIMIT_REACHED');
      const args = ['logs', source, '--project', projectId, '--scope', 'heylisa-apps-projects',
        '--environment', 'production', '--query', query, '--since', new Date(from).toISOString(),
        '--until', new Date(to).toISOString(), '--limit', String(limit), '--json'];
      const { records, summary } = parsePage(await run(args));
      // CLI warns that cursor boundaries sharing a timestamp can omit records.
      // Prefer bounded non-saturated windows. No watermark on unresolved saturation.
      if (summary.pagination.hasMore || records.length >= limit) {
        if (to - from <= 1) throw Error('COLLECTION_SATURATED_TIMESTAMP');
        const middle = Math.floor((from + to) / 2);
        pending.push([from, middle], [middle, to]);
        continue;
      }
      const s = summary.timeRange;
      if (!s || Math.abs(Date.parse(s.start) - from) > 1000 || Math.abs(Date.parse(s.end) - to) > 1000) throw Error('COLLECTION_RANGE_MISMATCH');
      for (const record of records) {
        const log = normalize(record, projectId);
        if (log.timestamp < from - 1000 || log.timestamp > to + 1000) throw Error('COLLECTION_RANGE_MISMATCH');
        unique.set(log.id, log);
      }
    }
  }
  return { logs: [...unique.values()], diagnostics: { calls, records: unique.size, start: new Date(start).toISOString(), end: new Date(end).toISOString(), complete: true } };
}
export function cliRunner(env) {
  if (!env.OPS01_VERCEL_TOKEN) throw Error('MISSING_VERCEL_CREDENTIAL');
  const minimal = { PATH: env.PATH, HOME: '/tmp/ops01-cli', VERCEL_TOKEN: env.OPS01_VERCEL_TOKEN,
    VERCEL_TELEMETRY_DISABLED: '1', CI: '1', NO_COLOR: '1' };
  return async args => {
    try {
      const { stdout } = await exec('/opt/ops01-cli/bin/vercel', args,
        { env: minimal, cwd: '/tmp', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch { throw Error('VERCEL_COLLECTION_FAILED'); }
  };
}
