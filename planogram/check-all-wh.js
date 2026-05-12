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
  async function dax(q) {
    const r = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${W}/datasets/${D}/executeQueries`,
      { method:'POST', headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},
        body: JSON.stringify({queries:[{query:q}], serializerSettings:{includeNulls:false}}) });
    const j = await r.json(); if(j.error) throw new Error('DAX: '+JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  const mks = ['"732"','"800"','"604"','"1192"','"1051"'].join(',');

  // Sales: Main vs All
  console.log('\n=== Sales Main vs All warehouses (last 90d) ===');
  const sales = await dax(`
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        VALUES('ALL_PARTS'[מק'ט]),
        "main",   CALCULATE([TOTAL מכר בקרטונים ממוצע ביום], KEEPFILTERS('ALL_PARTS'[מחסן]="Main")),
        "all_wh", CALCULATE([TOTAL מכר בקרטונים ממוצע ביום])
      ),
      'ALL_PARTS'[חברה]="FORMULA",
      FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90),
      CONTAINSROW({${mks}}, 'ALL_PARTS'[מק'ט])
    )
  `);
  sales.forEach(r => {
    const mk = r["ALL_PARTS[מק'ט]"];
    const mn = r['[main]']?.toFixed(1);
    const al = r['[all_wh]']?.toFixed(1);
    console.log(`  ${mk}  Main=${mn}  All=${al}  diff=${al&&mn?(al-mn).toFixed(1):'?'}`);
  });

  // Stock (pakuot): Main vs All — per מקט total
  console.log('\n=== Stock total: Main vs All warehouses ===');
  const stock = await dax(`
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        VALUES('מלאי-תוקף'[מק"ט]),
        "main",   CALCULATE(SUM('מלאי-תוקף'[קרטון מלאי תוקף]), 'מלאי-תוקף'[מחסן]="Main"),
        "all_wh", CALCULATE(SUM('מלאי-תוקף'[קרטון מלאי תוקף]))
      ),
      CONTAINSROW({${mks}}, 'מלאי-תוקף'[מק"ט])
    )
  `);
  stock.forEach(r => {
    const mk = r['מלאי-תוקף[מק"ט]'];
    console.log(`  ${mk}  Main=${r['[main]']}קרט  All=${r['[all_wh]']}קרט`);
  });
}
main().catch(e => console.error(e.message));
