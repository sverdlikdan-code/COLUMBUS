require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');

(async () => {
  const t = await getToken();
  const run = async (query) => {
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
      { method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
    );
    const j = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.results?.[0]?.tables?.[0]?.rows || [];
  };

  console.log('=== מלאי-תוקף warehouses ===');
  const rows1 = await run(`EVALUATE SUMMARIZECOLUMNS('מלאי-תוקף'[מחסן])`);
  rows1.forEach(r => console.log(JSON.stringify(r)));

  console.log('\n=== ALL_PARTS warehouses ===');
  const rows2 = await run(`EVALUATE SUMMARIZECOLUMNS('ALL_PARTS'[מחסן])`);
  rows2.forEach(r => console.log(JSON.stringify(r)));
})().catch(e => { console.error(e); process.exit(1); });
