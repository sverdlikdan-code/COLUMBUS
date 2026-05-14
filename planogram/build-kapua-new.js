/**
 * build-kapua-new.js
 * Builds kapua-base.json from Fabric (Power BI DAX) only.
 *
 * Products + 365-day sales → Fabric (MLAY, KARTIS PARIT, ALL_PARTS)
 * Physical layout (pick# → grid row/col) → existing kapua-base.json [layout]
 *   Layout is static (physical shelves don't move). Update manually when bays change.
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

const OUT_PATH = path.join(__dirname, '..', 'docs', 'kapua-base.json');

const WORKING_SLOTS = 61;
const RESERVE_SLOTS = 18;
const RESERVE_START = 62;

const BLACKLIST = new Set(['1130', '1131']);

// Family codes in planogram order (approved by user)
const FAM_CODES = ['029','004','026','022','019','035','421','420','046','0191','0190'];
const FAM_NAMES = {
  '029':'חמאה FERMA', '004':'חמאה רושן',   '026':'חמאה SVALIA',
  '022':'ממרחי חמאה', '019':'כיסונים',     '035':'SANTA BREMOR',
  '421':'עוגות רושן', '420':'עוגות מוזיקה','046':'חטיף גבינה',
  '0191':'מוסדי',     '0190':'VALESTA',
};
const FAM_ORDER = {};
FAM_CODES.forEach((c, i) => { FAM_ORDER[c] = i; });

async function dax(token, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

(async () => {
  // ── Step 1: Load physical layout from existing kapua-base.json ────────────
  const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  const { layout, maxCols = 18, maxRows = 11 } = existing;
  console.log(`Layout: ${Object.keys(layout).length} positions (from kapua-base.json)`);

  // ── Step 2: Fetch products + 365-day sales from Fabric ────────────────────
  const t        = await getToken();
  const famCodes = FAM_CODES.map(c => `"${c}"`).join(',');

  // Active products in target families (status=פעיל in KARTIS PARIT)
  const famMakatim = `
    INTERSECT(
      SELECTCOLUMNS(
        FILTER(MLAY, CONTAINSROW({${famCodes}}, MLAY[משפחת מוצר])),
        "mk", MLAY[מק'ט]
      ),
      CALCULATETABLE(VALUES('KARTIS PARIT'[מק"ט]), 'KARTIS PARIT'[סטטוס]="פעיל")
    )`;

  const [mlayRows, salesRows] = await Promise.all([

    // Products with family code
    dax(t, `
      EVALUATE
      SUMMARIZECOLUMNS(
        MLAY[מק'ט],
        MLAY[משפחת מוצר],
        FILTER(MLAY, CONTAINSROW(${famMakatim}, MLAY[מק'ט]))
      )
    `),

    // 365-day avg daily sales (all warehouses, FORMULA)
    dax(t, `
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "mkr365", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 365),
        TREATAS(${famMakatim}, 'ALL_PARTS'[מק'ט])
      )
    `),

  ]);

  // Build sales map
  const salesMap = {};
  for (const r of salesRows) {
    const mk = String(r["ALL_PARTS[מק'ט]"] || '').trim();
    if (mk) salesMap[mk] = r['[mkr365]'] || 0;
  }

  // Build product list, filter blacklist + zero sales
  const seen = new Set();
  const products = [];
  for (const r of mlayRows) {
    const mk = String(r["MLAY[מק'ט]"] || '').trim();
    const fc = String(r["MLAY[משפחת מוצר]"] || '').trim();
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    if (BLACKLIST.has(mk)) { console.log(`  ⛔ blacklisted: ${mk}`); continue; }
    const mkr = salesMap[mk] || 0;
    if (mkr <= 0) continue;
    products.push({ makat: mk, fam: FAM_NAMES[fc] || fc, famCode: fc, mkr365: mkr });
  }

  // Sort: family order → sales desc within family
  products.sort((a, b) => {
    const fo = (FAM_ORDER[a.famCode] ?? 99) - (FAM_ORDER[b.famCode] ?? 99);
    return fo !== 0 ? fo : b.mkr365 - a.mkr365;
  });

  console.log(`Products (mkr365 > 0, active, not blacklisted): ${products.length}`);
  if (products.length > WORKING_SLOTS) {
    console.warn(`⚠ ${products.length - WORKING_SLOTS} products overflow ${WORKING_SLOTS} working slots`);
  }

  // ── Step 3: Assign products to picks ────────────────────────────────────
  const picks = {};
  for (let i = 1; i <= WORKING_SLOTS; i++) {
    const prod = products[i - 1];
    picks[String(i)] = prod ? { makat: prod.makat, fam: prod.fam, name: null } : null;
  }
  for (let i = 0; i < RESERVE_SLOTS; i++) {
    picks[String(RESERVE_START + i)] = null;
  }

  // ── Step 4: Write kapua-base.json ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const result = { picks, layout, maxCols, maxRows, reserveStart: RESERVE_START, v: `${today}-kapua-v4` };
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary by family
  const famCounts = {};
  for (const p of products) famCounts[p.fam] = (famCounts[p.fam] || 0) + 1;
  for (const [fam, cnt] of Object.entries(famCounts)) console.log(`  ${fam}: ${cnt}`);
})().catch(e => { console.error(e); process.exit(1); });
