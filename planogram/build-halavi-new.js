/**
 * build-halavi-new.js
 * Builds halavi-base.json from Fabric (Power BI DAX) only.
 * Same schema as build-dagim-yavesh-new.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const path = require('path');
const fs   = require('fs');
const { getToken } = require('./pbi-kapua');

const OUT_PATH      = path.join(__dirname, '..', 'docs', 'halavi-base.json');

const WORKING_SLOTS = 60;
const RESERVE_START = 61;
const TOTAL_SLOTS   = 132;

const FAM_CODES = ['018', '020', '021', '025', '028'];
const FAM_NAMES = {
  '018': 'PRESIDENT',
  '020': 'טבורוג SVALIA',
  '021': 'שמנת SVALIA',
  '025': 'גבינה SVALIA',
  '028': 'פרוסות SVALIA',
};

(async () => {
  // ── Step 1: Read layout from existing halavi-base.json ────────────────────
  const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const layout   = existing.layout;

  console.log(`Layout: ${Object.keys(layout).length} positions`);
  const missing = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing positions:', missing.join(','));
  else console.log('✅ All 132 positions mapped');

  // ── Step 2: Fetch products from Fabric ────────────────────────────────────
  const t = await getToken();
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;

  async function dax(query) {
    const res = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
      { method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
    );
    const j = await res.json();
    if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
    return j.results?.[0]?.tables?.[0]?.rows || [];
  }

  const famFilter = FAM_CODES.map(c => `"${c}"`).join(',');
  const mkSet = `SELECTCOLUMNS(FILTER(MLAY, CONTAINSROW({${famFilter}}, MLAY[משפחת מוצר])), "mk", MLAY[מק'ט])`;

  const [salesRows, nameRows] = await Promise.all([
    dax(`
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[מחסן] = "Main",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 365),
        TREATAS(${mkSet}, 'ALL_PARTS'[מק'ט])
      )
    `),
    dax(`
      EVALUATE
      SUMMARIZECOLUMNS(
        MLAY[מק'ט],
        MLAY[תאור מוצר],
        MLAY[משפחת מוצר],
        FILTER(MLAY, CONTAINSROW({${famFilter}}, MLAY[משפחת מוצר]))
      )
      ORDER BY MLAY[משפחת מוצר], MLAY[מק'ט]
    `),
  ]);

  const salesMap = {};
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (mk) salesMap[String(mk)] = r['[daySales]'] || 0;
  }

  const hasSales = [];
  const noSales  = [];

  for (const r of nameRows) {
    const mk   = String(r["MLAY[מק'ט]"] || '').trim();
    const name = String(r["MLAY[תאור מוצר]"] || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
    const fc   = String(r["MLAY[משפחת מוצר]"] || '').trim();
    if (!mk) continue;
    const fam = FAM_NAMES[fc] || fc;
    const ds  = salesMap[mk] || 0;
    if (ds > 0) hasSales.push({ makat: mk, fam, name });
    else        noSales.push({ makat: mk, fam, name });
  }

  // hasSales: preserve family order (already sorted by family, makat in DAX)
  // noSales: sort by family then makat
  noSales.sort((a, b) => a.fam.localeCompare(b.fam) || Number(a.makat) - Number(b.makat));

  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length}`);

  // ── Step 3: Assign products to picks ──────────────────────────────────────
  const picks = {};

  // Working slots 1-60: hasSales first, then noSales to fill remaining
  const allProds = [...hasSales, ...noSales];
  for (let i = 1; i <= WORKING_SLOTS; i++) {
    const prod = allProds[i - 1];
    picks[String(i)] = prod ? { makat: prod.makat, fam: prod.fam, name: prod.name } : null;
  }

  // Reserve slots 61-132: overflow products that didn't fit in working
  const reserveProds = noSales.slice(WORKING_SLOTS - hasSales.length);
  const reserveSlots = TOTAL_SLOTS - WORKING_SLOTS;
  for (let i = 0; i < reserveSlots; i++) {
    const pick = RESERVE_START + i;
    picks[String(pick)] = reserveProds[i]
      ? { makat: reserveProds[i].makat, fam: reserveProds[i].fam, name: reserveProds[i].name }
      : null;
  }
  console.log(`Reserve overflow: ${Math.min(reserveProds.length, reserveSlots)}/${reserveSlots} slots used`);

  // ── Step 4: Write halavi-base.json ────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const result = {
    picks,
    layout,
    maxCols: 12,
    maxRows: 14,
    reserveStart: RESERVE_START,
    v: `${today}-halavi-v1`,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary by grid row
  const rows = {};
  for (const [k, v] of Object.entries(layout)) {
    if (!rows[v.r]) rows[v.r] = [];
    rows[v.r].push(+k);
  }
  for (const r of Object.keys(rows).sort((a, b) => +a - +b)) {
    const sorted = rows[r].sort((a, b) => a - b);
    console.log(`  r:${r}: picks ${sorted[0]}-${sorted[sorted.length-1]} (${sorted.length} slots)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
