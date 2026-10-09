// Synthetic fixtures only, inside an isolated CI network. Never production.
const root = '/usr/local/lib/node_modules/n8n/node_modules';
const { Client } = require(require.resolve('pg', { paths: [root, root + '/@n8n/db'] }));
const { Cipher } = require(root + '/n8n-core');
const cipher = new Cipher({ encryptionKey: process.env.N8N_ENCRYPTION_KEY });
const workflowId = 'ci-upgrade-workflow';
const credentialId = 'ci-upgrade-credential';
const client = new Client({
  host: process.env.DB_POSTGRESDB_HOST,
  database: process.env.DB_POSTGRESDB_DATABASE,
  user: process.env.DB_POSTGRESDB_USER,
  password: process.env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
});
async function main() {
  await client.connect();
  try {
    if (process.argv[2] === 'seed') {
      await client.query('BEGIN');
      await client.query('INSERT INTO workflow_entity(id,name,nodes,connections,active,"versionId") VALUES($1,$2,$3,$4,false,$5)',
        [workflowId, 'CI inert fixture', '[]', '{}', '11111111-1111-4111-8111-111111111111']);
      await client.query('INSERT INTO credentials_entity(id,name,type,data) VALUES($1,$2,$3,$4)',
        [credentialId, 'CI inert credential', 'httpHeaderAuth', cipher.encrypt({ name: 'X-Test', value: 'public-fixture' })]);
      await client.query('INSERT INTO execution_entity("workflowId",mode,status,finished) VALUES($1,$2,$3,true)',
        [workflowId, 'manual', 'success']);
      await client.query('COMMIT');
      console.log('POSTGRES_2_8_4_FIXTURES_SEEDED_NO_WORKFLOW_EXECUTED');
    } else {
      await client.query('BEGIN READ ONLY');
      const workflow = (await client.query('SELECT name,nodes,connections,active FROM workflow_entity WHERE id=$1', [workflowId])).rows;
      const credentials = (await client.query('SELECT data FROM credentials_entity WHERE id=$1', [credentialId])).rows;
      const executions = (await client.query('SELECT count(*) AS count FROM execution_entity WHERE "workflowId"=$1', [workflowId])).rows;
      if (workflow.length !== 1 || workflow[0].active || workflow[0].name !== 'CI inert fixture') throw new Error('workflow');
      if (JSON.stringify(workflow[0].nodes) !== '[]' || JSON.stringify(workflow[0].connections) !== '{}') throw new Error('content');
      if (credentials.length !== 1 || JSON.parse(cipher.decrypt(credentials[0].data)).value !== 'public-fixture') throw new Error('credential');
      if (executions[0].count !== '1') throw new Error('execution');
      await client.query('ROLLBACK');
      console.log('POSTGRES_2_42_5_MIGRATION_AND_PRESERVATION_PASS');
    }
  } finally {
    await client.end();
  }
}
main().catch(() => { console.error('FIXTURE_CHECK_FAIL_DETAILS_MASKED'); process.exitCode = 1; });
