/**
 * build-dagim-new.js
 * Builds dagim-base.json from:
 *   - MAHSAN 8.xlsx (PLANOGRAM MAHSAN FORMULA) — physical bay positions
 *   - דגים.xlsx (PLANOGRAM MAHSAN FORMULA/MAHSAN דגים) — products + מכר ממוצע
 */
const path    = require('path');
const fs      = require('fs');
const ExcelJS = require(path.join(__dirname, '..', 'server', 'node_modules', 'exceljs'));

const PLANOGRAM_DIR = 'C:/Users/d.sverdlik/Desktop/WORKSPACE/PLANOGRAM MAHSAN FORMULA';
const OUT_PATH      = path.join(__dirname, '..', 'docs', 'dagim-base.json');

// Excel col (1-based) → grid col (0-based, RTL: high c = screen-left)
const excelToGrid = c => c - 1;

// Grid row mapping: Excel row → planogram row
const EXCEL_ROW_TO_GRID = { 3:1, 7:3, 8:4, 10:6, 11:7, 13:9 };
// Passages: r:2, r:5, r:8 (empty rows between working/reserve zones)

(async () => {
  const wb8 = new ExcelJS.Workbook();
  await wb8.xlsx.readFile(path.join(PLANOGRAM_DIR, 'MAHSAN 8.xlsx'));
  const wsDagim = wb8.getWorksheet('MAHSAN דגים');

  // ── Step 1: Extract pick → {r, c} positions from Excel ──────────────────
  const layout = {};

  // Working rows: R7, R8, R10, R11
  for (const excelRow of [7, 8, 10, 11]) {
    const gridRow = EXCEL_ROW_TO_GRID[excelRow];
    const row = wsDagim.getRow(excelRow);
    for (let c = 1; c <= 31; c++) {
      const v = row.getCell(c).value;
      if (typeof v === 'number' && v >= 1 && v <= 97) {
        layout[String(v)] = { r: gridRow, c: excelToGrid(c) };
      }
    }
  }

  // Reserve rows
  // TOP RESERVE (R3): 12 bays — assign picks 98-109 at C14-C25
  for (let i = 0; i < 12; i++) {
    layout[String(98 + i)] = { r: 1, c: excelToGrid(14 + i) };
  }
  // BOTTOM LEFT (R13, screen-left = C24-C30): 7 bays → picks 110-116
  for (let i = 0; i < 7; i++) {
    layout[String(110 + i)] = { r: 9, c: excelToGrid(24 + i) };
  }
  // BOTTOM RIGHT (R13, screen-right = C3-C12): 10 bays → picks 117-126
  for (let i = 0; i < 10; i++) {
    layout[String(117 + i)] = { r: 9, c: excelToGrid(3 + i) };
  }

  console.log(`Layout: ${Object.keys(layout).length} positions`);

  // Verify working picks coverage
  const working = Object.keys(layout).map(Number).filter(p => p <= 97).sort((a,b)=>a-b);
  const missing = [];
  for (let i = 1; i <= 97; i++) if (!layout[String(i)]) missing.push(i);
  if (missing.length) console.warn('⚠ Missing working picks:', missing.join(','));
  else console.log('✅ All 97 working picks mapped');

  // ── Step 2: Read dagim products ─────────────────────────────────────────
  const wbDag = new ExcelJS.Workbook();
  await wbDag.xlsx.readFile(path.join(PLANOGRAM_DIR, 'MAHSAN דגים', 'דגים.xlsx'));
  const wsExport = wbDag.worksheets[0];

  const hasSales = [];  // products with מכר ממוצע > 0
  const noSales  = [];  // products without מכר ממוצע

  wsExport.eachRow((row, r) => {
    if (r === 1) return;
    const makat   = String(row.getCell(3).value || '').trim();
    const famRaw  = String(row.getCell(2).value || '').trim();
    const active  = row.getCell(6).value;
    const mkr     = parseFloat(row.getCell(8).value || 0); // מכר ממוצע ביום

    if (!makat || !active) return;

    // Clean RTL marks from family name
    const fam = famRaw.replace(/[‎‏‪-‮]/g, '').trim();

    if (mkr > 0) hasSales.push({ makat, fam });
    else         noSales.push({ makat, fam });
  });

  // Sort both groups by makat number
  const sortByMakat = (a, b) => Number(a.makat) - Number(b.makat);
  hasSales.sort(sortByMakat);
  noSales.sort(sortByMakat);

  console.log(`Products with sales: ${hasSales.length} | without: ${noSales.length}`);

  // ── Step 3: Assign products to picks ────────────────────────────────────
  const picks = {};
  const workingSlots  = 97;
  const reserveSlots  = 29; // 12 + 7 + 10
  const totalSlots    = workingSlots + reserveSlots; // 126

  // Fill working picks 1-97 with sales products, then null for empty slots
  for (let i = 1; i <= workingSlots; i++) {
    const idx = i - 1;
    picks[String(i)] = idx < hasSales.length
      ? { makat: hasSales[idx].makat, fam: hasSales[idx].fam, name: null }
      : null;
  }

  // Fill reserve picks 98-126 with no-sales products, then null
  for (let i = 0; i < reserveSlots; i++) {
    const pick = workingSlots + 1 + i;
    picks[String(pick)] = i < noSales.length
      ? { makat: noSales[i].makat, fam: noSales[i].fam, name: null }
      : null;
  }

  console.log(`Working slots used: ${Math.min(hasSales.length, workingSlots)}/${workingSlots}`);
  console.log(`Reserve slots used: ${Math.min(noSales.length, reserveSlots)}/${reserveSlots}`);
  if (hasSales.length > workingSlots) console.warn(`⚠ ${hasSales.length - workingSlots} sales products won't fit!`);
  if (noSales.length > reserveSlots)  console.warn(`⚠ ${noSales.length - reserveSlots} no-sales products won't fit in reserve!`);

  // ── Step 4: Write dagim-base.json ────────────────────────────────────────
  const result = {
    picks,
    layout,
    maxCols: 29,
    maxRows: 9,
    reserveStart: 98,
    v: `2026-05-14-dagim-new`
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Written: ${OUT_PATH}`);

  // Summary by row
  const rows = {};
  for (const [k, v] of Object.entries(layout)) {
    if (!rows[v.r]) rows[v.r] = 0;
    rows[v.r]++;
  }
  const labels = {1:'TOP RESERVE', 3:'Working R7', 4:'Working R8', 6:'Working R10', 7:'Working R11', 9:'BOTTOM RESERVE'};
  for (const r of Object.keys(rows).sort((a,b)=>+a-+b)) {
    console.log(`  r:${r} [${labels[r]||'?'}]: ${rows[r]} slots`);
  }
})().catch(e => { console.error(e); process.exit(1); });
