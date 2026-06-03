/**
 * restore-breira-default.js
 * Reads ברירת מחדל CSV files and restores correct pick positions
 * in halavi-base.json, dagim-base.json, dagim-yavesh-base.json.
 * Run ONCE to fix positions, then preserve-picks logic maintains them.
 */
const fs   = require('fs');
const path = require('path');

const CSV_DIR  = 'C:\\Users\\d.sverdlik\\Desktop\\WORKSPACE\\PLANOGRAM MAHSAN FORMULA';
const DOCS_DIR = path.join(__dirname, '..', 'docs');

const SECTIONS = [
  { csv: 'בררת מחדל  חלבי.csv',       base: 'halavi-base.json',       label: 'חלבי' },
  { csv: 'בררת מחדל  דגים.csv',        base: 'dagim-base.json',        label: 'דגים' },
  { csv: 'בררת מחדל DAG YAVESH.csv',   base: 'dagim-yavesh-base.json', label: 'דג יבש' },
];

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',');

  const bayIdx  = headers.indexOf('ביי');
  const makatIdx = headers.indexOf('מקט');
  const famIdx  = headers.indexOf('משפחה');
  const nameIdx = headers.indexOf('שם');

  if (bayIdx < 0 || makatIdx < 0) throw new Error(`Missing columns in ${filePath}: ${headers.join(',')}`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with commas
    const cols = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) || lines[i].split(',');
    const bay   = String(cols[bayIdx] || '').trim();
    const makat = String(cols[makatIdx] || '').replace(/"/g, '').trim();
    const fam   = famIdx >= 0 ? cols[famIdx]?.replace(/"/g, '').trim() : null;
    const name  = nameIdx >= 0 ? cols[nameIdx]?.replace(/"/g, '').trim() : null;
    if (!bay || !makat) continue;
    rows.push({ bay, makat, fam: fam || null, name: name || null });
  }
  return rows;
}

for (const { csv, base, label } of SECTIONS) {
  const csvPath  = path.join(CSV_DIR, csv);
  const basePath = path.join(DOCS_DIR, base);

  if (!fs.existsSync(csvPath))  { console.warn(`⚠ CSV not found: ${csv}`);  continue; }
  if (!fs.existsSync(basePath)) { console.warn(`⚠ Base not found: ${base}`); continue; }

  const rows    = parseCSV(csvPath);
  const baseJSON = JSON.parse(fs.readFileSync(basePath, 'utf8'));

  // Keep existing picks structure (all keys), but override with CSV positions
  const oldPicks = baseJSON.picks || {};
  const newPicks = {};

  // Copy all existing keys first (nulls etc)
  for (const [k, v] of Object.entries(oldPicks)) newPicks[k] = v;

  // Override with CSV data
  for (const row of rows) {
    newPicks[row.bay] = { makat: row.makat, fam: row.fam, name: row.name };
  }

  // Clear slots NOT in CSV (above max bay from CSV) that were previously filled
  const csvBays = new Set(rows.map(r => r.bay));
  const maxBay  = Math.max(...rows.map(r => Number(r.bay)));
  for (const k of Object.keys(newPicks)) {
    if (Number(k) <= maxBay && !csvBays.has(k)) newPicks[k] = null;
  }

  baseJSON.picks = newPicks;

  fs.writeFileSync(basePath, JSON.stringify(baseJSON, null, 2), 'utf8');
  console.log(`✅ ${label} (${base}): ${rows.length} positions restored from CSV`);
}

console.log('\nDone. Now commit the updated base JSONs.');
