import { readFileSync } from 'node:fs';
import { cycle } from './cycle.mjs';
import { remoteRpc, sendSlack } from './transport.mjs';
import { cliRunner } from './collector.mjs';
import { createMonitor } from './core.mjs';

// This process never reads .env files or writes credentials to disk.
const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const env = process.env;
config.monitorUrl = env.OPS01_WORKFLOW_ID ? `https://n8n.cleanyz.io/workflow/${encodeURIComponent(env.OPS01_WORKFLOW_ID)}` : 'https://n8n.cleanyz.io';
const mode = env.OPS01_MODE ?? 'dry-run';
try {
  if (!['dry-run', 'live'].includes(mode)) throw Error('INVALID_MODE');
  if (env.OPS01_SUPABASE_URL !== 'https://sxwjppbearrxssckwzcn.supabase.co') throw Error('STORAGE_SCOPE_MISMATCH');
  if (!env.OPS01_SUPABASE_KEY || !env.OPS01_SLACK_TOKEN) throw Error('MISSING_CREDENTIAL');
  const rpc = remoteRpc(env.OPS01_SUPABASE_URL, env.OPS01_SUPABASE_KEY);
  const send = message => sendSlack(env.OPS01_SLACK_TOKEN, message);
  let result;
  if (env.OPS01_OPERATION === 'testSlack') {
    await rpc('queue_test',{mode:'live'});
    let published=0;
    await createMonitor({rpc,config,mode:'live',send:async message=>{const r=await send(message);if(r.outcome==='sent')published++;return r;}}).deliver({onlyTest:true});
    result={status:'TEST_RECORDED',diagnostics:{published}};
  } else {
    result = await cycle({ config, mode, rpc, run: cliRunner(env), send });
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const code = /^[A-Z_]{3,64}$/.test(error?.message ?? '') ? error.message : 'PIPELINE_FAILED';
  process.stdout.write(JSON.stringify({ status: 'FAILED', diagnostics: { code, published: 0 } }));
}
