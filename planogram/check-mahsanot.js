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
    const j = await r.json(); if(j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  // 1. Distinct מחסן values for FORMULA in ALL_PARTS
  console.log('\n=== ALL_PARTS מחסן values for FORMULA ===');
  const rows = await dax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      'ALL_PARTS'[מחסן],
      FILTER('ALL_PARTS', 'ALL_PARTS'[חברה] = "FORMULA")
    )
    ORDER BY 'ALL_PARTS'[מחסן]
  `);
  rows.forEach(r => console.log(' ', r["ALL_PARTS[מחסן]"]));

  // 2. How many rows match the CURRENT filter (מחסן = "Main") vs numeric?
  console.log('\n=== Test: does מחסן = "Main" match anything in ALL_PARTS FORMULA? ===');
  const testMain = await dax(`
    EVALUATE
    ROW("count", CALCULATE(COUNTROWS('ALL_PARTS'), 'ALL_PARTS'[חברה]="FORMULA", 'ALL_PARTS'[מחסן]="Main"))
  `);
  console.log(' rows with מחסן="Main":', testMain[0]?.['[count]'] ?? 0);

  // 3. Sample actual sales for מקט 732 (חמאה FERMA) per warehouse
  console.log('\n=== Sales for מקט 732 per מחסן (FORMULA, last 90d) ===');
  const sales = await dax(`
    EVALUATE
    CALCULATETABLE(
      SUMMARIZECOLUMNS(
        'ALL_PARTS'[מחסן],
        "units", SUM('ALL_PARTS'[כמות ביח' מפעל])
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      'ALL_PARTS'[מק'ט] = "732",
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90)
    )
    ORDER BY 'ALL_PARTS'[מחסן]
  `);
  sales.forEach(r => console.log(`  מחסן=${r["ALL_PARTS[מחסן]"]}  units=${r["[units]"]}`));

  // 4. Check if the current measure works per מחסן
  console.log('\n=== Current measure [TOTAL מכר בקרטונים ממוצע ביום] for מקט 732 (all vs each מחסן) ===');
  const measure = await dax(`
    EVALUATE
    UNION(
      ROW("מחסן","ALL", "daySales", CALCULATE([TOTAL מכר בקרטונים ממוצע ביום], 'ALL_PARTS'[חברה]="FORMULA", 'ALL_PARTS'[מק'ט]="732", FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90))),
      CALCULATETABLE(
        ADDCOLUMNS(SUMMARIZE('ALL_PARTS','ALL_PARTS'[מחסן]), "daySales", [TOTAL מכר בקרטונים ממוצע ביום]),
        'ALL_PARTS'[חברה]="FORMULA", 'ALL_PARTS'[מק'ט]="732", FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90)
      )
    )
  `);
  measure.forEach(r => console.log(`  מחסן=${r["ALL_PARTS[מחסן]"]??r["[מחסן]"]??'ALL'}  daySales=${r["[daySales]"]}`));
}
main().catch(e => console.error(e.message));
