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
      { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: q }], serializerSettings: { includeNulls: true } }) });
    const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error));
    return j?.results?.[0]?.tables?.[0]?.rows || [];
  }

  const mk = '732';
  const tests = [
    { label: 'TODAY()-45 (fixed window — used at initial load)', filter: `FILTER('ALL_PARTS','ALL_PARTS'[תאריך]>=TODAY()-45)` },
    { label: '2026-01 (January, outer month filter)', filter: `FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך])=2026 && MONTH('ALL_PARTS'[תאריך])=1)` },
    { label: '2026-05 (May, outer month filter)', filter: `FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך])=2026 && MONTH('ALL_PARTS'[תאריך])=5)` },
    { label: '2025-08 (August 2025, outer month filter)', filter: `FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך])=2025 && MONTH('ALL_PARTS'[תאריך])=8)` },
  ];

  console.log(`מק"ט ${mk}, company FORMULA — comparing [TOTAL מכר בקרטונים ממוצע ביום] across different outer date filters:\n`);
  for (const test of tests) {
    const rows = await dax(`
      EVALUATE
      ROW(
        "v", CALCULATE(
          [TOTAL מכר בקרטונים ממוצע ביום],
          'ALL_PARTS'[חברה]="FORMULA",
          ${test.filter},
          'ALL_PARTS'[מק'ט]="${mk}"
        )
      )
    `);
    console.log(`  ${test.label}: ${rows[0]?.['[v]']}`);
  }
}
main().catch(e => console.error('ERROR:', e.message));
