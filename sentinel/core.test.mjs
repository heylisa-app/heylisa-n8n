import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { classify, classifyBatch, slackMessage } from './core.mjs';
import { sendSlack } from './transport.mjs';
const config = { projectId: 'p', channelId: 'C0CF5EEEB8V', confirmedTestInvoiceIds: [], confirmedTestProviderIds: [] };
const log = { id: 'evt', timestamp: Date.now(), projectId: 'p', environment: 'production', level: 'error', requestId: 'r', deploymentId: 'dpl_x', path: '/api/billing/invoices/private-id/send', message: '{"event":"BILLING_SEND_FAILED","invoiceId":"invoice-1"}', statusCode: 200 };
test('credible Billing failures under HTTP 200 are P0 and do not leak identifiers', () => {
  const [incident] = classify(log, config);
  assert.equal(incident.severity, 'P0'); assert.equal(incident.route, '/api/billing/invoices/[id]/send');
  const serialized = JSON.stringify(slackMessage({ ...incident, occurrences: 1 }, config));
  assert.ok(!serialized.includes('private-id')); assert.ok(!serialized.includes('invoice-1'));
});
test('bootstrap summary links to real project logs rather than a synthetic event filter',()=>{
  const m=slackMessage({code:'OPS01_EXISTING_CRITICAL_INCIDENTS',occurrences:1,impact:'historical'},config);
  assert.match(m.text,/1 incident/);assert.ok(!m.text.includes('query=OPS01_'));
});
test('pipeline failures link to n8n rather than a nonexistent Vercel event',()=>{
  const m=slackMessage({code:'OPS01_MONITOR_FAILED'},{...config,monitorUrl:'https://n8n.cleanyz.io/workflow/approved'});
  assert.match(m.text,/n8n.cleanyz.io\/workflow\/approved/);assert.ok(!m.text.includes('vercel.com'));
});
test('no event, expected client errors and intl noise are silent', () => {
  for (const status of [200, 401, 403, 404]) assert.deepEqual(classify({ ...log, message: '', level: 'info', statusCode: status }, config), []);
  assert.deepEqual(classify({ ...log, message: 'ENVIRONMENT_FALLBACK' }, config), []);
});
test('500 alone is P1; Preview is excluded', () => {
  assert.equal(classify({ ...log, message: '', statusCode: 500 }, config)[0].severity, 'P1');
  assert.deepEqual(classify({ ...log, environment: 'preview' }, config), []);
});
test('server auth and Stripe webhook failures have explicit business impact', () => {
  for (const path of ['/api/auth/login','/api/stripe/webhook','/api/providers/signup','/api/hosts/signup',
    '/api/mobile/v1/auth/provider/team-login/verify','/api/mobile/v1/auth/client/handoff/redeem',
    '/api/mobile/v1/auth/provider/pro-v2/signup-intents/resolve']) assert.equal(classify({ ...log, message:'',path,statusCode:500 },config)[0].severity,'P0');
  assert.equal(classify({...log,message:'',path:'/api/mobile/v1/auth/provider/pro-v2/academy/checkpoint',statusCode:500},config)[0].severity,'P1');
  assert.deepEqual(classify({ ...log, message:'',path:'/api/stripe/webhook',statusCode:400,level:'info' },config),[]);
});
test('P0 plus its HTTP 5xx is one incident; another request remains independently alertable', () => {
  const p0={...log,id:'business',requestId:'same'};
  const technical={...log,id:'technical',requestId:'same',message:'',statusCode:503};
  assert.equal(classifyBatch([p0,technical],config).length,1);
  assert.equal(classifyBatch([p0,{...technical,requestId:'different'}],config).length,2);
});
test('test suppression requires explicit IDs; names never suffice', () => {
  assert.equal(classify({ ...log, message: '{"event":"BILLING_SEND_FAILED","name":"Brice Test"}' }, config)[0].severity, 'P0');
  assert.equal(classify(log, { ...config, confirmedTestInvoiceIds: ['invoice-1'] })[0].severity, 'DIAGNOSTIC');
});
test('unstructured user text cannot impersonate a Billing event and hidden routes stay distinct', () => {
  assert.equal(classify({...log,message:'{"message":"BILLING_SEND_FAILED"}'},config)[0].severity,'P1');
  assert.notEqual(classify({...log,message:'',path:'/api/private-one',statusCode:500},config)[0].signature,
    classify({...log,message:'',path:'/api/private-two',statusCode:500},config)[0].signature);
});
test('watchdog reconciliation is stable across retries and isolates new invoice subjects', () => {
  const message = 'STRIPE_RUNTIME_ALERT INVOICE_RECONCILIATION_UNRESOLVED:00000000-0000-4000-8000-000000000001';
  const a = classify({ ...log, message }, config)[0];
  const b = classify({ ...log, id: 'evt2', message }, config)[0];
  const c = classify({ ...log, id: 'evt3', message: message.replace(/001$/, '002') }, config)[0];
  assert.equal(a.signature, b.signature); assert.notEqual(a.event_id, b.event_id); assert.notEqual(a.signature, c.signature);
});
test('Slack 429 retries, accepted response persists timestamp, ambiguous failure is quarantined', async () => {
  assert.deepEqual(await sendSlack('secret', {}, async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })), { outcome: 'retry', retry_seconds: 120 });
  assert.deepEqual(await sendSlack('secret', {}, async () => Response.json({ ok: true, ts: '123.456' })), { outcome: 'sent', ts: '123.456' });
  assert.deepEqual(await sendSlack('secret', {}, async () => { throw Error('network'); }), { outcome: 'uncertain' });
  assert.deepEqual(await sendSlack('secret', {}, async () => new Response('', { status: 503 })), { outcome: 'uncertain' });
});
test('the restricted node rejects other workflows before accessing credentials', async () => {
  const require = createRequire(import.meta.url); const { Ops01Sentinel } = require('./nodes/Ops01Sentinel.node.js');
  const node = new Ops01Sentinel(); let credentialReads = 0;
  const context = { getWorkflow: () => ({ id: 'another-workflow' }), getCredentials: () => { credentialReads++; } };
  process.env.OPS01_WORKFLOW_ID = 'approved-workflow';
  await assert.rejects(node.execute.call(context), /NOT_AUTHORIZED/);
  assert.equal(credentialReads, 0); assert.deepEqual(node.description.properties.map(p=>p.name),['operation']);
  delete process.env.OPS01_WORKFLOW_ID;
});
