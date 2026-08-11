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

// DEPT_COMPANY (чистые ключи, после DEPT_NORMALIZE) -> компания. Дубль DEPT_COMPANY из
// sadran-data.js (там — с эмодзи-версией нет, только чистые ключи; здесь то же самое, но
// нужен на уровне модуля ДО normalize) — не объединяю в одну мапу, т.к. в sadran-data.js
// её нельзя было импортировать сюда без circular require (fetch-sadran-data требует
// fixBiDi ИЗ sadran-data.js).
const DEPT_COMPANY = {
  'mish גלידה': 'ICE MISH', 'מדף': 'INTER', 'מתוקים': 'INTER',
  'דג יבש': 'FORMULA', 'דגים': 'FORMULA', 'חלבי': 'FORMULA', 'קפוא ❄': 'FORMULA',
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
// ALL_PARTS[שם סוכן] — берём агента с уровня ТРАНЗАКЦИИ, не с карточки клиента ('לקוחות
// FORM+I+INT'[שם סוכן]). Найдено 2026-08-11: у ICE-клиентов карточка часто хранит один
// устаревший/общий שם סוכן ("כללי - אייס - בודדים" — заглушка канала בודדים), тогда как
// РЕАЛЬНЫЕ транзакции того же клиента в mish גלידה идут через 2-3 разных настоящих агента.
// Доминирующий (по сумме ₪) агент на транзакциях — единственный надёжный источник.
async function fetchSalesByCustDept(startIso, endExclusiveIso) {
  const q = `EVALUATE
SUMMARIZECOLUMNS(
  ALL_PARTS[KEY FOR CAT 7],
  'ADIFUT FOR DEILTA'[מחלקה],
  ALL_PARTS[תאור משפחת מוצר],
  ALL_PARTS[שם סוכן],
  FILTER(ALL_PARTS, ALL_PARTS[תאריך] >= ${daxDate(startIso)} && ALL_PARTS[תאריך] < ${daxDate(endExclusiveIso)}),
  "amt", [TOTAL SALES netto]
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
  "amt", CALCULATE([TOTAL SALES netto],
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

// computeMomentumPeriods — ДВА СОСЕДНИХ непересекающихся 3-месячных окна (recent = последние
// 3 закрытых месяца, prior = 3 месяца непосредственно ПЕРЕД recent), каждое год-к-году.
// Уточнение пользователя 2026-08-11: не "3 мес vs 6 мес" (6-мес окно включает в себя 3-мес,
// пересечение размывает сигнал) — а темп роста recent-окна против темпа роста prior-окна,
// отдельный индикатор для быстрой поимки резких спадов/ускорений.
function computeMomentumPeriods(today = new Date()) {
  const endExclusive = new Date(today.getFullYear(), today.getMonth(), 1); // последний закрытый месяц
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const recentStart = new Date(endExclusive.getFullYear(), endExclusive.getMonth() - 3, 1);
  const priorStart = new Date(endExclusive.getFullYear(), endExclusive.getMonth() - 6, 1);
  function withLastYear(start, endEx) {
    const lyStart = new Date(start.getFullYear() - 1, start.getMonth(), 1);
    const lyEndExclusive = new Date(endEx.getFullYear() - 1, endEx.getMonth(), 1);
    return {
      now: { start: fmt(start), endExclusive: fmt(endEx) },
      lastYear: { start: fmt(lyStart), endExclusive: fmt(lyEndExclusive) },
    };
  }
  return {
    recent: withLastYear(recentStart, endExclusive),
    prior: withLastYear(priorStart, recentStart),
  };
}

// fetchWindowPerCustomer — скалярный итог за окно, тот же фильтр, что у aggregate() в main()
// (сдаран-клиенты по KEY FOR CAT 7 + белый список מחלקה + без בודדים), сгруппированный по
// клиенту x компания (ключ "keyForData|company" — нужно для same-store фильтра в
// fetchWindowSameStoreTotal, и для per-company разбивки в sadran-store-alarm.js).
async function fetchWindowPerCustomer(startIso, endExclusiveIso, custDims) {
  const daxRows = await fetchSalesByCustDept(startIso, endExclusiveIso);
  const perCust = new Map(); // "keyForData|company" -> amt
  for (const r of daxRows) {
    const keyForData = String(r['ALL_PARTS[KEY FOR CAT 7]'] || '').trim();
    if (!custDims.has(keyForData)) continue;
    const deptRaw = r['ADIFUT FOR DEILTA[מחלקה]'];
    const dept = DEPT_NORMALIZE[deptRaw];
    if (!dept) continue;
    const familyRaw = r['ALL_PARTS[תאור משפחת מוצר]'];
    if (familyRaw && fixBiDi(familyRaw).includes('בודדים')) continue;
    const company = DEPT_COMPANY[dept] || '(?)';
    const key = `${keyForData}|${company}`;
    perCust.set(key, (perCust.get(key) || 0) + (r['[amt]'] || 0));
  }
  return perCust;
}

// fetchMomentum — momentum СЧИТАЕТСЯ SAME-STORE (клиент с историей именно в этом конкретном
// окне год назад), той же методологией, что и весь остальной отчёт (см. rowsExBdd/newCustSet
// в PPTX-генераторах — "новый клиент искажает % роста, это не рост существующей базы").
// Раньше здесь суммировалась ВСЯ выручка окна включая новых клиентов — несовместимо с
// остальным отчётом и давало другой смысл % (нашли по вопросу пользователя 2026-08-11:
// "как посчитано замедление роста — только same-store или все").
async function fetchWindowSameStoreTotal(nowWindow, lyWindow, custDims) {
  const [nowPerCust, lyPerCust] = await Promise.all([
    fetchWindowPerCustomer(nowWindow.start, nowWindow.endExclusive, custDims),
    fetchWindowPerCustomer(lyWindow.start, lyWindow.endExclusive, custDims),
  ]);
  let lastYear = 0, now = 0;
  for (const [keyForData, lyAmt] of lyPerCust) {
    if (lyAmt <= 0) continue; // same-store: должна быть реальная (положительная) история в ЭТОМ окне год назад
    lastYear += lyAmt;
    now += nowPerCust.get(keyForData) || 0;
  }
  return { lastYear, now };
}

async function fetchMomentum(custDims) {
  const { recent, prior } = computeMomentumPeriods();
  const [recentTotal, priorTotal] = await Promise.all([
    fetchWindowSameStoreTotal(recent.now, recent.lastYear, custDims),
    fetchWindowSameStoreTotal(prior.now, prior.lastYear, custDims),
  ]);
  return {
    recent: { start: recent.now.start, endExclusive: recent.now.endExclusive, lastYear: recentTotal.lastYear, now: recentTotal.now },
    prior: { start: prior.now.start, endExclusive: prior.now.endExclusive, lastYear: priorTotal.lastYear, now: priorTotal.now },
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
    const agentAgg = new Map(); // keyForData|dept -> Map(sochenRaw -> amt)
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
      const sochenRaw = r['ALL_PARTS[שם סוכן]'] || '';
      if (!agentAgg.has(key)) agentAgg.set(key, new Map());
      const am = agentAgg.get(key);
      am.set(sochenRaw, (am.get(sochenRaw) || 0) + amt);
    }
    return { agg, agentAgg, skippedDept, skippedCust, skippedBodedim };
  }
  const { agg: nowAgg, agentAgg: nowAgentAgg, skippedDept: nowSkipDept, skippedCust: nowSkipCust, skippedBodedim: nowSkipBod } = aggregate(nowRaw);
  const { agg: lyAgg, agentAgg: lyAgentAgg, skippedDept: lySkipDept, skippedCust: lySkipCust, skippedBodedim: lySkipBod } = aggregate(lyRaw);
  console.log(`  now: пропущено (dept/клиент/בודדים) = ${nowSkipDept}/${nowSkipCust}/${nowSkipBod}`);
  console.log(`  ly:  пропущено (dept/клиент/בודדים) = ${lySkipDept}/${lySkipCust}/${lySkipBod}`);

  // dominantAgent — реальный агент с уровня транзакций (ALL_PARTS[שם סוכן]), не с карточки
  // клиента: карточка клиента ('לקוחות FORM+I+INT'[שם סוכן]) для ICE иногда хранит один
  // устаревший/общий "כללי - אייס - בודדים" на весь HEVRA-аккаунт, а реальные транзакции того
  // же клиента в mish גלידה идут через 2-3 разных настоящих агента (найдено 2026-08-11).
  // Берём агента с наибольшей суммой ₪ за оба периода вместе — самый представительный.
  function dominantAgent(key) {
    const combined = new Map();
    for (const m of [nowAgentAgg.get(key), lyAgentAgg.get(key)]) {
      if (!m) continue;
      for (const [sochenRaw, amt] of m) combined.set(sochenRaw, (combined.get(sochenRaw) || 0) + amt);
    }
    let best = '', bestAmt = -Infinity;
    for (const [sochenRaw, amt] of combined) {
      if (amt > bestAmt) { best = sochenRaw; bestAmt = amt; }
    }
    return best;
  }

  const allKeys = new Set([...nowAgg.keys(), ...lyAgg.keys()]);
  const outRows = [];
  for (const key of allKeys) {
    const [keyForData, dept] = key.split('|');
    const dim = custDims.get(keyForData);
    const sochenRaw = dominantAgent(key);
    outRows.push({
      kosher: dim.kosher,
      city: dim.city,
      custno: dim.custno,
      custname: dim.custname,
      sadran: dim.sadran,
      // сырой (не fixBiDi'нутый) — как и dim.sochen: sadran-data.js's loadRowsFromCache
      // применяет fixBiDi один раз при загрузке, здесь применять нельзя (задвоение = порча текста).
      sochen: sochenRaw || dim.sochen,
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
  const pctRecent = momentum.recent.lastYear > 0 ? (momentum.recent.now / momentum.recent.lastYear - 1) * 100 : null;
  const pctPrior = momentum.prior.lastYear > 0 ? (momentum.prior.now / momentum.prior.lastYear - 1) * 100 : null;
  console.log(`  recent 3 мес (${momentum.recent.start} -> ${momentum.recent.endExclusive}), same-store: LY=${Math.round(momentum.recent.lastYear).toLocaleString('en-US')} -> NOW=${Math.round(momentum.recent.now).toLocaleString('en-US')} (${pctRecent === null ? 'н/д' : pctRecent.toFixed(1) + '%'})`);
  console.log(`  prior 3 мес  (${momentum.prior.start} -> ${momentum.prior.endExclusive}), same-store: LY=${Math.round(momentum.prior.lastYear).toLocaleString('en-US')} -> NOW=${Math.round(momentum.prior.now).toLocaleString('en-US')} (${pctPrior === null ? 'н/д' : pctPrior.toFixed(1) + '%'})`);

  const outPath = path.join(__dirname, 'sadran_fetch_cache.json');
  fs.writeFileSync(outPath, JSON.stringify({ periods, fetchedAt: new Date().toISOString(), rows: outRows, iceBddBenchmark, momentum }));
  console.log('\nСохранено:', outPath);
}

if (require.main === module) {
  main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
}

// Экспорт для scripts/sadran-store-alarm.js — переиспользует джойн/фильтры, не дублирует.
module.exports = {
  DEPT_NORMALIZE, DEPT_COMPANY, computePeriods, computeMomentumPeriods, daxDate,
  fetchSalesByCustDept, fetchCustomerDims, fetchWindowPerCustomer,
};
