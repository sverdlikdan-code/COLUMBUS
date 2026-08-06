// fetch-sadran-data.js — заменяет ручной SADRAN.xlsx прямым DAX-запросом к FORMULA PBI.
// Период: YTD (1 января текущего года) → конец последнего ПОЛНОСТЬЮ завершённого месяца,
// год к году (тот же период год назад). Вычисляется динамически на момент запуска —
// поэтому скрипт даёт корректные цифры при любом запуске, не только в начале месяца.
//
// Источники:
//   ALL_PARTS                — транзакции: תאריך (дата), סכום (ש'ח) (сумма), מספר לקוח (клиент),
//                              מק'ט (SKU). Найдено эмпирически 2026-07-27 (см. project memory).
//   ADIFUT                   — SKU -> מחלקה (департамент), для классификации FORMULA/INTER/ICE MISH/ICE BDD.
//   'לקוחות FORM+I+INT'      — клиент -> עיר/כשרות/שם סדרן/תאור סוג לקוח.
//
// Output: JSON-кэш scripts/sadran_fetch_cache.json (gitignored, см. scripts/*_dump.json правило) —
// sadran-data.js's loadRows() читает его вместо SADRAN.xlsx, если он свежий.
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { executeDax } = require('../server/powerbi');

// --- период: YTD текущего года -> конец последнего завершённого месяца, год к году ---
function computePeriods(today = new Date()) {
  const y = today.getFullYear();
  // "последний завершённый месяц" — если сегодня внутри месяца X, последний завершённый = X-1.
  const lastCompleteMonthEndExclusive = new Date(today.getFullYear(), today.getMonth(), 1); // 1-е число текущего месяца = конец диапазона (exclusive)
  const nowStart = new Date(y, 0, 1);
  const nowEndExclusive = lastCompleteMonthEndExclusive;
  const lyStart = new Date(y - 1, 0, 1);
  const lyEndExclusive = new Date(y - 1, lastCompleteMonthEndExclusive.getMonth(), lastCompleteMonthEndExclusive.getDate());
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    now: { start: fmt(nowStart), endExclusive: fmt(nowEndExclusive) },
    lastYear: { start: fmt(lyStart), endExclusive: fmt(lyEndExclusive) },
  };
}

function daxDate(iso) {
  const [y, m, d] = iso.split('-');
  return `DATE(${y},${m},${d})`;
}

async function fetchSalesForPeriod(startIso, endExclusiveIso) {
  const q = `EVALUATE
SUMMARIZECOLUMNS(
  ALL_PARTS[מספר לקוח],
  ALL_PARTS[מק'ט],
  FILTER(ALL_PARTS, ALL_PARTS[תאריך] >= ${daxDate(startIso)} && ALL_PARTS[תאריך] < ${daxDate(endExclusiveIso)}),
  "amt", SUM(ALL_PARTS[סכום (ש'ח)])
)`;
  return executeDax(q);
}

async function fetchProductDept() {
  const rows = await executeDax(`EVALUATE SELECTCOLUMNS(ADIFUT, "makat", ADIFUT[מק"ט], "dept", ADIFUT[מחלקה])`);
  const map = new Map();
  for (const r of rows) map.set(String(r['[makat]']).trim(), (r['[dept]'] || '').trim());
  return map;
}

async function fetchCustomerDims() {
  const rows = await executeDax(`EVALUATE SELECTCOLUMNS('לקוחות FORM+I+INT',
    "custno", 'לקוחות FORM+I+INT'[מס. לקוח],
    "custname", 'לקוחות FORM+I+INT'[שם לקוח],
    "city", 'לקוחות FORM+I+INT'[עיר],
    "kosher", 'לקוחות FORM+I+INT'[כשרות],
    "sadran", 'לקוחות FORM+I+INT'[שם סדרן],
    "custtype", 'לקוחות FORM+I+INT'[תאור סוג לקוח]
  )`);
  const map = new Map();
  for (const r of rows) {
    map.set(String(r['[custno]']).trim(), {
      custname: r['[custname]'] || '',
      city: r['[city]'] || '',
      kosher: r['[kosher]'] || '(не указано)',
      sadran: r['[sadran]'] || '',
      custtype: r['[custtype]'] || '(нет в PBI)',
    });
  }
  return map;
}

async function main() {
  const periods = computePeriods();
  console.log('Периоды:', JSON.stringify(periods, null, 2));

  console.log('Тяну справочники (клиенты, SKU->департамент)...');
  const [productDept, custDims] = await Promise.all([fetchProductDept(), fetchCustomerDims()]);
  console.log(`  SKU->dept: ${productDept.size}, клиентов: ${custDims.size}`);

  console.log('Тяну продажи (now period)...');
  const nowRows = await fetchSalesForPeriod(periods.now.start, periods.now.endExclusive);
  console.log(`  строк: ${nowRows.length}`);

  console.log('Тяну продажи (last year period)...');
  const lyRows = await fetchSalesForPeriod(periods.lastYear.start, periods.lastYear.endExclusive);
  console.log(`  строк: ${lyRows.length}`);

  // Агрегируем в JS до custno+dept (SKU-> dept через ADIFUT lookup)
  function aggregate(daxRows) {
    const agg = new Map(); // custno|dept -> amt
    let unmatchedSku = 0;
    for (const r of daxRows) {
      const custno = String(r["[מספר לקוח]"]).trim();
      const makat = String(r["[מק'ט]"]).trim();
      const amt = r['[amt]'] || 0;
      const dept = productDept.get(makat);
      if (!dept) { unmatchedSku++; continue; }
      const key = `${custno}|${dept}`;
      agg.set(key, (agg.get(key) || 0) + amt);
    }
    return { agg, unmatchedSku };
  }
  const { agg: nowAgg, unmatchedSku: nowUnmatched } = aggregate(nowRows);
  const { agg: lyAgg, unmatchedSku: lyUnmatched } = aggregate(lyRows);
  console.log(`  SKU без department (now/ly): ${nowUnmatched}/${lyUnmatched} строк пропущено`);

  const allKeys = new Set([...nowAgg.keys(), ...lyAgg.keys()]);
  const outRows = [];
  let missingCustDim = 0;
  for (const key of allKeys) {
    const [custno, dept] = key.split('|');
    const dim = custDims.get(custno);
    if (!dim) { missingCustDim++; continue; }
    outRows.push({
      kosher: dim.kosher,
      city: dim.city,
      custno,
      custname: dim.custname,
      sadran: dim.sadran,
      dept,
      custtype: dim.custtype,
      lastYear: lyAgg.get(key) || 0,
      now: nowAgg.get(key) || 0,
    });
  }
  console.log(`  клиентов без dim (пропущено): ${missingCustDim}`);
  console.log(`  итоговых строк: ${outRows.length}`);

  const totalNow = outRows.reduce((s, r) => s + r.now, 0);
  const totalLY = outRows.reduce((s, r) => s + r.lastYear, 0);
  console.log(`\nИтого: LY=${Math.round(totalLY).toLocaleString('en-US')}, NOW=${Math.round(totalNow).toLocaleString('en-US')}, % change=${((totalNow / totalLY - 1) * 100).toFixed(1)}%`);

  const outPath = path.join(__dirname, 'sadran_fetch_cache.json');
  fs.writeFileSync(outPath, JSON.stringify({ periods, fetchedAt: new Date().toISOString(), rows: outRows }));
  console.log('Сохранено:', outPath);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
