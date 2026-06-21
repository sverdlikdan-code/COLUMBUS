/**
 * export-geocode-city-match-candidates.js — из "הצעה שונה מהותית" (big discrepancy)
 * отбирает только те, где город в ответе LocationIQ совпадает с городом клиента
 * (отсеивает шум — country-centroid fallback и ложные совпадения по названию
 * улицы в другом городе). Результат — отдельный файл для ручной проверки.
 * Источник: geocode-suggestions-<date>.xlsx
 * Запуск: node server/export-geocode-city-match-candidates.js
 */
const ExcelJS = require('exceljs');

function cityMatches(city, formatted) {
  const c = (city || '').trim();
  const f = (formatted || '');
  if (!c || !f || f.trim() === 'Israel') return false;
  const parts = c.split(/[\s-]+/).filter(p => p.length > 1);
  return parts.some(p => f.includes(p));
}

const today = new Date().toISOString().slice(0, 10);
const inPath = `C:\\Users\\d.sverdlik\\Desktop\\geocode-suggestions-${today}.xlsx`;

async function main() {
  console.log(`Reading: ${inPath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inPath);
  const ws = wb.worksheets[0];

  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const v = row.values;
    rows.push({
      custId: v[1], custName: v[2], city: v[3], address: v[4],
      garbageWhy: v[7],
      pbiLat: v[8], pbiLng: v[9],
      liqLat: v[10], liqLng: v[11], liqFormatted: v[12], liqType: v[13],
      distanceKm: v[14], verdict: v[15],
      agentCode: v[16], agentName: v[17],
    });
  });

  const candidates = rows
    .filter(r => r.verdict === 'הצעה שונה מהותית — לבדוק' && cityMatches(r.city, r.liqFormatted))
    .sort((a, b) => Number(b.distanceKm) - Number(a.distanceKm));

  console.log(`Кандидаты на проверку (город совпал): ${candidates.length}`);

  const out = new ExcelJS.Workbook();
  const wsOut = out.addWorksheet('Кандидаты на проверку');
  wsOut.views = [{ rightToLeft: true }];

  wsOut.columns = [
    { header: 'מס. לקוח',         key: 'custId',       width: 12 },
    { header: 'שם לקוח',          key: 'custName',     width: 32 },
    { header: 'עיר',              key: 'city',         width: 14 },
    { header: 'כתובת',            key: 'address',      width: 30 },
    { header: 'קו רוחב (נוכחי)',  key: 'pbiLat',       width: 14 },
    { header: 'קו אורך (נוכחי)',  key: 'pbiLng',       width: 14 },
    { header: 'קו רוחב (הצעה)',   key: 'liqLat',       width: 14 },
    { header: 'קו אורך (הצעה)',   key: 'liqLng',       width: 14 },
    { header: 'כתובת מפורמטת (LocationIQ)', key: 'liqFormatted', width: 50 },
    { header: 'מרחק (ק"מ)',       key: 'distanceKm',   width: 12 },
    { header: 'אישור',            key: 'approve',      width: 14 },
    { header: 'קוד סוכן',         key: 'agentCode',    width: 12 },
    { header: 'שם סוכן',          key: 'agentName',    width: 22 },
  ];

  wsOut.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  });
  wsOut.getRow(1).height = 24;

  for (const row of candidates) {
    const r = wsOut.addRow({ ...row, approve: '' });
    r.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
  }

  wsOut.autoFilter = { from: 'A1', to: `M${candidates.length + 1}` };
  wsOut.views[0].state = 'frozen';
  wsOut.views[0].ySplit = 1;

  const outPath = `C:\\Users\\d.sverdlik\\Desktop\\geocode-city-match-candidates-${today}.xlsx`;
  await out.xlsx.writeFile(outPath);
  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  Total rows: ${candidates.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
