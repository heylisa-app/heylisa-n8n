const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

class Ops01Sentinel {
  constructor() {
    this.description = { displayName: 'OPS-01 Backend Sentinel', name: 'ops01Sentinel', group: ['transform'],
      version: 1, description: 'Fixed Production monitor; restricted to the approved OPS-01 workflow',
      defaults: { name: 'OPS-01 Backend Sentinel' }, inputs: ['main'], outputs: ['main'],
      credentials: [{ name: 'slackApi', required: true }, { name: 'supabaseApi', required: true }],
      properties: [{ displayName:'Operation',name:'operation',type:'options',default:'cycle',options:[{name:'Hourly cycle',value:'cycle'},{name:'Unique authorized Slack test',value:'testSlack'}] }] };
  }
  async execute() {
    // No command, path, environment or shell parameter is exposed to workflow input.
    if (!process.env.OPS01_WORKFLOW_ID || this.getWorkflow().id !== process.env.OPS01_WORKFLOW_ID) throw Error('OPS01_WORKFLOW_NOT_AUTHORIZED');
    const slack = await this.getCredentials('slackApi');
    const supabase = await this.getCredentials('supabaseApi');
    const operation = this.getNodeParameter('operation',0,'cycle');
    if (!['cycle','testSlack'].includes(operation)) throw Error('INVALID_OPERATION');
    const env = { PATH: '/opt/ops01-node/bin:/usr/local/bin:/usr/bin:/bin', OPS01_MODE: process.env.OPS01_MODE ?? 'dry-run', OPS01_OPERATION:operation,
      OPS01_VERCEL_TOKEN: process.env.OPS01_VERCEL_TOKEN,
      OPS01_SUPABASE_URL: supabase.host, OPS01_SUPABASE_KEY: supabase.serviceRole,
      OPS01_SLACK_TOKEN: slack.accessToken };
    try {
      const { stdout } = await exec('/opt/ops01-node/bin/node', ['/opt/ops01/runner.mjs'], { env, timeout: 330000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      // Diagnostics are returned to the node output. No raw logs or child stderr.
      return [[{ json: result }]];
    } catch { return [[{ json: { status: 'FAILED', diagnostics: { code: 'OPS01_RUNNER_FAILED', published: 0 } } }]]; }
  }
}
module.exports = { Ops01Sentinel };
