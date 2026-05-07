// Beautify EXEL COORDINATES.xlsx — styled version with colors, freeze, autofilter
// Run: node gps-beautify.js

const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const path = require('path');

const srcFile = path.resolve(__dirname, '..', 'EXEL COORDINATES.xlsx');
const outFile = path.resolve(__dirname, '..', 'EXEL COORDINATES.xlsx');

// ── Color scheme ───────────────────────────────────────────────────────────
const COLORS = {
  headerBg:   '1F4E79',  // dark blue
  headerFg:   'FFFFFF',  // white
  ken:        'E2EFDA',  // light green  — כן / חדש
  lo:         'FCE4D6',  // light red    — שגוי / לא
  ulay:       'FFF2CC',  // light yellow — אולי
  dash:       'F2F2F2',  // light grey   — קיים / —
  rowAlt:     'FAFAFA',  // very light   — alternating
  border:     'D0D0D0',  // border color
};

function rowColor(imp) {
  const v = String(imp || '');
  if (v === 'כן')   return COLORS.ken;
  if (v === '—')    return COLORS.dash;
  if (v === 'אולי') return COLORS.ulay;
  if (v === 'שגוי' || v === 'לא') return COLORS.lo;
  return null;
}

function importRowColor(matzav) {
  const v = String(matzav || '');
  if (v === 'חדש')  return COLORS.ken;
  if (v === 'קיים') return COLORS.dash;
  if (v === 'אולי') return COLORS.ulay;
  return null;
}

function applyHeader(row, bgColor) {
  row.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgColor } };
    cell.font   = { bold: true, color: { argb: 'FF' + COLORS.headerFg }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF' + COLORS.border } },
    };
  });
}

function applyDataRow(row, bgHex) {
  if (!bgHex) return;
  row.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgHex } };
    cell.alignment = { vertical: 'middle' };
  });
}

async function main() {
  // Read data from existing xlsx
  const srcWb = XLSX.readFile(srcFile);

  const finalRows  = XLSX.utils.sheet_to_json(srcWb.Sheets['FINAL']);
  const importRows = XLSX.utils.sheet_to_json(srcWb.Sheets['לייבוא לפריוריטי']);
  const sheet1Rows = XLSX.utils.sheet_to_json(srcWb.Sheets['Sheet1'], { header: 1 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'COLUMBUS GPS';
  wb.created = new Date();

  // ── Sheet 1: FINAL ────────────────────────────────────────────────────────
  const wsFinal = wb.addWorksheet('FINAL', { views: [{ state: 'frozen', ySplit: 1 }] });

  const finalCols = [
    { header: 'מס. לקוח',          key: 'מס. לקוח',          width: 13 },
    { header: 'שם לקוח',           key: 'שם לקוח',           width: 30 },
    { header: 'עיר',               key: 'עיר',               width: 16 },
    { header: 'כתובת מקורית',      key: 'כתובת מקורית',      width: 36 },
    { header: 'כתובת לחיפוש',      key: 'כתובת לחיפוש',      width: 28 },
    { header: 'מצאתי יותר מדויק',  key: 'מצאתי יותר מדויק',  width: 14 },
    { header: 'קו רוחב',           key: 'קו רוחב',           width: 14 },
    { header: 'קו אורך',           key: 'קו אורך',           width: 14 },
    { header: 'קו רוחב מקורי',     key: 'קו רוחב מקורי',     width: 14 },
    { header: 'קו אורך מקורי',     key: 'קו אורך מקורי',     width: 14 },
    { header: 'עיר שנמצאה',        key: 'עיר שנמצאה',        width: 18 },
    { header: 'סטטוס',             key: 'סטטוס',             width: 30 },
  ];
  wsFinal.columns = finalCols;
  applyHeader(wsFinal.getRow(1), COLORS.headerBg);
  wsFinal.autoFilter = { from: 'A1', to: 'L1' };

  for (const r of finalRows) {
    const row = wsFinal.addRow(r);
    const color = rowColor(r['מצאתי יותר מדויק']);
    applyDataRow(row, color);
    row.height = 18;
  }
  wsFinal.getRow(1).height = 22;

  // ── Sheet 2: לייבוא לפריוריטי ─────────────────────────────────────────────
  const wsImport = wb.addWorksheet('לייבוא לפריוריטי', { views: [{ state: 'frozen', ySplit: 1 }] });

  const importCols = [
    { header: 'מס. לקוח',   key: 'מס. לקוח',   width: 13 },
    { header: 'שם לקוח',    key: 'שם לקוח',    width: 30 },
    { header: 'עיר',        key: 'עיר',        width: 16 },
    { header: 'כתובת',      key: 'כתובת',      width: 36 },
    { header: 'קו רוחב',    key: 'קו רוחב',    width: 16 },
    { header: 'קו אורך',    key: 'קו אורך',    width: 16 },
    { header: 'מצב',        key: 'מצב',        width: 9  },
    { header: 'עיר שנמצאה', key: 'עיר שנמצאה', width: 18 },
  ];
  wsImport.columns = importCols;
  applyHeader(wsImport.getRow(1), COLORS.headerBg);
  wsImport.autoFilter = { from: 'A1', to: 'H1' };

  for (const r of importRows) {
    const row = wsImport.addRow(r);
    const color = importRowColor(r['מצב']);
    applyDataRow(row, color);
    row.height = 18;
  }
  wsImport.getRow(1).height = 22;

  // ── Sheet 3: Sheet1 (original data — keep as-is) ─────────────────────────
  const wsOrig = wb.addWorksheet('Sheet1', { views: [{ state: 'frozen', ySplit: 1 }] });
  if (sheet1Rows.length > 0) {
    const headers = sheet1Rows[0];
    wsOrig.addRow(headers);
    applyHeader(wsOrig.getRow(1), '4472C4'); // blue
    for (let i = 1; i < sheet1Rows.length; i++) {
      const row = wsOrig.addRow(sheet1Rows[i]);
      if (i % 2 === 0) applyDataRow(row, COLORS.rowAlt);
      row.height = 18;
    }
    wsOrig.getRow(1).height = 22;
    // Auto width
    headers.forEach((_, ci) => { wsOrig.getColumn(ci + 1).width = 16; });
  }

  await wb.xlsx.writeFile(outFile);

  console.log('✅ Красивый Excel сохранён!');
  console.log('  FINAL:              ' + finalRows.length + ' строк');
  console.log('  לייבוא לפריוריטי:  ' + importRows.length + ' строк');
  console.log('  Цвета: зелёный=כן, красный=שגוי/לא, жёлтый=אולי, серый=קיים');
}

main().catch(console.error);
