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

  // Replicate current production query for just one מקט
  const famMakatim = `SELECTCOLUMNS({"732","800","604"}, "mk", [Value])`;

  // CURRENT query (with מחסן = "Main")
  const current = await dax(`
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
        "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      'ALL_PARTS'[מחסן] = "Main",
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
      TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
    )
  `);
  console.log('\nCURRENT query result (מחסן="Main" in CALCULATETABLE):');
  current.forEach(r => console.log(`  ${r["ALL_PARTS[מק'ט]"]}  daySales=${r["[daySales]"]?.toFixed(2)}`));

  // NEW query — same but with explicit KEEPFILTERS to prevent measure from bypassing
  const newQ = await dax(`
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        VALUES('ALL_PARTS'[מק'ט]),
        "daySales", CALCULATE(
          [TOTAL מכר בקרטונים ממוצע ביום],
          KEEPFILTERS('ALL_PARTS'[מחסן] = "Main")
        )
      ),
      'ALL_PARTS'[חברה] = "FORMULA",
      KEEPFILTERS('ALL_PARTS'[מחסן] = "Main"),
      FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
      TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
    )
  `);
  console.log('\nNEW query (KEEPFILTERS מחסן="Main"):');
  newQ.forEach(r => console.log(`  ${r["ALL_PARTS[מק'ט]"]}  daySales=${r["[daySales]"]?.toFixed(2)}`));

  // REFERENCE: direct per-מחסן check (known correct values)
  console.log('\nREFERENCE (known correct):  732 Main=219.54  ALL=351.86');
}
main().catch(e => console.error(e.message));
