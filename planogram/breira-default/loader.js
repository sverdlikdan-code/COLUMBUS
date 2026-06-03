/**
 * loader.js — reads בררת מחדל FOR ALL.xlsx
 * Returns { bay → { makat, fam, name } } for a given section name.
 * Section names: 'קפוא' | 'חלבי' | 'דגים' | 'דג יבש'
 */
const ExcelJS = require('exceljs');
const path    = require('path');

const FILE = path.join(__dirname, 'FOR-ALL.xlsx');

async function loadBreiraDefault(sectionName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  // Row 2 = headers
  const cols = {};
  ws.getRow(2).eachCell((cell, colIdx) => {
    const v = String(cell.value || '').trim();
    if (v) cols[v] = colIdx;
  });

  const required = ['מחלקה', 'בי', 'מקט'];
  for (const c of required) {
    if (!cols[c]) throw new Error(`Column '${c}' not found in FOR-ALL.xlsx`);
  }

  const result = {}; // bay → { makat, fam, name }
  ws.eachRow((row, n) => {
    if (n <= 2) return;
    const mahlaka = String(row.getCell(cols['מחלקה']).value || '').trim();
    if (mahlaka !== sectionName) return;
    const bay   = String(row.getCell(cols['בי']).value || '').trim();
    const makat = String(row.getCell(cols['מקט']).value || '').trim();
    const fam   = cols['משפחה'] ? String(row.getCell(cols['משפחה']).value || '').trim() || null : null;
    const name  = cols['שם']    ? String(row.getCell(cols['שם']).value    || '').trim() || null : null;
    if (bay && makat) result[bay] = { makat, fam, name };
  });

  return result;
}

module.exports = { loadBreiraDefault };
