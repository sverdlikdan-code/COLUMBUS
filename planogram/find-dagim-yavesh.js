require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');

async function main() {
  const t = await getToken();
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;

  async function dax(query) {
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
      { method:'POST', headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},
        body: JSON.stringify({ queries:[{query}], serializerSettings:{includeNulls:false} }) }
    );
    const j = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  // 1. All family codes + names — find dry fish
  console.log('\n=== ALL FAMILY CODES (MLAY) ===');
  const famRows = await dax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[משפחת מוצר],
      MLAY[תאור משפחה]
    )
    ORDER BY MLAY[משפחת מוצר]
  `);
  famRows.forEach(r => {
    const code = r["MLAY[משפחת מוצר]"];
    const name = r["MLAY[תאור משפחה]"];
    const nameLower = (name||'').toLowerCase();
    // Print all — highlight suspected dry fish
    const flag = (nameLower.includes('kazah') || nameLower.includes('russia') ||
                  nameLower.includes('קזח') || nameLower.includes('רוסי') ||
                  nameLower.includes('פודסטוק') || nameLower.includes('יבש') ||
                  nameLower.includes('dagim') || nameLower.includes('דג')) ? ' <<<' : '';
    if (flag || nameLower.includes('דג') || nameLower.includes('fish')) {
      console.log(`  ${code} | ${name}${flag}`);
    }
  });

  // 2. Show ALL families for broader context
  console.log('\n=== ALL FAMILIES (for reference) ===');
  famRows.forEach(r => console.log(`  ${r["MLAY[משפחת מוצר]"]} | ${r["MLAY[תאור משפחה]"]}`));
}

main().catch(e => console.error(e.message));
