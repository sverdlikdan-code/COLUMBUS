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
        body: JSON.stringify({queries:[{query:q}], serializerSettings:{includeNulls:true}}) });
    const j = await r.json(); if(j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  // All MLAY columns for מקט 732
  const row = (await dax(`EVALUATE FILTER(MLAY, MLAY[מק'ט] = "732")`))[0] || {};
  console.log('MLAY columns for מקט 732:');
  Object.entries(row).forEach(([k,v]) => console.log(`  ${k} = ${v}`));

  // Verify: units/carton for 732 vs our palletMap value
  console.log('\nCalculated check for מקט 732 (Main, 90d):');
  const test = await dax(`
    EVALUATE
    ROW(
      "units_main_90d", CALCULATE(
        SUM('ALL_PARTS'[כמות ביח' מפעל]),
        'ALL_PARTS'[חברה]="FORMULA",
        'ALL_PARTS'[מחסן]="Main",
        FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90),
        'ALL_PARTS'[מק'ט]="732"
      ),
      "measure_main", CALCULATE(
        [TOTAL מכר בקרטונים ממוצע ביום],
        'ALL_PARTS'[חברה]="FORMULA",
        'ALL_PARTS'[מחסן]="Main",
        FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-90),
        'ALL_PARTS'[מק'ט]="732"
      )
    )
  `);
  const r0 = test[0];
  console.log('  units/90d:', r0?.['[units_main_90d]']);
  console.log('  measure cartons/day:', r0?.['[measure_main]']);
  const units = r0?.['[units_main_90d]'];
  const cartons = r0?.['[measure_main]'];
  if (units && cartons) console.log('  implied krat (units/carton):', (units / (cartons * 90)).toFixed(1));
}
main().catch(e => console.error(e.message));
