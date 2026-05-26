require('dotenv').config({ path: '../.env' });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const { getToken } = require('./pbi-kapua');

async function dax(t, q) {
  const r = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: q }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

(async () => {
  const t = await getToken();

  // Fetch makat + URL תמונה for active products that have a URL
  const rows = await dax(t, `
    EVALUATE
    TOPN(10,
      FILTER(
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          'KARTIS PARIT'[תאור],
          'KARTIS PARIT'[URL תמונה],
          FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל")
        ),
        NOT ISBLANK('KARTIS PARIT'[URL תמונה]) && 'KARTIS PARIT'[URL תמונה] <> ""
      )
    )
  `);

  console.log('Products with URL תמונה:', rows.length);
  rows.forEach(r => {
    console.log('  ' + r['KARTIS PARIT[מק"ט]'] + ' | ' + (r['KARTIS PARIT[תאור]']||'').slice(0,30) + ' | ' + r['KARTIS PARIT[URL תמונה]']);
  });

  // Count total with URLs
  const allRows = await dax(t, `
    EVALUATE
    ROW("count", COUNTROWS(FILTER('KARTIS PARIT', NOT ISBLANK('KARTIS PARIT'[URL תמונה]) && 'KARTIS PARIT'[URL תמונה] <> "" && 'KARTIS PARIT'[סטטוס]="פעיל")))
  `);
  console.log('\nTotal active products with photo URL:', allRows[0]?.['[count]']);
})().catch(e => { console.error(e.message); process.exit(1); });
