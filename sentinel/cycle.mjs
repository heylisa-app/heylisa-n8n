import { classifyBatch, createMonitor } from './core.mjs';
import { collect } from './collector.mjs';

export async function cycle({ rpc, config, run, send, mode = 'dry-run', now = Date.now() }) {
  const lease = await rpc('begin_run', { mode });
  if (!lease.acquired) return { status: 'SKIPPED_CONCURRENT', diagnostics: { published: 0 } };
  const end = now - 120000;
  const start = lease.watermark ? Date.parse(lease.watermark) - 900000 : end - 3600000;
  let watermarkAdvanced = false, published = 0;
  const deadline = Date.now()+240000;
  try {
    const result = await collect({ projectId: config.projectId, start, end, run });
    const events = classifyBatch(result.logs, config, now);
    const classification = {};
    for (const event of events) classification[`${event.severity}:${event.code}`]=(classification[`${event.severity}:${event.code}`]??0)+1;
    for (let i = 0; i < events.length; i += 300) {
      if (Date.now()+45000>deadline) throw Error('PIPELINE_TIME_LIMIT');
      await rpc('ingest', { mode, events: events.slice(i, i + 300), suppress: !lease.watermark });
    }
    await rpc('complete_run', { mode, token: lease.token, watermark: new Date(end).toISOString(), bootstrap: !lease.watermark });
    watermarkAdvanced = true;
    const monitor = createMonitor({ rpc, config, mode, send: async message => {
      const outcome = await send(message); if (outcome.outcome === 'sent') published++; return outcome;
    } });
    const previews = await monitor.tick();
    const health = await monitor.health();
    if (!health.healthy) return {status:'FAILED',diagnostics:{...result.diagnostics,classified:events.length,published,mode,watermarkAdvanced,code:'DELIVERY_REQUIRES_ATTENTION'},previews};
    return { status: 'SUCCESS', diagnostics: { ...result.diagnostics, classified: events.length, published,
      bootstrap: !lease.watermark, mode, classification, incidentSignatures:new Set(events.map(event=>event.signature)).size }, previews };
  } catch (error) {
    const code = /^[A-Z_]{3,64}$/.test(error?.message ?? '') ? error.message : 'COLLECTION_FAILED';
    try {
      if (!watermarkAdvanced) await rpc('fail_run', { mode, token: lease.token, code });
      await createMonitor({ rpc, config, mode, send }).deliver({ onlyMonitor: true });
    } catch { /* DB unavailable is also an execution failure. */ }
    return { status: 'FAILED', diagnostics: { complete: watermarkAdvanced, code, watermarkAdvanced, published } };
  }
}
