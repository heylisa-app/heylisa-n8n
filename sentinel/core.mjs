import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function validSignature(body, signature, secret) {
  if (!secret || !/^[a-f0-9]{40}$/.test(signature ?? '')) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), createHmac('sha1', secret).update(body).digest());
}
const critical = {
  BILLING_MONTHLY_RUN_FAILED: ['Facturation', 'Génération mensuelle interrompue ; factures potentiellement non créées'],
  BILLING_SEND_FAILED: ['Facturation', 'Envoi de facture échoué ; compte à vérifier'],
  BILLING_FISCAL_V2_SNAPSHOT_INVALID: ['Facturation', 'Snapshot fiscal invalide ; envoi potentiellement bloqué'],
  INVOICE_RECONCILIATION_UNRESOLVED: ['Paiements', 'Réconciliation de facture non résolue'],
  STRIPE_RECONCILIATION_SCAN_INCOMPLETE: ['Paiements', 'Contrôle de réconciliation incomplet'],
  STRIPE_BACKLOG_OVER_10_MINUTES: ['Paiements', 'Webhooks Stripe en attente depuis plus de dix minutes'],
  STRIPE_PROD_HEALTH_UNAVAILABLE: ['Paiements', 'Contrôle Stripe indisponible'],
  STRIPE_RECONCILIATION_HEALTH_UNAVAILABLE: ['Paiements', 'État de réconciliation indisponible'],
  INVOICE_RECONCILIATION_STALE: ['Paiements', 'Contrôle de réconciliation absent ou périmé'],
  STRIPE_WATCHDOG_PERSIST_FAILED: ['Paiements', 'Watchdog incapable de persister son état'],
  STRIPE_ALERT_DELIVERY_FAILED: ['Paiements', 'Livraison des alertes Stripe échouée'],
  AUTH_SERVER_FAILED: ['Authentification', 'Parcours serveur d’authentification indisponible'],
  SIGNUP_SERVER_FAILED: ['Inscription', 'Inscription serveur bloquée'],
  WORKER_CRITICAL_FAILED: ['Traitements', 'Traitement essentiel interrompu'],
  STRIPE_ASYNC_WAKE_FAILED: ['Paiements', 'Réveil du worker Stripe échoué'],
  STRIPE_WEBHOOK_SERVER_FAILED: ['Paiements', 'Webhook Stripe en erreur serveur ; traitement à vérifier'],
  ICAL_CRON_FEEDS_LOOKUP_FAILED: ['iCal', 'Synchronisation globale bloquée à la lecture des flux'],
  MARKETPLACE_REFRESH_AUTHORIZATIONS_ERROR: ['Marketplace', 'Rafraîchissement des autorisations de paiement interrompu'],
  STRIPE_RUNTIME_ALERT: ['Paiements', 'Nouvelle anomalie structurée du watchdog Stripe ; contrôle requis'],
};
const routes = [
  /^\/api\/billing\/cron\/(generate-auto-invoices|send-auto-invoices)$/,
  /^\/api\/cron\/[a-z-]+$/,
  /^\/api\/stripe\/webhook$/,
  /^\/api\/billing\/invoices\/[^/]+\/send$/,
  /^\/api\/(auth|mobile\/v1\/(provider|client))\/[a-z/-]+$/,
];
// Concrete critical entrypoints verified against the owning Backend route tree.
// Academy checkpoint writes are deliberately left to the normal P1 threshold.
const signupRoutes = new Set(['/api/providers/signup','/api/hosts/signup',
  '/api/mobile/v1/auth/provider/pro-v2/signup-intents','/api/mobile/v1/auth/provider/pro-v2/signup-intents/resolve']);
const authRoutes = new Set(['/api/auth/send-email-hook','/api/admin-v2/auth/login','/api/admin-v2/auth/recovery','/api/admin-v2/auth/password',
  '/api/mobile/v1/auth/review-otp','/api/mobile/v1/auth/client/handoff/redeem','/api/mobile/v1/auth/provider/handoff/redeem',
  '/api/mobile/v1/auth/provider/team-login/request','/api/mobile/v1/auth/provider/team-login/verify']);
export function safeRoute(raw) {
  const path = typeof raw === 'string' ? raw.split('?')[0] : '';
  if (signupRoutes.has(path)||authRoutes.has(path)) return path;
  if (!routes.some(rule => rule.test(path))) return '/[redacted]';
  return path.replace(/(\/invoices\/)\S+(\/send)/, '$1[id]$2');
}
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,180}$/.test(value) ? value : '';
const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Synthetic, anonymised fixtures model the observed codes. No raw log is retained.
export function classify(log, config, now = Date.now()) {
  if (log.projectId !== config.projectId || log.environment !== 'production') return [];
  if (!identifier(log.id) || !Number.isFinite(log.timestamp)
    || log.timestamp < now - 30 * 86400000 || log.timestamp > now + 300000) throw Error('INVALID_EVENT_ID_OR_TIME');
  const message = typeof log.message === 'string' ? log.message : '';
  let data = {};
  try { data = JSON.parse(message); } catch { /* Vercel also carries console.error(code, object). */ }
  if (!data || typeof data !== 'object') data = {};
  const codes = Object.keys(critical).filter(code => code !== 'STRIPE_RUNTIME_ALERT' &&
    ([data.event,data.error,data.code].includes(code) || message.startsWith(code)
      || (message.startsWith('STRIPE_RUNTIME_ALERT') && new RegExp(`\\b${code}\\b`).test(message))));
  if (!codes.length && (message.startsWith('STRIPE_RUNTIME_ALERT') || data.event==='STRIPE_RUNTIME_ALERT')) codes.push('STRIPE_RUNTIME_ALERT');
  if (!codes.length && /\bENVIRONMENT_FALLBACK\b/.test(message)) return [];
  const status = Number(log.statusCode ?? log.proxy?.statusCode);
  const rawPath = typeof log.path === 'string' ? log.path.split('?')[0] : '';
  if (status >= 500 && status <= 599 && (authRoutes.has(rawPath)||/^\/api\/(?:auth\/|mobile\/v1\/(?:provider|client)\/auth\/)/.test(rawPath))) codes.push('AUTH_SERVER_FAILED');
  if (status >= 500 && status <= 599 && signupRoutes.has(rawPath)) codes.push('SIGNUP_SERVER_FAILED');
  if (status >= 500 && status <= 599 && rawPath === '/api/stripe/webhook') codes.push('STRIPE_WEBHOOK_SERVER_FAILED');
  if (!codes.length && ![500, 502, 503, 504].includes(status) && log.level !== 'error' && log.level !== 'fatal') return [];
  if (!codes.length && [401, 403, 404].includes(status)) return [];
  const route = safeRoute(log.path ?? log.proxy?.path ?? log.entrypoint);
  const test = (data.invoiceId && config.confirmedTestInvoiceIds.includes(data.invoiceId))
    || (data.providerId && config.confirmedTestProviderIds.includes(data.providerId));
  const result = [];
  for (const code of codes.length ? [...new Set(codes)] : [log.level === 'fatal' ? 'FATAL_RUNTIME' : [500,502,503,504].includes(status) ? `HTTP_${status}` : 'APPLICATION_ERROR']) {
    // Reconciliation issue identity excludes volatile watchdog counters/run IDs.
    const subjects = code === 'INVOICE_RECONCILIATION_UNRESOLVED'
      ? [...message.matchAll(new RegExp(`${code}:(${uuid})`, 'g'))].map(match => match[1]) : [];
    for (const subject of subjects.length ? [...new Set(subjects)] : [data.invoiceId ?? 'unknown']) {
      const severity = critical[code] || code === 'FATAL_RUNTIME' ? 'P0' : 'P1';
      const routeKey = route === '/[redacted]' ? hash(rawPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[id]')) : route;
      const signature = hash([code, routeKey, subject].join('|'));
      result.push({ event_id: `${log.id}:${signature}`, occurred_at: new Date(log.timestamp).toISOString(),
        project_id: config.projectId, environment: 'production',
        signature, code, route, severity: test ? 'DIAGNOSTIC' : severity,
        deployment: identifier(log.deploymentId), request_id: identifier(log.requestId),
        domain: critical[code]?.[0] ?? 'Backend', impact: critical[code]?.[1] ?? 'Erreur serveur ; parcours à vérifier',
        test_confirmed: Boolean(test) });
    }
  }
  return result;
}
export function slackMessage(incident, config) {
  if (incident.code === 'OPS01_TEST') return { channel: config.channelId, text: '[TEST OPS-01] Validation technique de la sentinelle Backend Cleanyz. Aucun incident métier. Ce test autorisé est unique.', unfurl_links:false, unfurl_media:false };
  if (incident.code === 'OPS01_MONITOR_FAILED') return {channel:config.channelId,
    text:`🚨 P0 — Cleanyz | Surveillance\nIncident : collecte en échec au moins trois fois consécutives.\nImpact : couverture des erreurs Production non certifiée.\nDiagnostic : ${config.monitorUrl??'https://n8n.cleanyz.io'}`,unfurl_links:false,unfurl_media:false};
  if (incident.code === 'OPS01_EXISTING_CRITICAL_INCIDENTS') return {channel:config.channelId,
    text:`🚨 P0 — Cleanyz | Incidents préexistants\n${incident.occurrences} incident(s) critique(s) consolidé(s) au démarrage.\nImpact : ${incident.impact}\nDiagnostic : https://vercel.com/heylisa-apps-projects/bnb-cleaning-planner/logs`,unfurl_links:false,unfurl_media:false};
  const diagnostic = `https://vercel.com/heylisa-apps-projects/bnb-cleaning-planner/logs?query=${encodeURIComponent(incident.request_id || incident.code)}`;
  return { channel: config.channelId, unfurl_links: false, unfurl_media: false,
    text: `🚨 ${incident.severity} — Cleanyz | ${incident.domain}\nIncident : ${incident.code}\nImpact : ${incident.impact}\nOccurrences : ${incident.occurrences} depuis ${incident.first_seen}\nRoute : ${incident.route}\nDéploiement : ${incident.deployment || 'indisponible'}\nDernière erreur : ${incident.code}\nRequête : ${incident.request_id || 'indisponible'}\nDiagnostic : ${diagnostic}` };
}

export function classifyBatch(logs, config, now = Date.now()) {
  const events = logs.flatMap(log => classify(log, config, now));
  const requestKey = event => `${event.deployment}:${event.request_id}`;
  const criticalRequests = new Set(events.filter(event => event.severity==='P0' && event.request_id).map(requestKey));
  // The request's 5xx is diagnostic context for its structured P0, not a second incident.
  return events.filter(event => event.severity!=='P1' || !event.request_id || !criticalRequests.has(requestKey(event)));
}

export function createMonitor({ rpc, config, mode = 'dry-run', send, clock = Date.now }) {
  async function deliver({ onlyMonitor = false, onlyTest = false } = {}) {
    const previews = [];
    const deadline = Date.now()+60000;
    for (let i = 0; i < 50; i++) {
      if (Date.now()+40000>deadline) break;
      const item = await rpc('claim', { mode, only_monitor: onlyMonitor, only_test: onlyTest });
      if (!item) break;
      const message = slackMessage(item.incident, config);
      if (item.thread_ts) message.thread_ts = item.thread_ts;
      if (mode === 'dry-run') {
        previews.push(message);
        await rpc('finish', { mode, id: item.id, token: item.token, outcome: 'dry-run' });
        continue;
      }
      let response;
      try { response = await send(message); }
      catch { response = { outcome: 'uncertain' }; }
      await rpc('finish', { mode, id: item.id, token: item.token, ...response });
    }
    return previews;
  }
  return {
    async ingest(logs) {
      const events = classifyBatch(logs, config, clock());
      await rpc('ingest', { mode, events });
      return deliver(); // P0 queued atomically with ingestion, sent in the same invocation.
    },
    async tick() {
      await rpc('sweep', { mode, count: config.p1Count, requests: config.p1Requests,
        window_minutes: config.windowMinutes, reminders: config.dailyReminders });
      return deliver();
    },
    deliver,
    health: () => rpc('health', { mode }),
  };
}
