// Общая загрузка и агрегация данных SADRAN — используется всеми генераторами отчёта
// (Excel/PPTX normal/PPTX impeccable), чтобы не плодить копии fixBiDi/loadRows
// (см. warning про 4 копии fixBiDi в hebrew-bidi skill — не повторять тот же паттерн здесь).
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN.xlsx';
// Кэш от fetch-sadran-data.js (прямой DAX из FORMULA PBI) — приоритетный источник,
// если он есть. SADRAN.xlsx (ручной экспорт) остаётся резервным путём, если PBI недоступен
// или кэш ещё не собран. См. project memory: методология с 2026-08-06 — YTD до последнего
// закрытого месяца, год к году; суммы НЕ идентичны старому SADRAN.xlsx (разное окно дат),
// это принято как новая база, не баг.
const FETCH_CACHE = path.join(__dirname, 'sadran_fetch_cache.json');

// fixBiDi — порт из server/index.js:2110 (hebrew-bidi skill).
// Имена клиентов из PBI приходят обёрнутые в LRO/PDF-маркеры вокруг REVERSE()'нутой строки —
// без этого фикса имя отображается задом наперёд.
const _BIDI_TEST = /[\u200E\u200F\u202A-\u202E]/;
const _BIDI_STRIP = /[\u200E\u200F\u202A-\u202E]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = _BIDI_TEST.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
  return fixed.replace(/\(/g, '\x01').replace(/\)/g, '(').replace(/\x01/g, ')');
}

// מחלקה -> компания (утверждено пользователем 2026-07-21, рукописная разметка):
// mish גלידה -> ICE MISH, גלידה bdd -> ICE BDD, מדף/מתוקים -> INTER,
// דג יבש/דגים/חלבי/קפוא -> FORMULA
const DEPT_COMPANY = {
  'mish גלידה': 'ICE MISH',
  'גלידה bdd': 'ICE BDD',
  'מדף': 'INTER',
  'מתוקים': 'INTER',
  'דג יבש': 'FORMULA',
  'דגים': 'FORMULA',
  'חלבי': 'FORMULA',
  'קפוא ❄': 'FORMULA',
};

// סוג לקוח — из FORMULA PBI dataset, таблица "לקוחות FORM+I+INT", join по מס. לקוח.
// Нужен только резервному пути loadRowsFromXlsx() — на кэш-пути (fetch-sadran-data.js,
// VPS-крон) custtype уже приходит внутри кэша. Файл gitignored, на VPS его не будет —
// без try/catch require() валит весь модуль ещё до того, как выяснится, что он не нужен.
let CUST_TYPE_DUMP = [];
try { CUST_TYPE_DUMP = require('./cust_type_dump.json'); } catch { /* нет дампа — ок для кэш-пути */ }
const CUST_TYPE = new Map(CUST_TYPE_DUMP.map(r => [String(r['[custno]']).trim(), r['[custtype]'] || '(не указано)']));

function loadRowsFromCache() {
  const cache = JSON.parse(fs.readFileSync(FETCH_CACHE, 'utf8'));
  return cache.rows.map(r => {
    const deptClean = (r.dept || '').trim();
    return {
      kosher: r.kosher || '(не указано)',
      city: r.city, custno: r.custno, custname: fixBiDi(r.custname), sadran: r.sadran,
      sochen: r.sochen ? fixBiDi(r.sochen) : '(не указан)',
      dept: deptClean,
      company: DEPT_COMPANY[deptClean] || '(не определено)',
      custtype: r.custtype || '(нет в PBI)',
      lastYear: Number(r.lastYear) || 0,
      now: Number(r.now) || 0,
    };
  });
}

function loadRowsFromXlsx() {
  const wb = XLSX.readFile(SRC);
  const ws = wb.Sheets['Export'];
  // Excel row 1 = пустой отступ, row 2 = заголовки, row 3+ = данные -> range:2 (0-indexed) начинает с первой строки данных
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 2 });
  const rows = [];
  for (const r of data) {
    const [kosher, city, custno, custname, sadran, dept, lastYear, now] = r;
    if (!custno || typeof custno !== 'number' && !/^\d+$/.test(String(custno).trim())) continue;
    const deptClean = (dept || '').trim();
    rows.push({
      kosher: kosher || '(не указано)',
      city, custno, custname: fixBiDi(custname), sadran,
      dept: deptClean,
      company: DEPT_COMPANY[deptClean] || '(не определено)',
      custtype: CUST_TYPE.get(String(custno).trim()) || '(нет в PBI)',
      lastYear: Number(lastYear) || 0,
      now: Number(now) || 0,
    });
  }
  return rows;
}

// loadRows — кэш от fetch-sadran-data.js (прямой DAX), если он есть; иначе SADRAN.xlsx
// (ручной экспорт) как резервный путь. Не молчаливое автопереключение "на глаз" — печатает,
// какой источник реально использован, чтобы не гадать при отладке.
function loadRows() {
  if (fs.existsSync(FETCH_CACHE)) {
    console.log(`[sadran-data] источник: DAX-кэш (${FETCH_CACHE})`);
    return loadRowsFromCache();
  }
  console.log(`[sadran-data] источник: ручной ${SRC} (кэш не найден)`);
  return loadRowsFromXlsx();
}

// loadIceBddBenchmark — сырой (без фильтра по שם סדרן) итог по ICE BDD, только для одной
// референсной строки "канал без влияния сдарана" (запрос пользователя 2026-08-11). Нет в
// SADRAN.xlsx-резерве (там его никогда не было) — возвращает null, а не бросает исключение.
function loadIceBddBenchmark() {
  if (!fs.existsSync(FETCH_CACHE)) return null;
  const cache = JSON.parse(fs.readFileSync(FETCH_CACHE, 'utf8'));
  return cache.iceBddBenchmark || null;
}

// loadMomentum — окна 3 и 6 полных месяцев (год к году), для сравнения "ускоряется рост или
// тормозит" (запрос пользователя 2026-08-11, задел под будущую email-рассылку боссам). Нет в
// SADRAN.xlsx-резерве — возвращает null, а не бросает исключение.
function loadMomentum() {
  if (!fs.existsSync(FETCH_CACHE)) return null;
  const cache = JSON.parse(fs.readFileSync(FETCH_CACHE, 'utf8'));
  return cache.momentum || null;
}

// loadPeriods — реальный период отчёта (YTD 1 января -> последний закрытый месяц), НЕ
// "текущий месяц" — нашли баг 2026-08-11: email-скрипт брал new Date() и писал "август" вместо
// правильного диапазона (данные за январь-июль). Нет в SADRAN.xlsx-резерве — null.
function loadPeriods() {
  if (!fs.existsSync(FETCH_CACHE)) return null;
  const cache = JSON.parse(fs.readFileSync(FETCH_CACHE, 'utf8'));
  return cache.periods || null;
}

function pctChange(ly, now) {
  // ly <= 0 — не только "нет истории" (ly===0), но и отрицательный net (возвраты/кредиты
  // перекрыли продажи в периоде) — оба случая одинаково не дают осмысленный % от базы.
  if (ly > 0) return (now - ly) / ly;
  return null;
}

function aggBy(rows, keyFn) {
  const buckets = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!buckets.has(k)) buckets.set(k, { lastYear: 0, now: 0, n: 0 });
    const b = buckets.get(k);
    b.lastYear += row.lastYear;
    b.now += row.now;
    b.n += 1;
  }
  return [...buckets.entries()].map(([key, v]) => ({
    key, lastYear: v.lastYear, now: v.now, delta: v.now - v.lastYear,
    pct: pctChange(v.lastYear, v.now), n: v.n,
  })).sort((a, b) => b.delta - a.delta);
}

// getNewCustomerSet — клиенты без истории прошлого года (глобально, по всем их строкам).
// Same-store/like-for-like методология (FMCG-дистрибуция): % роста по סדרן/компании считать
// только по клиентам с историей, иначе новый клиент искусственно раздувает % — это заслуга
// привлечения, а не роста существующей базы (два разных навыка).
function getNewCustomerSet(rows) {
  const ly = new Map();
  for (const r of rows) ly.set(r.custno, (ly.get(r.custno) || 0) + r.lastYear);
  return new Set([...ly.entries()].filter(([, v]) => v === 0).map(([k]) => k));
}

function fmtILS(n) {
  return '₪' + Math.round(n).toLocaleString('en-US');
}

// isolateLatin — оборачивает латинские фрагменты внутри ивритской строки в Unicode
// Left-to-Right Isolate (U+2066) / Pop Directional Isolate (U+2069). Без этого PowerPoint
// склеивает "mish גלידה" / "גלידה bdd" с соседней числовой подписью на коротких столбцах
// диаграммы (см. hebrew-bidi skill) — LRI/PDI изолирует латинский run, не давая BiDi-
// алгоритму захватить его в переупорядочивание вместе с процентом рядом.
function isolateLatin(str) {
  if (!str) return str;
  return str.replace(/[A-Za-z0-9][A-Za-z0-9 .%-]*[A-Za-z0-9]|[A-Za-z0-9]/g, m => `\u2066${m}\u2069`);
}
function isolateHebrew(str) {
  if (!str) return str;
  return str.replace(/[א-ת][א-ת'"׳ ]*[א-ת]|[א-ת]/g, m => `⁧${m}⁩`);
}
function fmtPct(p) {
  if (p === null) return 'н/д';
  return (p >= 0 ? '+' : '') + Math.round(p * 100) + '%';
}

module.exports = { loadRows, loadIceBddBenchmark, loadMomentum, loadPeriods, pctChange, aggBy, fmtILS, fmtPct, fixBiDi, DEPT_COMPANY, isolateLatin, isolateHebrew, getNewCustomerSet };
