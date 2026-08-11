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
//
// Джойн клиент<->продажи — ПО МОДЕЛИ PBI (проверено 2026-08-11 через EVALUATE
// INFO.VIEW.RELATIONSHIPS()): активная связь идёт ALL_PARTS[KEY FOR CAT 7] ->
// 'לקוחות FORM+I+INT'[KEY FOR DATA ] (= HEVRA & מספר לקוח), НЕ по голому מספר לקוח.
// מספר לקוח у клиента переприсваивается Priority-ERP со временем (видно по полю
// [מספר לקוח קודם] — у части клиентов не совпадает с текущим) — джойн по custno
// в таких случаях терял историю прошлого года и ошибочно помечал старого клиента
// как "нового". KEY FOR CAT 7/KEY FOR DATA — официальный устойчивый ключ модели.
async function fetchSalesByCustDept(startIso, endExclusiveIso) {
  const q = `EVALUATE
SUMMARIZECOLUMNS(
  ALL_PARTS[KEY FOR CAT 7],
  'ADIFUT FOR DEILTA'[מחלקה],
  ALL_PARTS[תאור משפחת מוצר],
  FILTER(ALL_PARTS, ALL_PARTS[תאריך] >= ${daxDate(startIso)} && ALL_PARTS[תאריך] < ${daxDate(endExclusiveIso)}),
  "amt", SUM(ALL_PARTS[סכום (ש'ח)])
)`;
  return executeDax(q);
}

// KEY FOR DATA — HEVRA & מספר לקוח, поэтому один физический клиент/магазин даёт
// НЕСКОЛЬКО строк в 'לקוחות FORM+I+INT' (одну на каждую компанию, у которой он
// закупается — FORMULA/ICE/INTER), с одинаковым מספר לקוח, но разным KEY FOR DATA.
// Раньше custDims индексировался только по custno — 2 из 3 таких строк молча
// перезаписывались (найдено 2026-08-11 на примере MY MARKET, custno 1132112:
// 3 строки, FORMULA/ICE/INTER). Теперь ключ — KEY FOR DATA (уникален).
async function fetchCustomerDims() {
  const rows = await executeDax(`EVALUATE SELECTCOLUMNS('לקוחות FORM+I+INT',
    "keyForData", 'לקוחות FORM+I+INT'[KEY FOR DATA ],
    "custno", 'לקוחות FORM+I+INT'[מס. לקוח],
    "custname", 'לקוחות FORM+I+INT'[שם לקוח],
    "city", 'לקוחות FORM+I+INT'[עיר],
    "kosher", 'לקוחות FORM+I+INT'[כשרות],
    "sadran", 'לקוחות FORM+I+INT'[שם סדרן],
    "sochen", 'לקוחות FORM+I+INT'[שם סוכן],
    "custtype", 'לקוחות FORM+I+INT'[תאור סוג לקוח]
  )`);
  const map = new Map();
  for (const r of rows) {
    const sadran = (r['[sadran]'] || '').trim();
    if (!sadran) continue; // только клиенты, которых ведёт сдаран — весь смысл отчёта
    const keyForData = (r['[keyForData]'] || '').trim();
    if (!keyForData) continue;
    map.set(keyForData, {
      custno: String(r['[custno]'] || '').trim(),
      custname: r['[custname]'] || '',
      city: r['[city]'] || '',
      kosher: r['[kosher]'] || '(не указано)',
      sadran,
      sochen: (r['[sochen]'] || '').trim() || '(не указан)',
      custtype: r['[custtype]'] || '(нет в PBI)',
    });
  }
  return map;
}

// fetchIceBddBenchmark — СЫРОЙ (без фильтра по клиентам/שם סדרן) итог по ICE BDD за оба
// периода. Нужен ТОЛЬКО как одна референсная строка для сравнения на слайде "По компаниям"
// (запрос пользователя 2026-08-11): ICE BDD — канал OneSales, сдараны его не ведут, поэтому
// его динамика — естественный контроль "как растёт направление без участия сдарана". Не путать
// с основным rows/outRows — туда ICE BDD сознательно не входит (DEPT_NORMALIZE whitelist).
async function fetchIceBddBenchmark(periods) {
  const ICE_BDD_RAW = 'גלידה bdd🍦';
  async function totalFor(startIso, endExclusiveIso) {
    const q = `EVALUATE ROW(
  "amt", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]),
    'ADIFUT FOR DEILTA'[מחלקה] = "${ICE_BDD_RAW}",
    ALL_PARTS[תאריך] >= ${daxDate(startIso)} && ALL_PARTS[תאריך] < ${daxDate(endExclusiveIso)})
)`;
    const rows = await executeDax(q);
    return rows[0]?.['[amt]'] || 0;
  }
  const lastYear = await totalFor(periods.lastYear.start, periods.lastYear.endExclusive);
  const now = await totalFor(periods.now.start, periods.now.endExclusive);
  return { lastYear, now };
}

// computeMomentumPeriods — окна 3 и 6 полных месяцев (та же граница "последний закрытый
// месяц", что у computePeriods), год к году — momentum-сравнение (запрос пользователя
// 2026-08-11: тормозит рост или ускоряется — 3-мес тренд против 6-мес).
function computeMomentumPeriods(today = new Date()) {
  const endExclusive = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function windowOf(months) {
    const start = new Date(endExclusive.getFullYear(), endExclusive.getMonth() - months, 1);
    const lyStart = new Date(start.getFullYear() - 1, start.getMonth(), 1);
    const lyEndExclusive = new Date(endExclusive.getFullYear() - 1, endExclusive.getMonth(), 1);
    return {
      now: { start: fmt(start), endExclusive: fmt(endExclusive) },
      lastYear: { start: fmt(lyStart), endExclusive: fmt(lyEndExclusive) },
    };
  }
  return { window3: windowOf(3), window6: windowOf(6) };
}

// fetchWindowTotal — скалярный итог за окно, тот же фильтр, что у aggregate() в main()
// (сдаран-клиенты по KEY FOR CAT 7 + белый список מחלקה + без בודדים) — но без построения
// полной таблицы строк, для momentum нужен только итог.
async function fetchWindowTotal(startIso, endExclusiveIso, custDims) {
  const daxRows = await fetchSalesByCustDept(startIso, endExclusiveIso);
  let total = 0;
  for (const r of daxRows) {
    const keyForData = String(r['ALL_PARTS[KEY FOR CAT 7]'] || '').trim();
    if (!custDims.has(keyForData)) continue;
    const deptRaw = r['ADIFUT FOR DEILTA[מחלקה]'];
    if (!DEPT_NORMALIZE[deptRaw]) continue;
    const familyRaw = r['ALL_PARTS[תאור משפחת מוצר]'];
    if (familyRaw && fixBiDi(familyRaw).includes('בודדים')) continue;
    total += r['[amt]'] || 0;
  }
  return total;
}

async function fetchMomentum(custDims) {
  const { window3, window6 } = computeMomentumPeriods();
  const [w3Now, w3LY, w6Now, w6LY] = await Promise.all([
    fetchWindowTotal(window3.now.start, window3.now.endExclusive, custDims),
    fetchWindowTotal(window3.lastYear.start, window3.lastYear.endExclusive, custDims),
    fetchWindowTotal(window6.now.start, window6.now.endExclusive, custDims),
    fetchWindowTotal(window6.lastYear.start, window6.lastYear.endExclusive, custDims),
  ]);
  return {
    window3: { start: window3.now.start, endExclusive: window3.now.endExclusive, lastYear: w3LY, now: w3Now },
    window6: { start: window6.now.start, endExclusive: window6.now.endExclusive, lastYear: w6LY, now: w6Now },
  };
}

async function main() {
  const periods = computePeriods();
  console.log('Периоды:', JSON.stringify(periods, null, 2));

  console.log('Тяну клиентов с назначенным сдараном...');
  const custDims = await fetchCustomerDims();
  console.log(`  клиентов со сдараном: ${custDims.size}`);

  console.log('Тяну продажи (now period)...');
  const nowRaw = await fetchSalesByCustDept(periods.now.start, periods.now.endExclusive);
  console.log(`  строк (keyForData x dept): ${nowRaw.length}`);

  console.log('Тяну продажи (last year period)...');
  const lyRaw = await fetchSalesByCustDept(periods.lastYear.start, periods.lastYear.endExclusive);
  console.log(`  строк (keyForData x dept): ${lyRaw.length}`);

  // Ключ агрегации — KEY FOR CAT 7 (= keyForData клиента), не custno: см. комментарий
  // у fetchSalesByCustDept/fetchCustomerDims про переприсвоение מספר לקוח во времени.
  function aggregate(daxRows) {
    const agg = new Map(); // keyForData|dept -> amt
    let skippedDept = 0, skippedCust = 0, skippedBodedim = 0;
    for (const r of daxRows) {
      const keyForData = String(r['ALL_PARTS[KEY FOR CAT 7]'] || '').trim();
      const deptRaw = r["ADIFUT FOR DEILTA[מחלקה]"];
      const familyRaw = r['ALL_PARTS[תאור משפחת מוצר]'];
      const amt = r['[amt]'] || 0;
      if (!custDims.has(keyForData)) { skippedCust++; continue; }
      const dept = DEPT_NORMALIZE[deptRaw];
      if (!dept) { skippedDept++; continue; }
      if (familyRaw && fixBiDi(familyRaw).includes('בודדים')) { skippedBodedim++; continue; }
      const key = `${keyForData}|${dept}`;
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
    const [keyForData, dept] = key.split('|');
    const dim = custDims.get(keyForData);
    outRows.push({
      kosher: dim.kosher,
      city: dim.city,
      custno: dim.custno,
      custname: dim.custname,
      sadran: dim.sadran,
      sochen: dim.sochen,
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

  console.log('Тяну ICE BDD бенчмарк (сырой, без фильтра по клиентам)...');
  const iceBddBenchmark = await fetchIceBddBenchmark(periods);
  console.log(`  ICE BDD: LY=${Math.round(iceBddBenchmark.lastYear).toLocaleString('en-US')} -> NOW=${Math.round(iceBddBenchmark.now).toLocaleString('en-US')}`);

  console.log('Тяну momentum (3 мес vs 6 мес, год к году)...');
  const momentum = await fetchMomentum(custDims);
  const pct3 = momentum.window3.lastYear > 0 ? (momentum.window3.now / momentum.window3.lastYear - 1) * 100 : null;
  const pct6 = momentum.window6.lastYear > 0 ? (momentum.window6.now / momentum.window6.lastYear - 1) * 100 : null;
  console.log(`  3 мес (${momentum.window3.start} -> ${momentum.window3.endExclusive}): LY=${Math.round(momentum.window3.lastYear).toLocaleString('en-US')} -> NOW=${Math.round(momentum.window3.now).toLocaleString('en-US')} (${pct3 === null ? 'н/д' : pct3.toFixed(1) + '%'})`);
  console.log(`  6 мес (${momentum.window6.start} -> ${momentum.window6.endExclusive}): LY=${Math.round(momentum.window6.lastYear).toLocaleString('en-US')} -> NOW=${Math.round(momentum.window6.now).toLocaleString('en-US')} (${pct6 === null ? 'н/д' : pct6.toFixed(1) + '%'})`);

  const outPath = path.join(__dirname, 'sadran_fetch_cache.json');
  fs.writeFileSync(outPath, JSON.stringify({ periods, fetchedAt: new Date().toISOString(), rows: outRows, iceBddBenchmark, momentum }));
  console.log('\nСохранено:', outPath);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
