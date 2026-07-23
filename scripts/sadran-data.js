// Общая загрузка и агрегация данных SADRAN — используется всеми генераторами отчёта
// (Excel/PPTX normal/PPTX impeccable), чтобы не плодить копии fixBiDi/loadRows
// (см. warning про 4 копии fixBiDi в hebrew-bidi skill — не повторять тот же паттерн здесь).
const XLSX = require('xlsx');
const path = require('path');

const SRC = 'C:\\Users\\d.sverdlik\\Desktop\\SADRAN.xlsx';

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

// סוג לקוח — из FORMULA PBI dataset, таблица "לקוחות FORM+I+INT", join по מס. לקוח
const CUST_TYPE_DUMP = require('./cust_type_dump.json');
const CUST_TYPE = new Map(CUST_TYPE_DUMP.map(r => [String(r['[custno]']).trim(), r['[custtype]'] || '(не указано)']));

function loadRows() {
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

function pctChange(ly, now) {
  if (ly) return (now - ly) / ly;
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
function fmtPct(p) {
  if (p === null) return 'н/д';
  return (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%';
}

module.exports = { loadRows, pctChange, aggBy, fmtILS, fmtPct, fixBiDi, DEPT_COMPANY, isolateLatin, getNewCustomerSet };
