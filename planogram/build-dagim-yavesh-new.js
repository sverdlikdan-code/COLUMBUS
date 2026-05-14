/**
 * build-dagim-yavesh-new.js
 * Builds dagim-yavesh-base.json from:
 *   - MAHSAN 8.xlsx sheet "דג יבש" — physical bay positions
 *   - Fabric PBI — products + sales (families 03, 031, 032, 034)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.PBI_TENANT && process.env.AZURE_TENANT_ID) {
  process.env.PBI_TENANT    = process.env.AZURE_TENANT_ID;
  process.env.PBI_CLIENT    = process.env.AZURE_CLIENT_ID;
  process.env.PBI_SECRET    = process.env.AZURE_CLIENT_SECRET;
  process.env.PBI_DATASET   = process.env.POWERBI_DATASET_ID;
  process.env.PBI_WORKSPACE = process.env.POWERBI_WORKSPACE_ID;
}
const path    = require('path');
const fs      = require('fs');
const ExcelJS = require(path.join(__dirname, '..', 'server', 'node_modules', 'exceljs'));
const { getToken } = require('./pbi-kapua');

const PLANOGRAM_DIR = 'C:/Users/d.sverdlik/Desktop/WORKSPACE/PLANOGRAM MAHSAN FORMULA';
const OUT_PATH      = path.join(__dirname, '..', 'docs', 'dagim-yavesh-base.json');

const WORKING_SLOTS  = 32;
const RESERVE_SLOTS  = 3;
const RESERVE_START  = 33;

const FAM_CODES = ['03', '031', '032', '034'];
const FAM_NAMES = {
  '03':  'דגים KAZAHSTAN',
  '031': 'דגים RUSSIA',
  '032': 'דגים פודסטוק',
  '034': 'דגים RUSSIAN SEA',
};

// Excel col (1-based) → grid col (1-based)
const excelToGrid = c => c - 1;

(async () => {
  // ── Step 1: Extract pick → {r, c} from MAHSAN 8 "דג יבש" ─────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(PLANOGRAM_DIR, 'MAHSAN 8.xlsx'));
  const ws = wb.getWorksheet('דג יבש');

  const layout = {};
  // R2 → grid row 1, R5 → grid row 3 (corridor at row 2)
  const EXCEL_ROW_TO_GRID = { 2: 1, 5: 3 };

  for (const [excelRow, gridRow] of Object.entries(EXCEL_ROW_TO_GRID)) {
    const row = ws.getRow(Number(excelRow));
    for (let c = 1; c <= 25; c++) {
      const v = row.getCell(c).value;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 35) {
        layout[String(v)] = { r: gridRow, c: excelToGrid(c) };
      }
    }
  }

  console.log(`Layout: ${Object.keys(layout).length} positions`);
  const missing = [];
  for (let i = 1; i <= 35; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing picks:', missing.join(','));
  else console.log('✅ All 35 picks mapped');

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
        FILTER('ALL_PARTS', 'ALL_PARTS'[תאריך] >= TODAY() - 90),
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
    const fam  = FAM_NAMES[fc] || fc;
    const ds   = salesMap[mk] || 0;
    if (ds > 0) hasSales.push({ makat: mk, fam, name });
    else        noSales.push({ makat: mk, fam, name });
  }

  // hasSales: preserve family order (already sorted by family, makat in DAX)
  // noSales: sort by family then makat
  noSales.sort((a, b) => a.fam.localeCompare(b.fam) || Number(a.makat) - Number(b.makat));

  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length}`);

  // ── Step 3: Assign products to picks ──────────────────────────────────────
  const picks = {};

  // Working slots 1-32: hasSales first, then noSales to fill remaining
  const allProds = [...hasSales, ...noSales];
  for (let i = 1; i <= WORKING_SLOTS; i++) {
    const prod = allProds[i - 1];
    picks[String(i)] = prod ? { makat: prod.makat, fam: prod.fam, name: prod.name } : null;
  }

  // Reserve slots 33-35: overflow noSales products that didn't fit in working
  const reserveProds = noSales.slice(WORKING_SLOTS - hasSales.length);
  for (let i = 0; i < RESERVE_SLOTS; i++) {
    const pick = RESERVE_START + i;
    picks[String(pick)] = reserveProds[i]
      ? { makat: reserveProds[i].makat, fam: reserveProds[i].fam, name: reserveProds[i].name }
      : null;
  }
  console.log(`Reserve overflow: ${Math.min(reserveProds.length, RESERVE_SLOTS)}/${RESERVE_SLOTS} slots used`);

  // ── Step 4: Write dagim-yavesh-base.json ──────────────────────────────────
  const result = {
    picks,
    layout,
    maxCols: 22,
    maxRows: 3,
    reserveStart: RESERVE_START,
    v: `2026-05-14-dagim-yavesh-v1`,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary
  const rows = {};
  for (const [k, v] of Object.entries(layout)) {
    if (!rows[v.r]) rows[v.r] = [];
    rows[v.r].push(+k);
  }
  const labels = { 1: 'Working R2', 3: 'Working+Reserve R5' };
  for (const r of Object.keys(rows).sort((a, b) => +a - +b)) {
    const sorted = rows[r].sort((a, b) => a - b);
    console.log(`  r:${r} [${labels[r] || '?'}]: picks ${sorted[0]}-${sorted[sorted.length-1]} (${sorted.length} slots)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
