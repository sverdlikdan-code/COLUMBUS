/**
 * sync-breira-only.js
 * One-time sync: FOR-ALL.xlsx → *-base.json (printOrder + haluka only)
 * No PBI queries. Run: node planogram/sync-breira-only.js
 */
const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');

const XLSX_FILE = path.join(__dirname, 'breira-default', 'FOR-ALL.xlsx');
const DOCS_DIR  = path.join(__dirname, '..', 'docs');

const SECTION_FILES = {
  'קפוא':    'kapua-base.json',
  'חלבי':    'halavi-base.json',
  'דגים':    'dagim-base.json',
  'דג יבש': 'dagim-yavesh-base.json',
};

const wb      = XLSX.readFile(XLSX_FILE);
const ws      = wb.Sheets[wb.SheetNames[0]];
const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headers = allRows[0].map(h => String(h).trim());

const idx = (col) => headers.indexOf(col);
const iMahlaka    = idx('מחלקה');
const iPrintOrder = idx('סדר הדפסה');
const iBay        = idx('בי');
const iMakat      = idx('מקט');
const iHaluka     = idx('חלוקה');

// Group XLSX rows by section → { bay → { printOrder, haluka, makat } }
const bySection = {};
for (let i = 1; i < allRows.length; i++) {
  const row  = allRows[i];
  const sec  = String(row[iMahlaka] || '').trim();
  const bay  = String(row[iBay]     || '').trim();
  const mk   = String(row[iMakat]   || '').trim();
  const po   = row[iPrintOrder] !== '' && !isNaN(Number(row[iPrintOrder])) ? Number(row[iPrintOrder]) : null;
  const hal  = row[iHaluka]     !== '' && !isNaN(Number(row[iHaluka]))     ? Number(row[iHaluka])     : null;
  if (!sec || !bay) continue;
  if (!bySection[sec]) bySection[sec] = {};
  bySection[sec][bay] = { printOrder: po, haluka: hal, makat: mk };
}

let totalUpdated = 0;

for (const [section, jsonFile] of Object.entries(SECTION_FILES)) {
  const fullPath = path.join(DOCS_DIR, jsonFile);
  if (!fs.existsSync(fullPath)) { console.log(`  SKIP ${jsonFile} — not found`); continue; }

  const data  = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const picks = data.picks;
  if (!picks) { console.log(`  SKIP ${jsonFile} — no picks`); continue; }

  const sectionData = bySection[section] || {};
  let updated = 0;

  for (const [bay, entry] of Object.entries(sectionData)) {
    if (!picks[bay]) continue;
    const p = picks[bay];
    if (entry.printOrder !== null && p.printOrder !== entry.printOrder) {
      p.printOrder = entry.printOrder;
      updated++;
    }
    if (entry.haluka !== null && p.haluka !== entry.haluka) {
      p.haluka = entry.haluka;
      updated++;
    }
  }

  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✅ ${jsonFile}: ${updated} fields updated`);
  totalUpdated += updated;
}

console.log(`\nDone. Total fields updated: ${totalUpdated}`);
console.log('Run next: node planogram/build-planogram.js');
