/**
 * build-dagim-fab.js
 * Builds dagim-base.json from Fabric (Power BI / KARTIS PARIT) only.
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

const OUT_PATH = path.join(__dirname, '..', 'docs', 'dagim-base.json');

const WORKING_SLOTS = 97;
const RESERVE_START = 98;
const TOTAL_SLOTS   = 126;

// fixHebRTL(clean) → display name
const FAM_NAMES = {
  'NORD PORT דגים':             'NORD PORT דגים',
  'NORD PORT מצונן פורל/סלמון': 'NORD PORT מצונן',
  'SANTA BREMOR דגים':          'SANTA BREMOR דגים',
};

function fixHebRTL(s) {
  if (!s) return s;
  return s.replace(/[ְ-תװ-״]+/g, m => m.split('').reverse().join(''));
}

function cleanFam(raw) {
  const clean = (raw || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
  const fixed = fixHebRTL(clean);
  if (!fixed) return null;
  if (FAM_NAMES[fixed]) return FAM_NAMES[fixed];
  console.log(`dagim fam unknown: ${JSON.stringify(fixed)}`);
  return fixed;
}

(async () => {
  // ── Step 1: Read layout from existing dagim-base.json ─────────────────────
  const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const layout   = existing.layout;

  console.log(`Layout: ${Object.keys(layout).length} positions`);
  const missing = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing positions:', missing.join(','));
  else console.log(`✅ All ${TOTAL_SLOTS} positions mapped`);

  // ── Step 2: Fetch products + sales from Fabric ────────────────────────────
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

  const dagimMakatim = `
    SELECTCOLUMNS(
      FILTER('KARTIS PARIT',
        'KARTIS PARIT'[סטטוס] = "פעיל" &&
        'KARTIS PARIT'[שם מחסן אשדוד] = "דגים 🐟"
      ),
      "mk", 'KARTIS PARIT'[מק"ט]
    )`;

  const [kpRows, salesRows] = await Promise.all([
    dax(`
      EVALUATE
      SELECTCOLUMNS(
        FILTER('KARTIS PARIT',
          'KARTIS PARIT'[סטטוס] = "פעיל" &&
          'KARTIS PARIT'[שם מחסן אשדוד] = "דגים 🐟"
        ),
        "makat", 'KARTIS PARIT'[מק"ט],
        "fam",   'KARTIS PARIT'[תאור משפחה]
      )
      ORDER BY 'KARTIS PARIT'[תאור משפחה], 'KARTIS PARIT'[מק"ט]
    `),
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
        TREATAS(${dagimMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),
  ]);

  if (!kpRows.length) throw new Error('No dagim products found — check שם מחסן אשדוד = "דגים 🐟"');

  const salesMap = {};
  for (const r of salesRows) {
    const mk = r["ALL_PARTS[מק'ט]"];
    if (mk) salesMap[String(mk)] = r['[daySales]'] || 0;
  }

  const hasSales = [];
  const noSales  = [];

  for (const r of kpRows) {
    const mk  = String(r['[makat]'] || '').trim();
    const fam = cleanFam(r['[fam]']);
    if (!mk) continue;
    const ds = salesMap[mk] || 0;
    if (ds > 0) hasSales.push({ makat: mk, fam, name: null });
    else        noSales.push({ makat: mk, fam, name: null });
  }

  // hasSales: preserve order from DAX (family, makat)
  // noSales: sort by family then makat
  noSales.sort((a, b) => (a.fam || '').localeCompare(b.fam || '') || Number(a.makat) - Number(b.makat));

  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length}`);

  // ── Step 3: Assign products to picks ──────────────────────────────────────
  const picks = {};

  // Working slots 1-97: hasSales first, then noSales to fill remaining
  const allProds = [...hasSales, ...noSales];
  for (let i = 1; i <= WORKING_SLOTS; i++) {
    const prod = allProds[i - 1];
    picks[String(i)] = prod ? { makat: prod.makat, fam: prod.fam, name: null } : null;
  }

  // Reserve slots 98-126: overflow products
  const reserveProds = noSales.slice(WORKING_SLOTS - hasSales.length);
  const reserveSlots = TOTAL_SLOTS - WORKING_SLOTS;
  for (let i = 0; i < reserveSlots; i++) {
    const pick = RESERVE_START + i;
    picks[String(pick)] = reserveProds[i]
      ? { makat: reserveProds[i].makat, fam: reserveProds[i].fam, name: null }
      : null;
  }
  console.log(`Reserve overflow: ${Math.min(reserveProds.length, reserveSlots)}/${reserveSlots} slots used`);
  if (allProds.length > WORKING_SLOTS) console.warn(`⚠ ${allProds.length - WORKING_SLOTS} products overflow working slots`);

  // ── Step 4: Write dagim-base.json ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const result = {
    picks,
    layout,
    maxCols: existing.maxCols || 29,
    maxRows: existing.maxRows || 9,
    reserveStart: RESERVE_START,
    v: `${today}-dagim-fab-v1`,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary by family
  const famCounts = {};
  for (const p of allProds) famCounts[p.fam || '?'] = (famCounts[p.fam || '?'] || 0) + 1;
  for (const [fam, cnt] of Object.entries(famCounts)) console.log(`  ${fam}: ${cnt}`);
})().catch(e => { console.error(e); process.exit(1); });
