/**
 * loader.js — reads FOR-ALL.xlsx (ברברת מחדל FOR-ALL)
 * Returns { bay → { makat, fam, name, printOrder, haluka } } for a given section.
 * Section names: 'קפוא' | 'חלבי' | 'דגים' | 'דג יבש'
 * Falls back to FOR-ALL.csv if xlsx is not available.
 */
const fs   = require('fs');
const path = require('path');

const XLSX_FILE = path.join(__dirname, 'FOR-ALL.xlsx');
const CSV_FILE  = path.join(__dirname, 'FOR-ALL.csv');

function loadBreiraDefault(sectionName) {
  // Prefer xlsx (no manual CSV export needed)
  if (fs.existsSync(XLSX_FILE)) {
    return _loadFromXlsx(sectionName);
  }
  return _loadFromCsv(sectionName);
}

function _parseEntry(headers, vals) {
  const get = (col) => {
    const i = headers.indexOf(col);
    return i >= 0 ? String(vals[i] ?? '').trim() : '';
  };
  const toNum = (s) => (s !== '' && !isNaN(Number(s))) ? Number(s) : null;
  return {
    mahlaka:    get('מחלקה'),
    bay:        get('בי'),
    makat:      get('מקט'),
    name:       get('שם') || null,
    fam:        get('משפחה') || null,
    printOrder: toNum(get('סדר הדפסה')),
    haluka:     toNum(get('חלוקה')),
  };
}

function _loadFromXlsx(sectionName) {
  const XLSX = require('xlsx');
  const wb   = XLSX.readFile(XLSX_FILE);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) throw new Error('FOR-ALL.xlsx is empty');
  const headers = rows[0].map(h => String(h).trim());
  const result  = {};
  for (let i = 1; i < rows.length; i++) {
    const e = _parseEntry(headers, rows[i]);
    if (e.mahlaka !== sectionName || !e.bay || !e.makat) continue;
    result[e.bay] = { makat: e.makat, fam: e.fam, name: e.name, printOrder: e.printOrder, haluka: e.haluka };
  }
  return result;
}

function _loadFromCsv(sectionName) {
  const raw   = fs.readFileSync(CSV_FILE, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim());
  if (!lines.length) throw new Error('FOR-ALL.csv is empty');
  const headers = lines[0].split(',').map(h => h.trim());
  const result  = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const e    = _parseEntry(headers, cols);
    if (e.mahlaka !== sectionName || !e.bay || !e.makat) continue;
    result[e.bay] = { makat: e.makat, fam: e.fam, name: e.name, printOrder: e.printOrder, haluka: e.haluka };
  }
  return result;
}

module.exports = { loadBreiraDefault };
