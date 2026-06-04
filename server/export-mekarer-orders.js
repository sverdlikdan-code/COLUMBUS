/**
 * export-mekarer-orders.js — экспорт заказов מקרר в красивый Excel
 * Запуск: node server/export-mekarer-orders.js
 * Результат: Desktop/mekarer-orders-YYYY-MM-DD.xlsx
 */
const path = require('path');
const fs   = require('fs');
const ExcelJS = require('exceljs');

const ORDERS_PATH = path.join(__dirname, '..', 'docs', 'mekarer-orders.json');
const OUT_PATH    = `C:\\Users\\d.sverdlik\\Desktop\\mekarer-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;

// ── Hebrew labels ─────────────────────────────────────────────────────────────
const ACTION_LABEL = {
  'לספק':    'לספק',
  'להחליף':  'להחליף',
  'לאסוף':   'לאסוף',
  'לתקן':    'לתקן',
};

const LOC_LABEL = {
  'בפנים':   'בפנים',
  'בחוץ':    'בחוץ',
  'מחסן':    'מחסן',
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const BLUE_DARK  = 'FF0D47A1';
const BLUE       = 'FF1565C0';
const BLUE_LIGHT = 'FFE3F2FD';
const BLUE_MID   = 'FFBBDEFB';
const GREEN      = 'FF2E7D32';
const GREEN_LT   = 'FFE8F5E9';
const ORANGE     = 'FFE65100';
const ORANGE_LT  = 'FFFFF3E0';
const WHITE      = 'FFFFFFFF';
const GREY_LIGHT = 'FFF5F7FA';
const GREY_ROW   = 'FFEEF2F8';

function hCell(cell, text, opts = {}) {
  cell.value = text;
  cell.font  = { bold: true, color: { argb: opts.fontColor || WHITE }, size: opts.size || 11, name: 'Calibri' };
  cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg || BLUE_DARK } };
  cell.alignment = { horizontal: opts.align || 'center', vertical: 'middle', wrapText: !!opts.wrap };
  if (opts.border) {
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  }
}

function dCell(cell, text, opts = {}) {
  cell.value = text;
  cell.font  = { size: opts.size || 10, bold: !!opts.bold, color: { argb: opts.fontColor || 'FF1A1A2E' }, name: 'Calibri' };
  if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } };
  cell.alignment = { horizontal: opts.align || 'right', vertical: 'middle', wrapText: !!opts.wrap };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(ORDERS_PATH)) {
    console.error('mekarer-orders.json not found');
    process.exit(1);
  }
  const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  if (!orders.length) {
    console.log('No orders found.');
    process.exit(0);
  }

  console.log(`Found ${orders.length} order(s). Building Excel...`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'COLUMBUS';

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet('הזמנות מקרר', { views: [{ rightToLeft: true }] });

  // Title row
  ws.mergeCells('A1:L1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `הזמנות מקרר — FORMULA | ${fmtDate(new Date().toISOString())}`;
  titleCell.font  = { bold: true, size: 14, color: { argb: WHITE }, name: 'Calibri' };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_DARK } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Header row 2
  const COL_HEADERS = [
    { key: 'A', w: 6,  label: '#' },
    { key: 'B', w: 12, label: 'מס\' לקוח' },
    { key: 'C', w: 26, label: 'שם לקוח' },
    { key: 'D', w: 14, label: 'עיר' },
    { key: 'E', w: 18, label: 'שם סוכן' },
    { key: 'F', w: 14, label: 'מנהל' },
    { key: 'G', w: 16, label: 'איש קשר' },
    { key: 'H', w: 14, label: 'טלפון' },
    { key: 'I', w: 12, label: 'מיקום' },
    { key: 'J', w: 10, label: 'מס\' מקררים' },
    { key: 'K', w: 18, label: 'תאריך הגשה' },
    { key: 'L', w: 14, label: 'קוד סוכן' },
  ];
  COL_HEADERS.forEach(({ key, w, label }) => {
    ws.getColumn(key).width = w;
    hCell(ws.getCell(`${key}2`), label, { border: true });
  });
  ws.getRow(2).height = 22;

  // Data rows
  let rowIdx = 3;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const isEven = i % 2 === 0;
    const bg = isEven ? WHITE : GREY_ROW;
    const row = ws.getRow(rowIdx);
    row.height = 20;

    dCell(ws.getCell(`A${rowIdx}`), i + 1,       { align: 'center', bold: true, bg });
    dCell(ws.getCell(`B${rowIdx}`), o.custId,     { align: 'center', bg });
    dCell(ws.getCell(`C${rowIdx}`), o.custName,   { bold: true, bg });
    dCell(ws.getCell(`D${rowIdx}`), o.city,       { bg });
    dCell(ws.getCell(`E${rowIdx}`), o.agentName,  { bg });
    dCell(ws.getCell(`F${rowIdx}`), o.manager,    { bg });
    dCell(ws.getCell(`G${rowIdx}`), o.contactName,{ bg });
    dCell(ws.getCell(`H${rowIdx}`), o.phone,      { align: 'left', bg });
    dCell(ws.getCell(`I${rowIdx}`), o.location,   { align: 'center', bg });
    dCell(ws.getCell(`J${rowIdx}`), (o.mekarerim || []).length, { align: 'center', bold: true, bg });
    dCell(ws.getCell(`K${rowIdx}`), fmtDateTime(o.submittedAt), { align: 'center', bg });
    dCell(ws.getCell(`L${rowIdx}`), o.agentCode || '', { align: 'center', bg });

    rowIdx++;
  }

  ws.autoFilter  = { from: 'A2', to: `L${rowIdx - 1}` };
  ws.views[0].state  = 'frozen';
  ws.views[0].ySplit = 2;

  // ── Sheet 2: Detail (one row per מקרר unit) ──────────────────────────────
  const ws2 = wb.addWorksheet('פירוט מקררים', { views: [{ rightToLeft: true }] });

  ws2.mergeCells('A1:N1');
  const t2 = ws2.getCell('A1');
  t2.value = 'פירוט מקררים — כל שורה = מקרר אחד';
  t2.font  = { bold: true, size: 14, color: { argb: WHITE }, name: 'Calibri' };
  t2.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 30;

  const DETAIL_COLS = [
    { key: 'A', w: 5,  label: '#' },
    { key: 'B', w: 12, label: 'מס\' לקוח' },
    { key: 'C', w: 26, label: 'שם לקוח' },
    { key: 'D', w: 14, label: 'עיר' },
    { key: 'E', w: 18, label: 'שם סוכן' },
    { key: 'F', w: 14, label: 'מנהל' },
    { key: 'G', w: 16, label: 'איש קשר' },
    { key: 'H', w: 14, label: 'טלפון' },
    { key: 'I', w: 12, label: 'מיקום' },
    { key: 'J', w: 14, label: 'פעולה' },
    { key: 'K', w: 16, label: 'דגם לספק' },
    { key: 'L', w: 16, label: 'דגם לאסוף' },
    { key: 'M', w: 8,  label: 'שלות' },
    { key: 'N', w: 8,  label: 'עגלה' },
    { key: 'O', w: 16, label: 'תאריך אספקה' },
    { key: 'P', w: 22, label: 'תקלה / הערה' },
    { key: 'Q', w: 18, label: 'תאריך הגשה' },
  ];
  DETAIL_COLS.forEach(({ key, w, label }) => {
    ws2.getColumn(key).width = w;
    hCell(ws2.getCell(`${key}2`), label, { border: true });
  });
  ws2.getRow(2).height = 22;

  let dRow = 3;
  let unitIdx = 1;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const meks = o.mekarerim || [];
    for (let j = 0; j < meks.length; j++) {
      const m = meks[j];
      const bg = i % 2 === 0 ? WHITE : GREY_ROW;

      // Color action
      let actionBg = bg;
      if (m.action === 'לספק')   actionBg = GREEN_LT;
      if (m.action === 'לאסוף')  actionBg = ORANGE_LT;
      if (m.action === 'לתקן')   actionBg = 'FFFFF9C4';
      if (m.action === 'להחליף') actionBg = BLUE_LIGHT;

      dCell(ws2.getCell(`A${dRow}`), unitIdx,          { align: 'center', bold: true, bg });
      dCell(ws2.getCell(`B${dRow}`), o.custId,          { align: 'center', bg });
      dCell(ws2.getCell(`C${dRow}`), o.custName,        { bold: true, bg });
      dCell(ws2.getCell(`D${dRow}`), o.city,            { bg });
      dCell(ws2.getCell(`E${dRow}`), o.agentName,       { bg });
      dCell(ws2.getCell(`F${dRow}`), o.manager,         { bg });
      dCell(ws2.getCell(`G${dRow}`), o.contactName,     { bg });
      dCell(ws2.getCell(`H${dRow}`), o.phone,           { align: 'left', bg });
      dCell(ws2.getCell(`I${dRow}`), o.location,        { align: 'center', bg });
      dCell(ws2.getCell(`J${dRow}`), m.action || '',    { align: 'center', bold: true, bg: actionBg });
      dCell(ws2.getCell(`K${dRow}`), m.newModel || '',  { align: 'center', bg });
      dCell(ws2.getCell(`L${dRow}`), m.returnModel || '',{ align: 'center', bg });
      dCell(ws2.getCell(`M${dRow}`), m.salot ?? '',     { align: 'center', bold: true, bg });
      dCell(ws2.getCell(`N${dRow}`), m.agala ? 'כן' : 'לא', {
        align: 'center', bold: true,
        bg: m.agala ? GREEN_LT : bg,
        fontColor: m.agala ? GREEN : 'FF1A1A2E',
      });
      dCell(ws2.getCell(`O${dRow}`), fmtDate(m.supplyDate), { align: 'center', bg });
      dCell(ws2.getCell(`P${dRow}`), m.fault || '',     { bg, wrap: true });
      dCell(ws2.getCell(`Q${dRow}`), fmtDateTime(o.submittedAt), { align: 'center', bg });

      ws2.getRow(dRow).height = 20;
      dRow++;
      unitIdx++;
    }
  }

  ws2.autoFilter = { from: 'A2', to: `Q${dRow - 1}` };
  ws2.views[0].state  = 'frozen';
  ws2.views[0].ySplit = 2;

  // ── Save ──────────────────────────────────────────────────────────────────
  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`\n✓ Saved: ${OUT_PATH}`);
  console.log(`  📦 Total orders:        ${orders.length}`);
  const totalUnits = orders.reduce((s, o) => s + (o.mekarerim || []).length, 0);
  console.log(`  🧊 Total מקרר units:    ${totalUnits}`);

  // Summary by action
  const byAction = {};
  for (const o of orders) {
    for (const m of (o.mekarerim || [])) {
      byAction[m.action] = (byAction[m.action] || 0) + 1;
    }
  }
  for (const [action, cnt] of Object.entries(byAction)) {
    console.log(`     ${action}: ${cnt}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
