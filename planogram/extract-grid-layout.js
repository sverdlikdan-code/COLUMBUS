/**
 * extract-grid-layout.js
 * Reads MAHSAN 8.xlsx and outputs pick→{row,col} for all 3 sheets.
 * Run: node extract-grid-layout.js
 */
const ExcelJS = require('exceljs');

async function extractSheet(ws, sheetName) {
  const picks = {};
  ws.eachRow((row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 200) {
        picks[v] = { row: r, col: c };
      }
    });
  });
  const sorted = Object.entries(picks)
    .map(([p, pos]) => ({ pick: parseInt(p), row: pos.row, col: pos.col }))
    .sort((a, b) => a.pick - b.pick);

  console.log(`\n=== ${sheetName} — ${sorted.length} picks ===`);
  // Print grid summary: unique rows and cols
  const rows = [...new Set(sorted.map(x => x.row))].sort((a,b)=>a-b);
  const cols = [...new Set(sorted.map(x => x.col))].sort((a,b)=>a-b);
  console.log(`Rows: ${rows.join(', ')}`);
  console.log(`Cols: ${cols.join(', ')}`);
  console.log(`Pick layout (pick: row,col):`);
  sorted.forEach(x => console.log(`  #${x.pick}: row=${x.row} col=${x.col}`));
  return sorted;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('MAHSAN 8.xlsx');

  const data = {};
  for (const ws of wb.worksheets) {
    if (ws.name.includes('MAHSAN') || ws.name === 'MAHSAN 8') {
      data[ws.name] = await extractSheet(ws, ws.name);
    }
  }

  // Output JSON for embedding in editor
  const fs = require('fs');
  fs.writeFileSync('grid-layout.json', JSON.stringify(data, null, 2), 'utf8');
  console.log('\n✅ grid-layout.json written');
}

main().catch(e => { console.error(e); process.exit(1); });
