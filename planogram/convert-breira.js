/**
 * convert-breira.js — converts בררת מחדל FOR ALL.xlsx → FOR-ALL.csv
 * Run automatically by GitHub Actions before build scripts.
 * Also runnable manually: node planogram/convert-breira.js
 */
const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const XLSX = path.join(__dirname, 'breira-default', 'FOR-ALL.xlsx');
const CSV  = path.join(__dirname, 'breira-default', 'FOR-ALL.csv');

(async () => {
  if (!fs.existsSync(XLSX)) {
    console.warn('⚠ FOR-ALL.xlsx not found, skipping conversion');
    process.exit(0);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, n) => {
    if (n < 2) return;
    const cells = [];
    row.eachCell({ includeEmpty: true }, c => {
      const v = c.value === null || c.value === undefined ? '' : String(c.value);
      cells.push(v.includes(',') || v.includes('"') ? `"${v.replace(/"/g,'""')}"` : v);
    });
    rows.push(cells.join(','));
  });
  fs.writeFileSync(CSV, rows.join('\n'), 'utf8');
  console.log(`✅ FOR-ALL.csv updated: ${rows.length - 1} products`);
})().catch(e => { console.error(e); process.exit(1); });
