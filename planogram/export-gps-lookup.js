// export-gps-lookup.js — run once locally to generate docs/gps-lookup.json
// from EXEL COORDINATES.xlsx (manually curated GPS for ~7132 clients)
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '../EXEL COORDINATES.xlsx'));

  const ws = wb.getWorksheet('276');
  if (!ws) { console.error('Sheet "276" not found'); process.exit(1); }

  // Detect header row
  const headers = [];
  ws.getRow(1).eachCell(cell => headers.push(cell.value));
  const idCol  = headers.indexOf('מס. לקוח') + 1;
  const latCol = headers.indexOf('קו רוחב') + 1;
  const lngCol = headers.indexOf('קו אורך') + 1;
  console.log(`Columns: id=${idCol}, lat=${latCol}, lng=${lngCol}`);

  const lookup = {};
  let count = 0, skipped = 0;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const id  = String(row.getCell(idCol).value  || '').trim();
    const lat = Number(row.getCell(latCol).value);
    const lng = Number(row.getCell(lngCol).value);
    if (!id || !lat || !lng || isNaN(lat) || isNaN(lng)) { skipped++; return; }
    // Basic Israel sanity check
    if (lat < 29 || lat > 34 || lng < 34 || lng > 36) { skipped++; return; }
    lookup[id] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    count++;
  });

  const outPath = path.join(__dirname, '../docs/gps-lookup.json');
  fs.writeFileSync(outPath, JSON.stringify(lookup));
  console.log(`✅ Saved ${count} entries → docs/gps-lookup.json  (skipped: ${skipped})`);
}

main().catch(e => { console.error(e); process.exit(1); });
