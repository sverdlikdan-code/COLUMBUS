// obligo-alert.js — еженедельный отчёт по облиго (четверг 09:00, VPS cron /root/run-alert.sh obligo-alert).
// Один отчёт из 3 частей (запрос מנהל כספים יובל, решения Дана 2026-10-12):
//   1. 85% <= ניצול < 100%  — מתקרבים לניצול מלא  (+ יתרה לניצול)
//   2. ניצול >= 100%        — חורגים מהמסגרת        (+ יתרה מעבר למסגרת)
//   3. חוב בפיגור > 0       — חורגים מתנאי התשלום  (корзины 1-30/31-60/61-90/90+, только положительные,
//                             независимо от того, есть ли у клиента лимит)
// Каждая часть — רשתות (блоки по אחראי) и שוק פרטי (блоки по агенту). Лимит 10,000 (дефолт Priority)
// считается обычным лимитом (Дан 2026-10-12). Excel-вложение — те же 3 части на 3 листах.
//
// Источник — датасет FORMULA DASHBORD. С 2026-10-12 'HOVOT ALL' — одна строка на ПЛАТЕЛЬЩИКА
// ([מס לקוח משלם]); справочник 'לקוחות FORM+I+INT' связан с ней по [KEY משלם]. Меры
// [% ניצול OBLIGO] / [OBLIGO מנוצל] / [OBLIGO רב חברתי] — готовые из модели (сверены с Priority 12.10).
// Рабочие дни — меры модели [ימי עבודה 1] / [ימי עבודה שעברו] (вс–чт минус праздники, тот же календарь,
// что в Formula Road).
//
// Сравнение с прошлой рассылкой (как в expiry-alert): OBLIGO_ALERT_STATE — список после боевой отправки,
// в письме блок נוספו / יצאו по каждой части. --to / --dry-run state не трогают.
//
// Запуск: node obligo-alert.js                 — боевая рассылка (OBLIGO_ALERT_RECIPIENTS + менеджеры)
//         node obligo-alert.js --dry-run       — без отправки, превью HTML+XLSX в ./out
//         node obligo-alert.js --to a@b.com    — тест: полный отчёт только на этот адрес
require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const { executeDax } = require('./powerbi');

const NEAR = 0.85;
const DRY_RUN = process.argv.includes('--dry-run');
const TO_IDX = process.argv.indexOf('--to');
const TEST_TO = TO_IDX > -1 ? process.argv[TO_IDX + 1] : null;
const STATE = process.env.OBLIGO_ALERT_STATE || '';

// Внутренние/дочерние компании — не внешний кредитный риск, не алармить.
// מ.מ.ד.אינטרנשיונל אילת — своя дочерняя компания (пользователь подтвердил 2026-09-10).
const EXCLUDED_NAMES = new Set(['מ.מ.ד.אינטרנשיונל אילת']);

// PBI оборачивает иврит в BiDi-марки, символы/цифры идут в визуальном (обратном) порядке —
// снять марки и развернуть обратно в логический порядок. Та же функция, что в
// export-promo-no-price.js и других серверных скриптах, читающих иврит из PBI.
const BIDI_TEST = /[‎‏‪-‮]/;
const BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = BIDI_TEST.test(raw);
  const s = raw.replace(BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  return s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
}

const mode = map => { let best = null, bestN = -1; for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; } return best; };

// Плательщик -> {market, resp, formAgent, iceAgent, interAgent} по большинству голосов среди его
// клиентских счетов (главный + филиалы). Агент — отдельно по каждой системе, приоритет
// FORMULA -> ICE -> INTER (пользователь 2026-09-10).
async function fetchPayerClassification() {
  const D = "'לקוחות FORM+I+INT'";
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZE(${D}, ${D}[KEY משלם], ${D}[שוק פרטי / רשתות], ${D}[אחראי], ${D}[HEVRA], ${D}[שם סוכן],
      "n", COUNTROWS(${D}))
  `);
  const byPayer = new Map();
  for (const r of rows) {
    const key = r['לקוחות FORM+I+INT[KEY משלם]'];
    if (!key) continue;
    if (!byPayer.has(key)) byPayer.set(key, { market: new Map(), resp: new Map(), FORMULA: new Map(), ICE: new Map(), INTER: new Map() });
    const b = byPayer.get(key);
    const n = r['[n]'];
    const bump = (map, val) => { if (map && val) map.set(val, (map.get(val) || 0) + n); };
    bump(b.market, r['לקוחות FORM+I+INT[שוק פרטי / רשתות]']);
    bump(b.resp, r['לקוחות FORM+I+INT[אחראי]']);
    bump(b[r['לקוחות FORM+I+INT[HEVRA]']], fixBiDi(r['לקוחות FORM+I+INT[שם סוכן]']));
  }
  const result = new Map();
  for (const [key, b] of byPayer) {
    result.set(key, { market: mode(b.market), resp: mode(b.resp), agent: mode(b.FORMULA) || mode(b.ICE) || mode(b.INTER) });
  }
  return result;
}

async function fetchPayers() {
  // Лимит/использование/% — только готовые меры модели (никакого ручного SUM, сессия 2026-09-10).
  // Корзины просрочки — колонки HOVOT ALL (одна строка на плательщика, SUM = значение строки).
  const H = "'HOVOT ALL'";
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZECOLUMNS(
      ${H}[מס לקוח משלם], ${H}[תאור סוג לקוח], ${H}[שם לקוח],
      "util", [% ניצול OBLIGO],
      "usedILS", [OBLIGO מנוצל],
      "limitILS", [OBLIGO רב חברתי],
      "b30", SUM(${H}[1-30]), "b60", SUM(${H}[31-60]), "b90", SUM(${H}[61-90]), "bOld", SUM(${H}[מעל 90])
    )
  `);
  return rows.map(r => ({
    payer: r["HOVOT ALL[מס לקוח משלם]"],
    type: r['HOVOT ALL[תאור סוג לקוח]'],
    custName: fixBiDi(r['HOVOT ALL[שם לקוח]']),
    limitILS: r['[limitILS]'] || 0,
    usedILS: r['[usedILS]'] || 0,
    // только положительные корзины (Дан 2026-10-12): кредит в одной корзине не гасит долг в другой
    b30: Math.max(0, r['[b30]'] || 0),
    b60: Math.max(0, r['[b60]'] || 0),
    b90: Math.max(0, r['[b90]'] || 0),
    bOld: Math.max(0, r['[bOld]'] || 0),
  }));
}

// Рабочие дни месяца: всего / прошло — меры модели, отфильтрованные на текущий месяц
// (без фильтра мера считает по всему календарю, см. server/index.js workDaysPct).
async function fetchWorkDays() {
  const rows = await executeDax(`EVALUATE CALCULATETABLE(ROW("total", [ימי עבודה 1], "passed", [ימי עבודה שעברו]),
    MONTH(DIMCALENDAR[Date]) = MONTH(TODAY()), YEAR(DIMCALENDAR[Date]) = YEAR(TODAY()))`);
  const total = rows?.[0]?.['[total]'] || 0;
  const left = Math.max(0, total - (rows?.[0]?.['[passed]'] || 0));
  return { total, left, pct: total ? left / total : 0 };
}

// Сети — одна строка на (אחראי, название сети): несколько плательщиков одной сети суммируются
// (лимиты и использование), % пересчитан из сумм — как в отчёте PBI по תאור סוג לקוח.
// שוק פרטי — строка на плательщика (номер плательщика = מס' לקוח).
async function fetchEntities() {
  const [classification, payers] = [await fetchPayerClassification(), await fetchPayers()];
  const grouped = new Map();
  for (const p of payers) {
    const cls = classification.get(p.payer) || {};
    const isChain = cls.market === 'רשתות';
    const name = isChain ? p.type : p.custName;
    if (!name || EXCLUDED_NAMES.has(name)) continue;
    const key = isChain ? `C|${cls.resp || '—'}|${name}` : `P|${p.payer}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key, name, market: isChain ? 'רשתות' : 'שוק פרטי', resp: cls.resp || '—', agent: cls.agent || 'לא מוגדר',
        custno: isChain ? '' : p.payer, limitILS: 0, usedILS: 0, b30: 0, b60: 0, b90: 0, bOld: 0,
      });
    }
    const g = grouped.get(key);
    for (const f of ['limitILS', 'usedILS', 'b30', 'b60', 'b90', 'bOld']) g[f] += p[f];
  }
  return [...grouped.values()].map(g => ({
    ...g,
    util: g.limitILS > 0 ? g.usedILS / g.limitILS : null,
    overdue: g.b30 + g.b60 + g.b90 + g.bOld,
  }));
}

// Брендинг — та же executive-палитра, что была (навигация, золото, пергамент) + лого DILER B.M.D.
const NAVY = '#1C3D6B';
const GOLD = '#B8863B';
const RED = '#B00020';
const INK = '#2A2620';
const MUTED = '#6B7280';
const PAPER = '#FAF7F2';
const LINE = '#E5E0D8';
const ZEBRA = '#FAFAF8';

const fmtILS = n => '₪' + Math.round(n).toLocaleString('en-US');
// Outlook игнорирует CSS direction — явные LRE…PDF держат порядок "₪1,234" в ивритском тексте
const ltr = s => `&#x202A;${s}&#x202C;`;

const PARTS = [
  {
    id: 'near', color: GOLD, chip: GOLD, tint: '#F7EFDF', sheet: 'מתקרבים 85%-100%', label: `מתקרבים ${ltr('85%–100%')}`,
    title: 'לקוחות שמתקרבים לניצול מלא של המסגרת המאושרת',
    rule: 'ניצול 85% ומעלה ועד 100% ממסגרת האובליגו',
    pick: e => e.util !== null && e.util >= NEAR && e.util < 1,
    sort: (a, b) => b.util - a.util,
    extra: { head: 'יתרה לניצול', val: e => e.limitILS - e.usedILS },
  },
  {
    id: 'over', color: RED, chip: '#E0475B', tint: '#FBEAEC', sheet: 'חורגים מעל 100%', label: `חורגים מעל ${ltr('100%')}`,
    title: 'לקוחות שחורגים ממסגרת האשראי המאושרת',
    rule: 'ניצול 100% ומעלה ממסגרת האובליגו',
    pick: e => e.util !== null && e.util >= 1,
    sort: (a, b) => b.util - a.util,
    extra: { head: 'יתרה מעבר למסגרת', val: e => e.usedILS - e.limitILS },
    pareto: { by: e => e.usedILS - e.limitILS, what: 'מהחריגה', totalLabel: 'סה"כ חריגה מעבר למסגרת' },
  },
  {
    id: 'late', color: NAVY, chip: '#8FB3E0', tint: '#E8EEF6', sheet: 'חוב בפיגור', label: 'חוב בפיגור',
    title: 'לקוחות שחורגים מהסכם תנאי התשלום',
    rule: 'יתרת חוב בפיגור לפי ימי פיגור בפריוריטי, ללא קשר למסגרת אובליגו',
    pick: e => e.overdue >= 1,
    pareto: { by: e => e.overdue, what: 'מהחוב', totalLabel: 'סה"כ חוב בפיגור' },
    sort: (a, b) => b.overdue - a.overdue,
  },
];

const TH = `padding:0 8px 10px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:.3px;color:${MUTED};border-bottom:2px solid ${NAVY}`;
const TD = (bg, extra = '') => `padding:9px 8px;border-bottom:1px solid ${LINE};background:${bg};font-family:Arial,sans-serif;${extra}`;
const pctColor = u => u >= 1 ? RED : GOLD;
const pctBg = u => u >= 1 ? '#FBEAEC' : '#F7EFDF';

// Колонки сумм — фиксированной ширины (иначе в каждом блоке своя auto-ширина и цифры "гуляют",
// пользователь 2026-09-10).
function amountColumns(part) {
  if (part.id === 'late') {
    return [
      ['1-30', e => e.b30, 70], ['31-60', e => e.b60, 70], ['61-90', e => e.b90, 70], ['מעל 90', e => e.bOld, 70],
      ['סה"כ בפיגור', e => e.overdue, 84, true],
    ];
  }
  return [
    ['אובליגו', e => e.limitILS, 84], ['ניצול אובליגו', e => e.usedILS, 84],
    [part.extra.head, part.extra.val, 84, true],
  ];
}

function tableHead(part, isChain) {
  const cols = amountColumns(part).map(([h, , w]) => `<th style="${TH};text-align:right;width:${w}px">${h}</th>`).join('');
  const pct = part.id === 'late' ? '' : `<th style="${TH};text-align:right;width:56px">%</th>`;
  return `<tr dir="rtl">
        ${isChain ? '' : `<th style="${TH};text-align:right;width:62px">מס' לקוח</th>`}
        <th style="${TH};text-align:right">${isChain ? 'רשת' : 'שם'}</th>${cols}${pct}
      </tr>`;
}

function rowHtml(part, isChain) {
  return (e, i) => {
    const bg = i % 2 ? ZEBRA : '#ffffff';
    const cells = amountColumns(part).map(([, f, w, strong]) => {
      const v = f(e);
      const style = strong ? `font-weight:bold;color:${part.color}` : `color:${MUTED}`;
      return `<td dir="ltr" style="${TD(bg, `font-size:12px;text-align:right;width:${w}px;${style}`)}">${v ? fmtILS(v) : '—'}</td>`;
    }).join('');
    const pct = part.id === 'late' ? '' : `<td style="${TD(bg, 'text-align:right;width:56px')}">
        <span style="display:inline-block;min-width:40px;padding:3px 7px;border-radius:20px;background:${pctBg(e.util)};font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:${pctColor(e.util)};text-align:center">${Math.round(e.util * 100)}%</span></td>`;
    return `<tr>
      ${isChain ? '' : `<td dir="ltr" style="${TD(bg, `font-size:12px;color:${MUTED};text-align:right;width:62px`)}">${e.custno}</td>`}
      <td dir="rtl" style="${TD(bg, `font-size:13px;color:${INK};font-weight:bold`)}">${e.name}</td>${cells}${pct}
    </tr>`;
  };
}

// Блоки: רשתות по אחראי, שוק פרטי по агенту ("לא מוגדר"/"—" в конец, остальные по алфавиту).
function groupedBlocks(subtitle, rows, groupField, part, isChain) {
  if (!rows.length) return '';
  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r[groupField])) byGroup.set(r[groupField], []);
    byGroup.get(r[groupField]).push(r);
  }
  const undefinedLast = k => k === 'לא מוגדר' || k === '—';
  const keys = [...byGroup.keys()].sort((a, b) => (undefinedLast(a) - undefinedLast(b)) || a.localeCompare(b, 'he'));
  return `
  <tr><td dir="rtl" style="padding:18px 24px 0;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:14px;color:${INK};font-weight:bold">${subtitle} (${rows.length})</div>
  </td></tr>
  ${keys.map(k => `
  <tr><td dir="rtl" style="padding:12px 24px 6px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:13px;color:${NAVY};font-weight:bold">${k}</div>
  </td></tr>
  <tr><td style="padding:0 24px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid ${LINE}">
      ${tableHead(part, isChain)}
      ${byGroup.get(k).map(rowHtml(part, isChain)).join('')}
    </table>
  </td></tr>`).join('')}`;
}

function diffHtml(diff) {
  if (!diff) return '';
  const CAP = 15;
  const list = (rows, sign, color) => rows.length
    ? rows.slice(0, CAP).map(r => `<div style="padding:2px 0;font-size:12px;color:${INK}"><b style="color:${color}">${sign}</b> ${r.name}${r.custno ? ` (${r.custno})` : ''}</div>`).join('')
      + (rows.length > CAP ? `<div style="padding:2px 0;font-size:12px;color:${MUTED}">ועוד ${rows.length - CAP}</div>` : '')
    : `<div style="padding:2px 0;font-size:12px;color:${MUTED}">אין</div>`;
  return `<tr><td dir="rtl" style="padding:12px 24px 0;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td bgcolor="#F7F9FC" style="background-color:#F7F9FC;border:1px solid ${LINE};border-radius:10px;padding:10px 16px;text-align:right;font-family:Arial,sans-serif">
        <div style="font-size:13px;font-weight:900;color:${NAVY}">שינויים מהדוח הקודם (${diff.date})</div>
        <div style="padding-top:6px;font-size:12px;font-weight:bold;color:#b71c1c">נוספו (${diff.added.length}):</div>
        ${list(diff.added, '+', '#b71c1c')}
        <div style="padding-top:6px;font-size:12px;font-weight:bold;color:#2e7d32">יצאו (${diff.removed.length}):</div>
        ${list(diff.removed, '−', '#2e7d32')}
      </td>
    </tr></table>
  </td></tr>`;
}

// Части 2 и 3 в письме — только Парето: крупнейшие, дающие первые 50% суммы (часть 2 — по сумме
// сверх лимита, часть 3 — по просрочке; пересекающий порог включается). Полный список — в Excel (Дан 2026-10-12).
const PARETO_SHARE = 0.5;
function pareto(rows, by) {
  const total = rows.reduce((s, r) => s + by(r), 0);
  const top = [];
  let acc = 0;
  for (const r of [...rows].sort((a, b) => by(b) - by(a))) { if (acc >= total * PARETO_SHARE) break; top.push(r); acc += by(r); }
  return { top, total, topSum: acc };
}

function partHtml(part, rows, diff, num) {
  const p = part.pareto ? pareto(rows, part.pareto.by) : null;
  const shown = p ? p.top : rows;
  const chains = shown.filter(r => r.market === 'רשתות');
  const priv = shown.filter(r => r.market !== 'רשתות');
  const paretoNote = p && rows.length ? `<tr><td dir="rtl" style="padding:10px 24px 0;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:${INK}">
    ${part.pareto?.totalLabel}: <b style="color:${part.color}">${ltr(fmtILS(p.total))}</b>. מוצגים <b>${p.top.length}</b> הלקוחות שמרכזים ${ltr(Math.round(p.topSum / p.total * 100) + '%')} ${part.pareto?.what} (${ltr(fmtILS(p.topSum))}) — הרשימה המלאה של כל ${rows.length} הלקוחות בגיליון "${part.sheet}" בקובץ האקסל.
  </td></tr>` : '';
  return `
  <tr><td dir="rtl" style="padding:32px 24px 0;text-align:right">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td width="5" bgcolor="${part.color}" style="width:5px;background-color:${part.color};font-size:0;line-height:0">&nbsp;</td>
      <td dir="rtl" style="padding:2px 12px 2px 0;text-align:right">
        <div style="font-family:Arial,sans-serif;font-size:18px;color:${part.color};font-weight:bold;line-height:24px">${num}. ${part.title}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:18px">${part.rule} &middot; ${rows.length} ${rows.length === 1 ? 'לקוח' : 'לקוחות'}</div>
      </td>
    </tr></table>
  </td></tr>
  ${diffHtml(diff)}
  ${paretoNote}
  ${rows.length ? '' : `<tr><td dir="rtl" style="padding:12px 24px 0;text-align:right;font-family:Arial,sans-serif;font-size:13px;color:${MUTED}">אין לקוחות בקטגוריה זו.</td></tr>`}
  ${groupedBlocks('רשתות', chains, 'resp', part, true)}
  ${groupedBlocks('שוק פרטי', priv, 'agent', part, false)}`;
}

function buildEmailHtml(parts, workDays, greetName, privateOnly) {
  const greeting = greetName ? `שלום ${greetName},` : 'שלום,';
  const intro = privateOnly
    ? 'מצורף דוח האובליגו השבועי — שוק פרטי, הסוכנים של הקבוצה שלך. הדוח מחולק ל-3 חלקים, ובקובץ האקסל המצורף — אותם 3 חלקים בגיליונות נפרדים.'
    : 'מצורף דוח האובליגו השבועי. הדוח מחולק ל-3 חלקים, ובקובץ האקסל המצורף — אותם 3 חלקים בגיליונות נפרדים.';
  // Outlook (Word-движок) не рисует border/radius/margin у div — плашки только таблицами:
  // цветная полоска отдельной строкой с bgcolor, отступы — padding ячеек (тест 12.10 в Outlook развалился).
  const chips = parts.map(({ part, rows }, i) => `${i ? '<td width="12" style="width:12px;font-size:0;line-height:0">&nbsp;</td>' : ''}
      <td width="210" valign="top" style="width:210px">
        <table role="presentation" width="210" cellpadding="0" cellspacing="0" style="width:210px">
          <tr><td height="5" bgcolor="${part.chip}" style="height:5px;background-color:${part.chip};font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:10px 6px 9px;text-align:center">
            <div style="font-family:Arial,sans-serif;font-size:24px;font-weight:900;color:${part.color};line-height:28px">${rows.length}</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};line-height:16px">${part.label}</div>
          </td></tr>
        </table>
      </td>`).join('');
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<!doctype html>
<html lang="he"><body style="margin:0;padding:28px 16px;background:${PAPER};font-family:Arial,sans-serif">
<table role="presentation" align="center" width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:700px;margin:0 auto;background:#ffffff;border:1px solid ${LINE}">

  <tr><td bgcolor="${NAVY}" align="center" style="background-color:${NAVY};padding:32px 28px 0;text-align:center">
    <img src="cid:diler-logo-white" width="100" height="100" alt="DILER B.M.D" style="display:block;margin:0 auto" />
  </td></tr>
  <tr><td bgcolor="${NAVY}" align="center" dir="rtl" style="background-color:${NAVY};padding:14px 28px 0;text-align:center;font-family:Arial,sans-serif;font-size:24px;font-weight:900;color:#ffffff">דוח אובליגו ותנאי תשלום</td></tr>
  <tr><td bgcolor="${NAVY}" align="center" dir="rtl" style="background-color:${NAVY};padding:8px 28px 0;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:${GOLD}">דוח שבועי &middot; ${date}</td></tr>
  <tr><td bgcolor="${NAVY}" style="background-color:${NAVY};padding:20px 23px 0">
    <table role="presentation" width="654" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:654px;border-collapse:collapse"><tr>${chips}</tr></table>
  </td></tr>
  <tr><td bgcolor="${NAVY}" align="center" dir="rtl" style="background-color:${NAVY};padding:16px 28px 26px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#ffffff">נותרו <b>${workDays.left}</b> ימי עבודה עד סוף החודש מתוך ${workDays.total} &middot; <b>${Math.round(workDays.pct * 100)}%</b> מימי העבודה בחודש</td></tr>

  <tr><td dir="rtl" style="padding:20px 28px 0;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:14px;color:${INK}">${greeting} ${intro}</div>
  </td></tr>

  ${parts.map(({ part, rows, diff }, i) => partHtml(part, rows, diff, i + 1)).join('')}

  <tr><td style="padding:28px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="${LINE}" style="height:1px;background-color:${LINE};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
  <tr><td dir="rtl" style="padding:16px 28px 28px;text-align:right">
    <div style="font-family:Arial,sans-serif;font-size:12px;color:${MUTED};line-height:1.7">
      כל לקוח מדווח מחדש בכל דוח שבועי, כל עוד הוא עומד בתנאי החלק. סכומי הפיגור — רק יתרות חיוביות לפי ימי פיגור בפריוריטי.<br>
      הערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.
    </div>
  </td></tr>
</table>
</body></html>`;
}

// Excel: 3 листа, вкладка и шапка в цвет части; заморозка шапки, автофильтр, % с заливкой по зоне.
async function buildXlsx(parts) {
  const wb = new ExcelJS.Workbook();
  for (const { part, rows } of parts) {
    const color = part.color.slice(1);
    const ws = wb.addWorksheet(part.sheet, { properties: { tabColor: { argb: 'FF' + color } }, views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const amounts = amountColumns(part);
    const cols = [
      { header: 'שוק', key: 'market', width: 11 },
      { header: 'אחראי / סוכן', key: 'owner', width: 20 },
      { header: "מס' לקוח", key: 'custno', width: 11 },
      { header: 'שם', key: 'name', width: 36 },
      ...amounts.map(([header], i) => ({ header, key: 'a' + i, width: 15 })),
      ...(part.id === 'late' ? [] : [{ header: '%', key: 'pct', width: 9 }]),
    ];
    ws.columns = cols;
    const ordered = [...rows.filter(r => r.market === 'רשתות'), ...rows.filter(r => r.market !== 'רשתות')];
    for (const e of ordered) {
      const row = ws.addRow({
        market: e.market, owner: e.market === 'רשתות' ? e.resp : e.agent, custno: e.custno || '', name: e.name,
        ...Object.fromEntries(amounts.map(([, f], i) => [`a${i}`, Math.round(f(e))])),
        ...(part.id === 'late' ? {} : { pct: e.util }),
      });
      amounts.forEach((a, i) => {
        const cell = row.getCell(5 + i);
        cell.numFmt = '#,##0';
        if (a[3]) cell.font = { bold: true, color: { argb: 'FF' + color } };
      });
      if (part.id !== 'late') {
        const cell = row.getCell(cols.length);
        cell.numFmt = '0%';
        cell.font = { bold: true, color: { argb: 'FF' + color } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + part.tint.slice(1) } };
      }
    }
    // красим только ячейки шапки: fill на всю строку тянется до последней колонки листа
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Сравнение с прошлой боевой рассылкой — по ключу (сеть: אחראי+название, частник: номер плательщика).
function loadState() {
  if (!STATE || !fs.existsSync(STATE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { console.error('state not read:', e.message); return null; }
}

function diffFor(prev, partId, rows, keep = () => true) {
  const was = prev?.parts?.[partId];
  if (!Array.isArray(was)) return null;
  const wasKeys = new Set(was.map(r => r.key));
  const nowKeys = new Set(rows.map(r => r.key));
  return { date: prev.date, added: rows.filter(r => !wasKeys.has(r.key)), removed: was.filter(r => !nowKeys.has(r.key) && keep(r)) };
}

function saveState(parts) {
  if (!STATE) return;
  const date = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' });
  const data = { date, parts: Object.fromEntries(parts.map(({ part, rows }) => [part.id, rows.map(({ key, name, custno, market, agent }) => ({ key, name, custno, market, agent }))])) };
  // сбой записи не должен ронять уже отправленный алярм
  try { fs.writeFileSync(STATE, JSON.stringify(data, null, 1)); } catch (e) { console.error('state not saved:', e.message); }
}

// Кому имя известно — обращение по имени в письме (пользователь 2026-09-10). Кого нет в списке — "שלום,".
const RECIPIENT_NAMES = {
  'yuval.e@dilerbmd.com': 'יובל',
  'yosiel@dilerbmd.com': 'יוסי',
  'dima@dilerbmd.com': 'דימה',
  'maxim@dilerbmd.com': 'מקסים',
  'd.sverdlik@dilerbmd.com': 'דן',
  'danyb@dilerbmd.com': 'דני',
  'hanan.h@dilerbmd.com': 'חנן',
  'alexander.f@dilerbmd.com': 'אלכסנדר',
  // менеджеры команд FORMULA (адреса как в CLIENT_CHANGES_MANAGERS)
  'alexey.b@dilerbmd.com': 'אלכסי', // было dilerformula69@gmail.com (Дан 11.10: правильный адрес)
  'a.rusanovski@dilerbmd.com': 'אנטולי', // было dilerformula83@gmail.com (Дан 11.10)
  'natalia.r@dilerbmd.com': 'נטליה', // было dilerformula127@gmail.com (Дан 11.10)
  'svetlana.p@dilerbmd.com': 'סבטלנה', // было dilerformula115@gmail.com (Дан 11.10)
  'vladyslav.h@dilerbmd.com': 'ולדיסלב', // было dilerformula159@gmail.com (Дан 11.10)
  'dilerformula79@gmail.com': 'רומן',
  // менеджеры ICE BDD (как CLIENT_CHANGES_BDD_MANAGERS)
  'timur@dilerbmd.com': 'טימור', // было dilerformula84@gmail.com (Дан 11.10)
  'matvey@dilerbmd.com': 'מטביי', // было dilerformula99@gmail.com (Дан 11.10)
  'dilerformula231@gmail.com': 'שמחה',
};

// Менеджеру команды — только שוק פרטי агентов его קבוצה (пользователь 2026-10-08).
// Агент -> קבוצה из 'משטח' (тот же источник, что client-changes-alert). У агента несколько групп — частая.
async function fetchAgentGroups() {
  const rows = await executeDax(`
    EVALUATE
    SUMMARIZECOLUMNS('משטח'[שם סוכן], 'משטח'[קבוצה], "n", COUNTROWS('משטח'))`);
  const best = new Map();
  for (const r of rows) {
    const agent = fixBiDi(r['משטח[שם סוכן]']);
    const group = String(r['משטח[קבוצה]'] || '').trim();
    if (!agent || !group) continue;
    if (!best.has(agent) || r['[n]'] > best.get(agent).n) best.set(agent, { group, n: r['[n]'] });
  }
  const groupOf = new Map([...best].map(([a, v]) => [a, v.group]));
  // ICE BDD (пользователь 2026-10-08): ICE-агент -> группа BDD из bdd-cache.json живого сервера.
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(process.env.LIVE_DATA_DIR || path.join(__dirname, 'data'), 'bdd-cache.json'), 'utf8'));
    for (const [, c] of cache.clientById) if (c.agentName && c.manager && !groupOf.has(c.agentName)) groupOf.set(c.agentName, c.manager);
  } catch (e) { console.error('[managers] bdd-cache не прочитан, BDD-менеджерам пусто:', e.message); }
  return groupOf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendReport(resend, recipient, parts, workDays, privateOnly) {
  const greetName = RECIPIENT_NAMES[recipient.toLowerCase()];
  const logoPath = path.join(__dirname, '..', 'docs', 'logo-diler-bmd-white.png');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const attachments = [
    ...(fs.existsSync(logoPath) ? [{ filename: 'logo-white.png', content: fs.readFileSync(logoPath).toString('base64'), contentId: 'diler-logo-white' }] : []),
    { filename: `obligo-${today}.xlsx`, content: (await buildXlsx(parts)).toString('base64') },
  ];
  const counts = parts.map(p => p.rows.length);
  const text = `${greetName ? `שלום ${greetName},` : 'שלום,'} מצורף דוח האובליגו השבועי.\n\n`
    + parts.map(({ part, rows }, i) => `${i + 1}. ${part.title}: ${rows.length}`).join('\n')
    + `\n\nנותרו ${workDays.left} ימי עבודה עד סוף החודש מתוך ${workDays.total} (${Math.round(workDays.pct * 100)}%).`
    + '\n\nהערות והצעות — לדן סברדליק, d.sverdlik@DilerBMD.com.';
  // OBLIGO_ALERT_CC — копия на каждое личное письмо (Дан на разовой рассылке 2026-10-08)
  const cc = TEST_TO ? [] : (process.env.OBLIGO_ALERT_CC || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = await resend.emails.send({
    from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
    to: [recipient],
    ...(cc.length ? { cc } : {}),
    subject: `דוח אובליגו שבועי — מתקרבים: ${counts[0]} · חורגים: ${counts[1]} · בפיגור: ${counts[2]}`,
    html: buildEmailHtml(parts, workDays, greetName, privateOnly),
    text,
    attachments,
  });
  await sleep(600); // Resend: не больше ~2 писем в секунду
  return res;
}

async function main() {
  const entities = await fetchEntities();
  const workDays = await fetchWorkDays();
  const prev = loadState();
  const parts = PARTS.map(part => {
    const rows = entities.filter(part.pick).sort(part.sort);
    return { part, rows, diff: diffFor(prev, part.id, rows) };
  });

  console.log(`Плательщиков/сетей: ${entities.length}; рабочих дней осталось ${workDays.left}/${workDays.total}`);
  for (const { part, rows, diff } of parts) {
    console.log(`  [${part.id}] ${part.title}: ${rows.length} (сетей ${rows.filter(r => r.market === 'רשתות').length})`
      + (diff ? ` | vs ${diff.date}: +${diff.added.length} / -${diff.removed.length}` : ''));
  }

  // Менеджеры: "ALEXEY=a@x;MATVEY,ALMOG=b@x" — каждому שוק פרטי агентов его קבוצה, все 3 части.
  // Сбой карты групп не должен сорвать полный отчёт — менеджерские письма тогда пропускаются.
  const managers = TEST_TO ? [] : (process.env.OBLIGO_ALERT_MANAGERS || '').split(';').map(s => s.split('=').map(x => x.trim())).filter(([g, e]) => g && e);
  const perManager = [];
  if (managers.length) {
    try {
      const groupOf = await fetchAgentGroups();
      const noGroup = [...new Set(entities.filter(e => e.market !== 'רשתות' && !groupOf.has(e.agent)).map(e => e.agent))];
      if (noGroup.length) console.log('  агенты שוק פרטי без קבוצה (только в полном отчёте):', noGroup.join(', '));
      for (const [groups, email] of managers) {
        const gs = new Set(groups.split(',').map(s => s.trim()));
        const mineFn = r => r.market !== 'רשתות' && gs.has(groupOf.get(r.agent));
        const mine = parts.map(({ part, rows }) => {
          const own = rows.filter(mineFn);
          return { part, rows: own, diff: diffFor(prev, part.id, own, mineFn) };
        });
        const n = mine.reduce((s, p) => s + p.rows.length, 0);
        console.log(`  [${groups}] ${email}: ${mine.map(p => p.rows.length).join('/')}`);
        if (n) perManager.push({ email, mine });
      }
    } catch (e) {
      console.error('[managers] карта קבוצה не получена, менеджерам не отправлено:', e.message);
    }
  }

  if (DRY_RUN) {
    const out = path.join(__dirname, 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'obligo-alert-preview.html'), buildEmailHtml(parts, workDays, 'דן', false));
    fs.writeFileSync(path.join(out, 'obligo-alert-preview.xlsx'), await buildXlsx(parts));
    console.log(`\n--dry-run — письмо не отправлено, превью: ${out}`);
    return;
  }

  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY не найден в .env');
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (TEST_TO) {
    const r = await sendReport(resend, TEST_TO, parts, workDays, false);
    console.log(`Тест на ${TEST_TO}:`, JSON.stringify(r?.error ?? r?.data));
    return; // тест не пишет state — иначе сравнение в боевой рассылке собьётся
  }

  const recipients = (process.env.OBLIGO_ALERT_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('OBLIGO_ALERT_RECIPIENTS не задан в .env');
  for (const to of recipients) {
    const r = await sendReport(resend, to, parts, workDays, false);
    console.log(`Отправлено ${to}:`, JSON.stringify(r?.error ?? r?.data));
  }
  for (const { email, mine } of perManager) {
    const r = await sendReport(resend, email, mine, workDays, true);
    console.log(`Менеджеру ${email}:`, JSON.stringify(r?.error ?? r?.data));
  }
  saveState(parts);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
