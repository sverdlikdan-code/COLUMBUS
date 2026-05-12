require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT = process.env.AZURE_TENANT_ID; process.env.PBI_CLIENT = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET = process.env.AZURE_CLIENT_SECRET; process.env.PBI_DATASET = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');
async function main() {
  const t = await getToken();
  const W = process.env.PBI_WORKSPACE, D = process.env.PBI_DATASET;
  // Grab one row from ALL_PARTS to see all column names
  const res = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${W}/datasets/${D}/executeQueries`,
    { method:'POST', headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},
      body: JSON.stringify({ queries:[{ query:`EVALUATE TOPN(1, 'ALL_PARTS')` }], serializerSettings:{includeNulls:true} }) });
  const j = await res.json();
  const row = j?.results?.[0]?.tables?.[0]?.rows?.[0] || {};
  console.log('ALL_PARTS columns:');
  Object.keys(row).forEach(k => console.log(' ', k, '=', row[k]));
}
main().catch(e => console.error(e.message));
