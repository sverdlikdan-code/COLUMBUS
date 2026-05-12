require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT = process.env.AZURE_TENANT_ID; process.env.PBI_CLIENT = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET = process.env.AZURE_CLIENT_SECRET; process.env.PBI_DATASET = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');
function fixVisualRTL(s) {
  s = s.replace(/[‎‏‪-‮⁦-⁩]/g, '');
  return s.split('').reverse().join('').replace(/[\x20-\x7E]+/g, m => m.split('').reverse().join('')).trim();
}
async function main() {
  const t = await getToken();
  const W = process.env.PBI_WORKSPACE, D = process.env.PBI_DATASET;
  async function dax(q) {
    const r = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${W}/datasets/${D}/executeQueries`,
      { method:'POST', headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},
        body: JSON.stringify({queries:[{query:q}], serializerSettings:{includeNulls:false}}) });
    const j = await r.json(); if(j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  // All products in family 026
  const rows = await dax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[מק'ט], MLAY[תאור מוצר],
      FILTER(MLAY, MLAY[משפחת מוצר] = "026")
    )
    ORDER BY MLAY[מק'ט]
  `);
  console.log(`\nFamily 026 (חמאה SVALIA): ${rows.length} products`);
  rows.forEach(r => {
    const mk = r["MLAY[מק'ט]"]; const desc = fixVisualRTL(r["MLAY[תאור מוצר]"]||'');
    console.log(`  ${mk} | ${desc}`);
  });

  // Stock at Main for these
  if (rows.length) {
    const mkList = rows.map(r => `"${r["MLAY[מק'ט]"]}"`).join(',');
    const stock = await dax(`
      EVALUATE
      SUMMARIZECOLUMNS('מלאי-תוקף'[מק"ט],
        FILTER('מלאי-תוקף', 'מלאי-תוקף'[מחסן] = "Main" && CONTAINSROW({${mkList}}, 'מלאי-תוקף'[מק"ט])),
        "stock", SUM('מלאי-תוקף'[קרטון מלאי תוקף])
      )
    `);
    console.log(`\n  Stock at Main:`);
    if (!stock.length) console.log('  → ZERO / לא קיים במחסן Main');
    stock.forEach(r => console.log(`  ${r['מלאי-תוקף[מק"ט]']} → ${r['[stock]']} קרט`));
  }
}
main().catch(e => console.error(e.message));
