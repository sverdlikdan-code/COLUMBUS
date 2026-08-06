// fetch-sadran-data.js — заменяет ручной SADRAN.xlsx прямым DAX-запросом к FORMULA PBI.
//
// Период: YTD (1 января текущего года) → конец последнего ПОЛНОСТЬЮ завершённого месяца,
// год к году (тот же период год назад). Вычисляется динамически на момент запуска.
//
// Источники (найдено эмпирически 2026-08-05/06, см. project memory):
//   ALL_PARTS                — транзакции: תאריך (дата), סכום (ש'ח) (сумма), מספר לקוח (клиент).
//   'ADIFUT FOR DEILTA'      — מחלקה (департамент). Связана с ALL_PARTS отношением 1-to-*
//                              в модели PBI (видно на диаграмме модели) — DAX сам подтягивает
//                              её через SUMMARIZECOLUMNS, ручной LOOKUPVALUE по SKU не нужен
//                              (обычная ADIFUT/KARTIS PARIT такой связи не имеют и не подходят).
//   'לקוחות FORM+I+INT'      — клиент -> עיר/כשרות/שם סדרן/תאור סוג לקוח.
//
// ВАЖНО: ALL_PARTS содержит ВСЕ продажи компании (опт, все каналы) — это в разы больше, чем
// нужно для SADRAN. Берём только клиентов, у которых заполнен שם סדרן (то есть их ведёт
// сдаран) — это и есть тот самый客 customer-universe, на котором строится весь отчёт.
// После этого фильтра сумма близка к прежнему SADRAN.xlsx (не идентична — старый файл
// построен на неизвестном точно окне дат, см. project memory), это ожидаемо и принято
// как новая базовая методология (решение пользователя 2026-08-06).
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { executeDax } = require('../server/powerbi');
const { fixBiDi } = require('./sadran-data');

// Нормализация מחלקה: PBI-источник даёт названия с эмодзи/лишними пробелами
// ("חלבי🥛", "מתוקים  🍬"), в отчётах используются "чистые" ключи (см. DEPT_COMPANY
// в sadran-data.js). Только эти департаменты — товарные; "תגמולים" (зарплата) и
// пустые исключаются явно (whitelist, не blacklist — безопаснее при новых категориях).
// ICE BDD (гלידה bdd) сюда сознательно НЕ включён — это канал OneSales-агентов, не
// сдаранов, архитектурно исключаем на этапе выгрузки (решение 2026-08-06), а не только
// downstream через rowsExBdd, как было раньше.
const DEPT_NORMALIZE = {
  'חלבי🥛': 'חלבי',
  'קפוא ❄': 'קפוא ❄',
  'דג יבש 🐠': 'דג יבש',
  'דגים 🐟': 'דגים',
  'מדף': 'מדף',
  'מתוקים  🍬': 'מתוקים',
  'mish גלידה 🍦': 'mish גלידה',
};

function computePeriods(today = new Date()) {
  const y = today.getFullYear();
  const lastCompleteMonthEndExclusive = new Date(y, today.getMonth(), 1);
  const nowStart = new Date(y, 0, 1);
  const lyStart = new Date(y - 1, 0, 1);
  const lyEndExclusive = new Date(y - 1, lastCompleteMonthEndExclusive.getMonth(), lastCompleteMonthEndExclusive.getDate());
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    now: { start: fmt(nowStart), endExclusive: fmt(lastCompleteMonthEndExclusive) },
    lastYear: { start: fmt(lyStart), endExclusive: fmt(lyEndExclusive) },
  };
}

function daxDate(iso) {
  const [y, m, d] = iso.split('-');
  return `DATE(${y},${m},${d})`;
}

// "תאור משפחת מוצר" нужен только чтобы отсечь "בודדים" (единичные) семейства ICE —
// их продают агенты OneSales, не сдараны (см. project memory, решение 2026-08-06).
// "משפחתי"/"מארזים" семейства того же бренда — обычный товар сдаранов, остаются.
async function fetchSalesByCustDept(startIso, endExclusiveIso) {
  const q = `EVALUATE
SUMMARIZECOLUMNS(
  ALL_PARTS[מספר לקוח],
  'ADIFUT FOR DEILTA'[מחלקה],
  ALL_PARTS[תאור משפחת מוצר],
  FILTER(ALL_PARTS, ALL_PARTS[תאריך] >= ${daxDate(startIso)} && ALL_PARTS[תאריך] < ${daxDate(endExclusiveIso)}),
  "amt", SUM(ALL_PARTS[סכום (ש'ח)])
)`;
  return executeDax(q);
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
    const sadran = (r['[sadran]'] || '').trim();
    if (!sadran) continue; // только клиенты, которых ведёт сдаран — весь смысл отчёта
    map.set(String(r['[custno]']).trim(), {
      custname: r['[custname]'] || '',
      city: r['[city]'] || '',
      kosher: r['[kosher]'] || '(не указано)',
      sadran,
      custtype: r['[custtype]'] || '(нет в PBI)',
    });
  }
  return map;
}

async function main() {
  const periods = computePeriods();
  console.log('Периоды:', JSON.stringify(periods, null, 2));

  console.log('Тяну клиентов с назначенным сдараном...');
  const custDims = await fetchCustomerDims();
  console.log(`  клиентов со сдараном: ${custDims.size}`);

  console.log('Тяну продажи (now period)...');
  const nowRaw = await fetchSalesByCustDept(periods.now.start, periods.now.endExclusive);
  console.log(`  строк (custno x dept): ${nowRaw.length}`);

  console.log('Тяну продажи (last year period)...');
  const lyRaw = await fetchSalesByCustDept(periods.lastYear.start, periods.lastYear.endExclusive);
  console.log(`  строк (custno x dept): ${lyRaw.length}`);

  function aggregate(daxRows) {
    const agg = new Map(); // custno|dept -> amt
    let skippedDept = 0, skippedCust = 0, skippedBodedim = 0;
    for (const r of daxRows) {
      const custno = String(r['ALL_PARTS[מספר לקוח]']).trim();
      const deptRaw = r["ADIFUT FOR DEILTA[מחלקה]"];
      const familyRaw = r['ALL_PARTS[תאור משפחת מוצר]'];
      const amt = r['[amt]'] || 0;
      if (!custDims.has(custno)) { skippedCust++; continue; }
      const dept = DEPT_NORMALIZE[deptRaw];
      if (!dept) { skippedDept++; continue; }
      if (familyRaw && fixBiDi(familyRaw).includes('בודדים')) { skippedBodedim++; continue; }
      const key = `${custno}|${dept}`;
      agg.set(key, (agg.get(key) || 0) + amt);
    }
    return { agg, skippedDept, skippedCust, skippedBodedim };
  }
  const { agg: nowAgg, skippedDept: nowSkipDept, skippedCust: nowSkipCust, skippedBodedim: nowSkipBod } = aggregate(nowRaw);
  const { agg: lyAgg, skippedDept: lySkipDept, skippedCust: lySkipCust, skippedBodedim: lySkipBod } = aggregate(lyRaw);
  console.log(`  now: пропущено (dept/клиент/בודדים) = ${nowSkipDept}/${nowSkipCust}/${nowSkipBod}`);
  console.log(`  ly:  пропущено (dept/клиент/בודדים) = ${lySkipDept}/${lySkipCust}/${lySkipBod}`);

  const allKeys = new Set([...nowAgg.keys(), ...lyAgg.keys()]);
  const outRows = [];
  for (const key of allKeys) {
    const [custno, dept] = key.split('|');
    const dim = custDims.get(custno);
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
  console.log(`  итоговых строк: ${outRows.length}`);

  const totalNow = outRows.reduce((s, r) => s + r.now, 0);
  const totalLY = outRows.reduce((s, r) => s + r.lastYear, 0);
  console.log(`\nИтого: LY=${Math.round(totalLY).toLocaleString('en-US')}, NOW=${Math.round(totalNow).toLocaleString('en-US')}, % change=${((totalNow / totalLY - 1) * 100).toFixed(1)}%`);

  // Разбивка по компании для проверки на глаз
  const byCompany = new Map();
  const DEPT_COMPANY = {
    'mish גלידה': 'ICE MISH', 'מדף': 'INTER', 'מתוקים': 'INTER',
    'דג יבש': 'FORMULA', 'דגים': 'FORMULA', 'חלבי': 'FORMULA', 'קפוא ❄': 'FORMULA',
  };
  for (const r of outRows) {
    const c = DEPT_COMPANY[r.dept] || '(?)';
    if (!byCompany.has(c)) byCompany.set(c, { now: 0, ly: 0 });
    const b = byCompany.get(c);
    b.now += r.now;
    b.ly += r.lastYear;
  }
  for (const [c, v] of byCompany) {
    console.log(`  ${c}: LY=${Math.round(v.ly).toLocaleString('en-US')} -> NOW=${Math.round(v.now).toLocaleString('en-US')}`);
  }

  const outPath = path.join(__dirname, 'sadran_fetch_cache.json');
  fs.writeFileSync(outPath, JSON.stringify({ periods, fetchedAt: new Date().toISOString(), rows: outRows }));
  console.log('\nСохранено:', outPath);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
