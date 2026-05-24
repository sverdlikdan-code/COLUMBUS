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
  const matzatiCol  = headers.indexOf('מצאתי יותר מדויק') + 1;
  const statusCol   = headers.indexOf('סטטוס') + 1;
  console.log(`Quality cols: matzati=${matzatiCol}, status=${statusCol}`);

  let count = 0, skipped = 0;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const id      = String(row.getCell(idCol).value  || '').trim();
    const lat     = Number(row.getCell(latCol).value);
    const lng     = Number(row.getCell(lngCol).value);
    const matzati = String(row.getCell(matzatiCol).value || '').trim();
    const status  = String(row.getCell(statusCol).value  || '').trim();

    if (!id || !lat || !lng || isNaN(lat) || isNaN(lng)) { skipped++; return; }
    if (lat < 29 || lat > 34 || lng < 34 || lng > 36) { skipped++; return; }

    // Only include entries that were ACTUALLY geocoded/improved (not just "kept as-is" from PBI)
    // "✅ קיים במקור" = original PBI data unchanged → skip (PBI already has it)
    // "כן" + "✅ נמצא" = manually confirmed geocoded address → include
    if (status === '✅ קיים במקור') { skipped++; return; }
    if (!status.startsWith('✅')) { skipped++; return; }

    lookup[id] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    count++;
  });

  const outPath = path.join(__dirname, '../docs/gps-lookup.json');
  fs.writeFileSync(outPath, JSON.stringify(lookup));
  console.log(`✅ Saved ${count} entries → docs/gps-lookup.json  (skipped: ${skipped})`);
}

main().catch(e => { console.error(e); process.exit(1); });
