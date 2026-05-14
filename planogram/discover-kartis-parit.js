require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');

(async () => {
  const t = await getToken();
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: [{ query: "EVALUATE TOPN(3, 'KARTIS PARIT')" }],
        serializerSettings: { includeNulls: true }
      }) }
  );
  const j = await res.json();
  if (j.error) { console.log('ERROR:', JSON.stringify(j.error, null, 2)); return; }
  const rows = j.results?.[0]?.tables?.[0]?.rows || [];
  if (rows.length > 0) {
    console.log('=== KARTIS PARIT COLUMNS ===');
    Object.keys(rows[0]).forEach(k => console.log(k));
    console.log('\n=== FIRST ROW ===');
    console.log(JSON.stringify(rows[0], null, 2));
  } else {
    console.log('No rows returned');
  }
})().catch(e => { console.error(e); process.exit(1); });
