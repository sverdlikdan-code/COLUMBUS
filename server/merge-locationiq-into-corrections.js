/**
 * merge-locationiq-into-corrections.js — заливает результаты LocationIQ-прогона
 * (geocode-suggestions + geocode-city-match-candidates) в docs/gps-corrections.json
 * для теста новых координат в Formula Road.
 *
 * Категории, которые заливаем:
 *   1. הצעה חדשה (אין נקודת ייחוס)   — новый клиент, не было точки для сравнения
 *   2. הצעה תואמת/קרובה              — LocationIQ совпал с текущей точкой (<2км)
 *   3. geocode-city-match-candidates  — проверенные кандидаты из "большое расхождение",
 *      где город в ответе LocationIQ совпал с городом клиента
 *
 * Существующие ручные правки (более свежие, сделанные через 📍 в приложении)
 * НЕ перезатираются — при конфликте custId оставляем то, что новее по correctedAt.
 *
 * Запуск: node server/merge-locationiq-into-corrections.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const today = new Date().toISOString().slice(0, 10);
const suggestionsPath = `C:\\Users\\d.sverdlik\\Desktop\\geocode-suggestions-${today}.xlsx`;
const candidatesPath = `C:\\Users\\d.sverdlik\\Desktop\\geocode-city-match-candidates-${today}.xlsx`;
const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

async function readSuggestions() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(suggestionsPath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const v = row.values;
    rows.push({
      custId: String(v[1] ?? ''), custName: v[2] ?? '', city: v[3] ?? '', address: v[4] ?? '',
      lat: v[10], lng: v[11], verdict: v[15],
    });
  });
  return rows.filter(r =>
    (r.verdict === 'הצעה חדשה (אין נקודת ייחוס)' || r.verdict === 'הצעה תואמת/קרובה')
    && isValidIL(r.lat, r.lng)
  );
}

async function readCandidates() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(candidatesPath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const v = row.values;
    rows.push({
      custId: String(v[1] ?? ''), custName: v[2] ?? '', city: v[3] ?? '', address: v[4] ?? '',
      lat: v[7], lng: v[8],
    });
  });
  return rows.filter(r => isValidIL(r.lat, r.lng));
}

async function main() {
  const corrections = JSON.parse(fs.readFileSync(corrPath, 'utf8'));
  const before = Object.keys(corrections).length;

  const [suggestions, candidates] = await Promise.all([readSuggestions(), readCandidates()]);
  console.log(`Из geocode-suggestions: ${suggestions.length}`);
  console.log(`Из city-match-candidates: ${candidates.length}`);

  const nowIso = new Date().toISOString();
  let added = 0, skippedExisting = 0;

  for (const r of [...suggestions, ...candidates]) {
    const existing = corrections[r.custId];
    if (existing) { skippedExisting++; continue; } // ручные правки не трогаем
    corrections[r.custId] = {
      lat: r.lat, lng: r.lng,
      correctedAt: nowIso,
      name: r.custName, city: r.city, address: r.address,
      source: 'locationiq-test',
    };
    added++;
  }

  fs.writeFileSync(corrPath, JSON.stringify(corrections, null, 2), 'utf8');
  console.log(`\nБыло записей: ${before}`);
  console.log(`Добавлено новых: ${added}`);
  console.log(`Пропущено (уже есть ручная правка): ${skippedExisting}`);
  console.log(`Стало записей: ${Object.keys(corrections).length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
