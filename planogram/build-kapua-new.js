/**
 * build-kapua-new.js
 * Builds kapua-base.json from:
 *   - MAHSAN 8.xlsx (PLANOGRAM MAHSAN FORMULA) sheet "MAHSAN 8" — physical bay positions
 *   - קפוא.xlsx (PLANOGRAM MAHSAN FORMULA) sheet "KAFU NEW" — products + מכר ממוצע
 */
const path    = require('path');
const fs      = require('fs');
const ExcelJS = require(path.join(__dirname, '..', 'server', 'node_modules', 'exceljs'));

const PLANOGRAM_DIR = 'C:/Users/d.sverdlik/Desktop/WORKSPACE/PLANOGRAM MAHSAN FORMULA';
const OUT_PATH      = path.join(__dirname, '..', 'docs', 'kapua-base.json');

// Excel col (1-based) → grid col (1-based, RTL: high c = screen-left)
const excelToGrid = c => c - 1;

// Excel row → planogram grid row (gaps become corridor rows)
// R2→1, R3-R6→2-5 (vertical col), R7→6, R8→7, corridor@8, R12→9, corridor@10, R15→11
const EXCEL_ROW_TO_GRID = { 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:7, 12:9, 15:11 };

// All 61 picks are working — no reserve zone in MAHSAN 8
const WORKING_SLOTS = 61;
const RESERVE_SLOTS = 0;
const RESERVE_START = 0;

(async () => {
  // ── Step 1: Extract pick → {r, c} positions from MAHSAN 8 sheet ─────────
  const wb8 = new ExcelJS.Workbook();
  await wb8.xlsx.readFile(path.join(PLANOGRAM_DIR, 'MAHSAN 8.xlsx'));
  const ws = wb8.getWorksheet('MAHSAN 8');

  const layout = {};

  for (const [excelRow, gridRow] of Object.entries(EXCEL_ROW_TO_GRID)) {
    const row = ws.getRow(Number(excelRow));
    for (let c = 1; c <= 22; c++) {
      const v = row.getCell(c).value;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 61) {
        layout[String(v)] = { r: gridRow, c: excelToGrid(c) };
      }
    }
  }

  console.log(`Layout: ${Object.keys(layout).length} positions`);

  const missing = [];
  for (let i = 1; i <= 61; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing picks:', missing.join(','));
  else console.log('✅ All 61 picks mapped');

  // ── Step 2: Read קפוא products ──────────────────────────────────────────
  const wbKapua = new ExcelJS.Workbook();
  await wbKapua.xlsx.readFile(path.join(PLANOGRAM_DIR, 'קפוא.xlsx'));
  const wsExport = wbKapua.getWorksheet('KAFU NEW');

  const hasSales = [];
  const noSales  = [];

  wsExport.eachRow((row, r) => {
    if (r === 1) return;
    const makat  = String(row.getCell(3).value || '').trim();  // col C
    const famRaw = String(row.getCell(2).value || '').trim();  // col B
    const active = row.getCell(6).value;                        // col F
    const mkr    = parseFloat(row.getCell(8).value || 0);      // col H מכר

    if (!makat || !active) return;

    const fam = famRaw.replace(/[‎‏‪-‮]/g, '').trim();

    if (mkr > 0) hasSales.push({ makat, fam });
    else         noSales.push({ makat, fam });
  });

  const sortByMakat = (a, b) => Number(a.makat) - Number(b.makat);
  hasSales.sort(sortByMakat);
  noSales.sort(sortByMakat);

  // All products: hasSales first, then noSales
  const allProds = [...hasSales, ...noSales];
  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length} | total: ${allProds.length}`);
  if (allProds.length > WORKING_SLOTS) console.warn(`⚠ ${allProds.length - WORKING_SLOTS} products won't fit in 61 slots!`);

  // ── Step 3: Assign products to picks ────────────────────────────────────
  const picks = {};
  for (let i = 1; i <= WORKING_SLOTS; i++) {
    const idx = i - 1;
    picks[String(i)] = idx < allProds.length
      ? { makat: allProds[idx].makat, fam: allProds[idx].fam, name: null }
      : null;
  }

  // ── Step 4: Write kapua-base.json ────────────────────────────────────────
  const result = {
    picks,
    layout,
    maxCols: 18,
    maxRows: 11,
    reserveStart: 0,
    v: `2026-05-14-kapua-new`
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary by row
  const rows = {};
  for (const [k, v] of Object.entries(layout)) {
    if (!rows[v.r]) rows[v.r] = [];
    rows[v.r].push(+k);
  }
  const labels = {1:'R2 working',2:'R3 col19',3:'R4 col19',4:'R5 col19',5:'R6 col19',6:'R7 working',7:'R8 working',9:'R12 working',11:'R15 RESERVE'};
  for (const r of Object.keys(rows).sort((a,b)=>+a-+b)) {
    const sorted = rows[r].sort((a,b)=>a-b);
    console.log(`  r:${r} [${labels[r]||'?'}]: picks ${sorted[0]}-${sorted[sorted.length-1]} (${sorted.length} slots)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
