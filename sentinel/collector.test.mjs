import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, parsePage, normalize } from './collector.mjs';
const start = Date.parse('2026-11-06T00:00:00Z'), end = start + 3600000;
function page(records, a = start, b = end, more = false) {
  return [...records, { type: 'summary', recordsReturned: records.length,
    timeRange: { start: new Date(a).toISOString(), end: new Date(b).toISOString() },
    pagination: { hasMore: more, next: more ? 'cursor' : null }, excludedIntervals: [] }].map(x => JSON.stringify(x)).join('\n');
}
const log = { type: 'log', data: { timestamp: start + 1000, projectId: 'p', environment: 'production', requestId: 'r', level: 'error', message: 'BILLING_SEND_FAILED' } };
test('zero records is complete only with a valid summary', async () => {
  const r = await collect({ projectId: 'p', start, end, run: async () => page([]) });
  assert.equal(r.logs.length, 0); assert.equal(r.diagnostics.calls, 3);
  assert.throws(() => parsePage(''), /COLLECTION_INCOMPLETE/);
});
test('repeated query results deduplicate and normalise', async () => {
  const r = await collect({ projectId: 'p', start, end, run: async () => page([log]) });
  assert.equal(r.logs.length, 1); assert.equal(r.logs[0].requestId, 'r');
});
test('preview and foreign projects fail closed', () => {
  assert.throws(() => normalize({ ...log, data: { ...log.data, environment: 'preview' } }, 'p'), /SCOPE/);
  assert.throws(() => normalize(log, 'other'), /SCOPE/);
});
test('saturated windows split with an overlapping boundary', async () => {
  let split = false;
  const result = await collect({ projectId: 'p', start, end, run: async args => {
    const a = Date.parse(args[args.indexOf('--since') + 1]), b = Date.parse(args[args.indexOf('--until') + 1]);
    if (b - a > 1800000) return page([], a, b, true);
    split = true; return page([], a, b);
  } });
  assert.equal(split, true); assert.equal(result.diagnostics.calls, 9);
});
test('unrecoverable saturation, excluded intervals, truncation and bounds fail', async () => {
  await assert.rejects(collect({ projectId: 'p', start, end: start + 1, run: async () => page([], start, start + 1, true) }), /SATURATED/);
  const bad = JSON.parse(page([])); bad.excludedIntervals = [{}];
  assert.throws(() => parsePage(JSON.stringify(bad)), /INCOMPLETE/);
  assert.throws(() => parsePage(page([{ ...log, data: { ...log.data, truncated: true } }])), /INCOMPLETE/);
  await assert.rejects(collect({ projectId: 'p', start, end, maxCalls: 1, run: async () => page([]) }), /LIMIT/);
  await assert.rejects(collect({ projectId: 'p', start, end: end + 86400000, run: async () => page([]) }), /COVERAGE_GAP/);
});
test('provider failure is never an empty success', async () => {
  await assert.rejects(collect({ projectId: 'p', start, end, run: async () => { throw Error('429'); } }), /429/);
});
test('the collection budget expires before the process watchdog can kill persistence', async () => {
  let time=0;
  await assert.rejects(collect({projectId:'p',start,end,clock:()=>{time+=100000;return time;},run:async()=>page([])}),/TIME_LIMIT/);
});
