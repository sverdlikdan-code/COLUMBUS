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

  const testMakatim = '"732","800","604","1192","1191","1182","1185"';

  // 1. Query the measure for our makatim
  console.log('\n=== סכנה לכול פקא measure per מקט ===');
  const rows = await dax(`
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        VALUES('מלאי-תוקף'[מק"ט]),
        "sakana", [סכנה לכול פקא]
      ),
      CONTAINSROW({${testMakatim}}, 'מלאי-תוקף'[מק"ט])
    )
    ORDER BY 'מלאי-תוקף'[מק"ט]
  `);
  rows.forEach(r => console.log(`  ${r['מלאי-תוקף[מק"ט]']}  sakana=${r['[sakana]']}`));

  // 2. Compare: sales for 732 with and without מחסן filter
  console.log('\n=== Sales comparison for מקט 732 ===');
  const cmp = await dax(`
    EVALUATE
    ROW(
      "main_only",  CALCULATE([TOTAL מכר בקרטונים ממוצע ביום], 'ALL_PARTS'[חברה]="FORMULA", 'ALL_PARTS'[מחסן]="Main",   FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90), 'ALL_PARTS'[מק'ט]="732"),
      "all_warehouses", CALCULATE([TOTAL מכר בקרטונים ממוצע ביום], 'ALL_PARTS'[חברה]="FORMULA",                          FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90), 'ALL_PARTS'[מק'ט]="732")
    )
  `);
  const c = cmp[0];
  console.log(`  732 Main only:      ${c?.['[main_only]']?.toFixed(2)}`);
  console.log(`  732 All warehouses: ${c?.['[all_warehouses]']?.toFixed(2)}`);

  // 3. Total stock across all warehouses vs Main only for 732
  console.log('\n=== Stock comparison for מקט 732 ===');
  const stk = await dax(`
    EVALUATE
    ROW(
      "main_only",      CALCULATE(SUM('מלאי-תוקף'[קרטון מלאי תוקף]), 'מלאי-תוקף'[מחסן]="Main",  'מלאי-תוקף'[מק"ט]="732"),
      "all_warehouses", CALCULATE(SUM('מלאי-תוקף'[קרטון מלאי תוקף]),                               'מלאי-תוקף'[מק"ט]="732")
    )
  `);
  const s = stk[0];
  console.log(`  732 Main only:      ${s?.['[main_only]']} קרט`);
  console.log(`  732 All warehouses: ${s?.['[all_warehouses]']} קרט`);
}
main().catch(e => console.error(e.message));
